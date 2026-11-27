import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sourceIndividual} from '../lib/source-identity.mjs';
import {rosterMetadata} from '../lib/bird-lifecycle.mjs';
import {syncPolicy} from '../lib/sync-policy.mjs';

test('stable identity survives renames and refuses reused labels or ambiguous metadata',()=>{
 const bird={name:'Original',archiveState:{individualId:'123'}};
 const animal={id:'123',local_identifier:'Renamed'};
 assert.equal(sourceIndividual(bird,[{id:'456',local_identifier:'Original'},animal]),animal);
 assert.equal(sourceIndividual(bird,[{id:'456',local_identifier:'Original'}]),undefined);
 assert.equal(sourceIndividual({name:'Original'},[{id:'456',local_identifier:'Original'}]).id,'456');
 assert.throws(()=>sourceIndividual(bird,[animal,animal]),/Ambiguous/);
 const kept=rosterMetadata({individuals:[animal],deployments:[{individual_id:'123'}]},[{name:'Original',individualId:'123'}]);
 assert.equal(kept.individuals.length,1);assert.equal(kept.deployments.length,1);
});

test('incremental import retains internal identity after source rename without rediscovery or duplicate',async()=>{
 await build({entryPoints:['scripts/build-study.ts'],outfile:'.runner/source-identity-test.mjs',bundle:true,platform:'node',format:'esm'});
 const {buildStudy}=await import('../.runner/source-identity-test.mjs');
 const now=Date.now(),stamp=new Date(now-1000).toISOString(),policy=syncPolicy(now);
 const bird={id:'42:Original',name:'Original',studyId:'42',individualId:'123',latestValidFixUtc:stamp,history:[]};
 const animal={id:'123',local_identifier:'Renamed',taxon_canonical_name:'Ciconia ciconia'};
 const metadata={importerVersion:2,day:policy.discoveryDay,individuals:[animal],deployments:[{individual_id:'123',deploy_on_timestamp:'2020-01-01'}]};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('timestamp,individual_local_identifier,location_long,location_lat,visible,individual_taxon_canonical_name\n'+stamp+',Renamed,-4,40,true,Ciconia ciconia\n');
 try {
  const result=await buildStudy({study:{studyId:'42'},current:[bird],metadata,state:{lastSuccessAt:stamp},token:'synthetic',now});
  assert.equal(result.birds.length,1);assert.equal(result.report.discovered,0);
  assert.equal(result.birds[0].id,bird.id);assert.equal(result.birds[0].name,'Original');
  assert.equal(result.birds[0].sourceName,'Renamed');assert.equal(result.birds[0].individualId,'123');
  assert.equal(result.birds[0].history.length,1);
 } finally {globalThis.fetch=originalFetch;}
});

test('partitioned discovery imports each white stork, preserves freshness checks and fails on incomplete exports',async()=>{
 const {buildStudy}=await import('../.runner/source-identity-test.mjs');
 const now=Date.now(),stamp=new Date(now-1000).toISOString(),calls=[];
 const originalFetch=globalThis.fetch;
 let fail=false;
 globalThis.fetch=async url=>{
  const q=new URL(url).searchParams;
  if(q.get('entity_type')==='study')return new Response('id,i_have_download_access,license_type\n247772625,true,CUSTOM\n');
  if(q.get('entity_type')==='individual')return new Response('id,local_identifier,taxon_canonical_name\n1,Alpha,Ciconia ciconia\n2,Beta,Ciconia ciconia\n3,Other,Other species\n');
  if(q.get('entity_type')==='deployment')return new Response('id,individual_id,tag_id,deploy_on_timestamp,deploy_off_timestamp\na,1,t1,2020-01-01,\nb,2,t2,2020-01-01,\n');
  calls.push(q.get('individual_id'));assert.ok(q.has('timestamp_start'));
  if(fail&&q.get('individual_id')==='2')throw Error('simulated interruption');
  const name=q.get('individual_id')==='1'?'Alpha':'Beta';
  return new Response('timestamp,individual_local_identifier,location_long,location_lat,visible,individual_taxon_canonical_name\n'+stamp+','+name+',-4,40,true,Ciconia ciconia\n');
 };
 const input={study:{studyId:'247772625',license:'Collaborator permission — custom terms',eventPartition:'individual'},current:[],token:'synthetic',now};
 try{const result=await buildStudy(input);assert.deepEqual(calls,['1','2']);assert.equal(result.report.discovered,2);assert.equal(result.report.eventRows,2);assert.equal(result.birds.length,2);fail=true;await assert.rejects(buildStudy(input),/connection failed/);}finally{globalThis.fetch=originalFetch;}
});

test('partition retry discards a broken stream without repeating completed birds',async()=>{
 const {buildStudy}=await import('../.runner/source-identity-test.mjs');
 const now=Date.now(),stamp=new Date(now-10000).toISOString(),calls=[],delays=[];
 const header='timestamp,individual_local_identifier,location_long,location_lat,visible,individual_taxon_canonical_name\n';
 const originalFetch=globalThis.fetch;let beta=0;
 globalThis.fetch=async url=>{
  const q=new URL(url).searchParams;
  if(q.get('entity_type')==='study')return new Response('id,i_have_download_access,license_type\n247772625,true,CUSTOM\n');
  if(q.get('entity_type')==='individual')return new Response('id,local_identifier,taxon_canonical_name\n1,Alpha,Ciconia ciconia\n2,Beta,Ciconia ciconia\n');
  if(q.get('entity_type')==='deployment')return new Response('id,individual_id,tag_id,deploy_on_timestamp\na,1,t1,2020-01-01\nb,2,t2,2020-01-01\n');
  const id=q.get('individual_id');calls.push(id);
  if(id==='2'&&++beta===1)return new Response(new ReadableStream({async start(c){c.enqueue(new TextEncoder().encode(header+new Date(now-1000).toISOString()+',Beta,-3,40,true,Ciconia ciconia\n'));await new Promise(r=>setTimeout(r,0));c.error(Error('terminated'));}}));
  return new Response(header+stamp+','+(id==='1'?'Alpha':'Beta')+',-4,40,true,Ciconia ciconia\n');
 };
 try{
  const result=await buildStudy({study:{studyId:'247772625',license:'Collaborator permission — custom terms',eventPartition:'individual'},current:[],token:'synthetic',now,sleep:async ms=>delays.push(ms)});
  assert.deepEqual(calls,['1','2','2']);assert.deepEqual(delays,[15000]);
  assert.equal(result.report.eventRows,2);assert.equal(result.report.validEventRows,2);
  assert.equal(result.birds.find(b=>b.name==='Beta').longitude,-4);
  assert.equal(result.birds.find(b=>b.name==='Beta').latestValidFixUtc,stamp);
 }finally{globalThis.fetch=originalFetch;}
});
