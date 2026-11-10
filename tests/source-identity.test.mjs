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
