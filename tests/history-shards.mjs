import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {encodeHistory,decodeHistory} from '../lib/history-codec.mjs';
import {summarizeRecords} from '../lib/history.mjs';
import {readArchive,writeArchive} from '../lib/history-transfer.mjs';
const RealDate=Date,now=Date.parse('2026-11-07T21:00:00Z');globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
globalThis.fetch=async()=>{throw Error('Network forbidden in archive sharding tests');};
let sql=[0,1,2].map(()=>new DatabaseSync(':memory:'));
sql[0].exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0002_history','0003_history_parts','0004_race','0017_history_shard_routes'])sql[0].exec(readFileSync('drizzle/'+m+'.sql','utf8'));
for(const db of sql.slice(1))db.exec(readFileSync('drizzle-history/0000_archive.sql','utf8'));
let sizes=[900000,140000000,16384],queries=0,maxQueries=0,failManifest=false;
const adapter=i=>({prepare(q){const bound=(a=[])=>{const run=method=>{queries++;if(failManifest&&i===2&&q.startsWith('INSERT INTO history_chunks')){failManifest=false;throw Error('Simulated manifest failure');}return sql[i].prepare(q)[method](...a.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));};return {run:async()=>({meta:{changes:Number(run('run').changes),size_after:sizes[i]}}),first:async()=>run('get')||null,all:async()=>({results:run('all')})};};return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql[i].exec('BEGIN');try{const r=[];for(const st of stmts)r.push(await st.run());sql[i].exec('COMMIT');return r;}catch(e){sql[i].exec('ROLLBACK');throw e;}}});
globalThis.shardEnv={DB:adapter(0),HISTORY_ARCHIVE:adapter(1),HISTORY_ARCHIVE_2:adapter(2),HISTORY_SHARD_COUNT:'2',SYNC_SECRET:'fixture'};
await build({entryPoints:['lib/history-endpoint.ts','lib/bird-cleanup.ts','lib/rankings.ts'],outdir:'.runner/shard-integration',outExtension:{'.js':'.mjs'},platform:'node',format:'esm',bundle:true,plugins:[{name:'isolation',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.shardEnv',loader:'js'}));}}]});
const {POST,GET}=await import('../.runner/shard-integration/history-endpoint.mjs');const {cleanupBirds}=await import('../.runner/shard-integration/bird-cleanup.mjs');
const id='24442409:Shard fixture',bird={id,name:'Shard fixture',studyId:'24442409',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:800,countryCode:'ES',currentDeployment:true,recordedDead:false,reviewRequired:false};sql[0].prepare('INSERT INTO birds VALUES(?,?)').run(id,JSON.stringify(bird));
const request=async(body,authorized=true)=>{queries=0;const r=await POST(new Request('https://fixture.test/api/history',{method:'POST',headers:{Authorization:authorized?'Bearer fixture':'wrong'},body:JSON.stringify(body)}));maxQueries=Math.max(maxQueries,queries);assert.ok(queries<50,'Free request query budget exceeded: '+queries);return r;};
const api=async(body)=>{const r=await request(body);assert.equal(r.status,200,await r.clone().text());return r.json();};
const rows=(month,n=60)=>Array.from({length:n},(_,i)=>[new Date(Date.parse(month+'-01T00:00:00Z')+i*60000).toISOString(),2+i/100000,42+i/100000,'event-'+i,0,'tag',null]);
const original=rows('2026-09');const summary=summarizeRecords(original);
sql[1].prepare('INSERT INTO history_chunks VALUES(?,?,?,?)').run(id,'2026-09',encodeHistory(original),JSON.stringify(summary));
const legacy=rows('2026-08');sql[0].prepare('INSERT INTO history_chunks VALUES(?,?,?,?)').run(id,'2026-08',encodeHistory(legacy),JSON.stringify(summarizeRecords(legacy)));
assert.equal((await request({action:'claim',birdId:id},false)).status,401);
let {lease}=await api({action:'claim',birdId:id});
assert.deepEqual(await readArchive(api,id,lease,'2026-09'),original);
await writeArchive(api,id,lease,'2026-09',original,summary);assert.equal(sql[0].prepare('SELECT shard FROM history_shard_routes WHERE month=?').get('2026-09').shard,'history');
const fresh=rows('2026-10',100);await writeArchive(api,id,lease,'2026-10',fresh,summarizeRecords(fresh));assert.equal(sql[0].prepare('SELECT shard FROM history_shard_routes WHERE month=?').get('2026-10').shard,'history2');assert.equal(sql[1].prepare("SELECT count(*) n FROM history_chunks WHERE month='2026-10'").get().n,0);
// Legacy pruning happens only after exact decoded readback through the new shard.
await writeArchive(api,id,lease,'2026-08',legacy,summarizeRecords(legacy));assert.equal(sql[0].prepare('SELECT count(*) n FROM history_chunks').get().n,0);
// An unfinished multipart generation never replaces the visible old manifest.
const previous=await readArchive(api,id,lease,'2026-10');const payload=encodeHistory(rows('2026-10',180)).toString('base64'),cut=Math.floor(payload.length/8)*4;
await api({action:'part',birdId:id,lease,month:'2026-10',part:0,data:payload.slice(0,cut),binary:true});
assert.equal((await request({action:'chunk',birdId:id,lease,month:'2026-10',data:`parts:${lease}:2`,summary:summarizeRecords(rows('2026-10',180))})).status,400);assert.deepEqual(await readArchive(api,id,lease,'2026-10'),previous);
// Restart/expired lease with changed shard sizes still uses the durable route.
sql[0].prepare("UPDATE sync_state SET payload=json_set(payload,'$.expiresAt',0) WHERE id=?").run('history-lock:'+id);sizes=[900000,100000000,200000000];
const oldLease=lease;({lease}=await api({action:'claim',birdId:id}));assert.notEqual(lease,oldLease);
for(let part=0;part<2;part++)await api({action:'part',birdId:id,lease,month:'2026-10',part,data:part?payload.slice(cut):payload.slice(0,cut),binary:true});
failManifest=true;await assert.rejects(api({action:'chunk',birdId:id,lease,month:'2026-10',data:`parts:${lease}:2`,summary:summarizeRecords(rows('2026-10',180))}),/Simulated manifest/);assert.deepEqual(await readArchive(api,id,lease,'2026-10'),previous);
await api({action:'chunk',birdId:id,lease,month:'2026-10',data:`parts:${lease}:2`,summary:summarizeRecords(rows('2026-10',180))});assert.deepEqual(await readArchive(api,id,lease,'2026-10'),rows('2026-10',180));assert.equal(sql[2].prepare('SELECT count(*) n FROM history_parts WHERE generation=?').get(oldLease).n,0);
// New months balance by physical size, not by bird count. Full-resolution records survive.
const season=rows('2026-01',10000);await writeArchive(api,id,lease,'2026-01',season,summarizeRecords(season));assert.equal(sql[0].prepare("SELECT shard FROM history_shard_routes WHERE month='2026-01'").get().shard,'history');assert.deepEqual(await readArchive(api,id,lease,'2026-01'),season);
// Unavailable/full shards refuse allocation without deleting or rewriting existing chunks.
sizes=[900000,450000000,450000000];await assert.rejects(writeArchive(api,id,lease,'2026-11',rows('2026-11'),summary),/headroom/);assert.deepEqual(await readArchive(api,id,lease,'2026-10'),rows('2026-10',180));
sizes=[900000,100000000,200000000];
const get=async()=>{const r=await GET(new Request('https://fixture.test/api/history?bird='+encodeURIComponent(id)+'&timeline=1'));assert.equal(r.status,200);return r.json();};
const profile=await get();assert.equal(profile.records,10300);assert.equal(profile.months.length,4);
// Public profiles and rankings agree across shards, with unchanged arrival rules.
for(const month of ['2026-01','2026-08','2026-09','2026-10']){const route=sql[0].prepare('SELECT shard FROM history_shard_routes WHERE month=?').get(month).shard;const db=sql[route==='history'?1:2];const row=db.prepare('SELECT summary FROM history_chunks WHERE month=?').get(month);const m={version:4,boundaryVersion:'fixture',valid:1,first:{at:month+'-01T00:00:00Z',position:'outside'},last:{at:month+'-01T00:00:00Z',position:'outside'},inside:null};await api({action:'migrationSummary',birdId:id,lease,month,expectedSummary:row.summary,migration:m});}
const rank=await api({action:'rankings',birdId:id,lease});const priorProfile=await get();assert.equal(rank.ranking.attempts,priorProfile.migration.attempts);
const savedSecond=globalThis.shardEnv.HISTORY_ARCHIVE_2;delete globalThis.shardEnv.HISTORY_ARCHIVE_2;await assert.rejects(get(),/binding missing/);globalThis.shardEnv.HISTORY_ARCHIVE_2=savedSecond;
// Restore all three SQLite stores, including directory and multipart bytes, then use real readers.
const restored=sql.map(source=>{const target=new DatabaseSync(':memory:');const defs=source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();for(const d of defs.filter(d=>d.type==='table'))target.exec(d.sql);for(const d of defs.filter(d=>d.type==='table'))for(const row of source.prepare('SELECT * FROM '+d.name).all())target.prepare('INSERT INTO '+d.name+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));for(const d of defs.filter(d=>d.type!=='table'))target.exec(d.sql);assert.equal(target.prepare('PRAGMA integrity_check').get().integrity_check,'ok');return target;});
const old=sql;sql=restored;assert.deepEqual(await get(),priorProfile);assert.deepEqual(await readArchive(api,id,lease,'2026-10'),rows('2026-10',180));assert.deepEqual((await api({action:'rankings',birdId:id,lease})).ranking,rank.ranking);for(const db of old)db.close();
// Eight archive bindings plus main still fit the free request budget; no paid resources.
for(let i=3;i<=8;i++){const db=new DatabaseSync(':memory:');db.exec(readFileSync('drizzle-history/0000_archive.sql','utf8'));sql.push(db);sizes.push(16384+i);globalThis.shardEnv['HISTORY_ARCHIVE_'+i]=adapter(i);}
globalThis.shardEnv.HISTORY_SHARD_COUNT='8';await writeArchive(api,id,lease,'2026-11',rows('2026-11'),summarizeRecords(rows('2026-11')));assert.equal(sql[0].prepare("SELECT shard FROM history_shard_routes WHERE month='2026-11'").get().shard,'history3');
await api({action:'release',birdId:id,lease});
// Existing lifecycle policy cleans every shard and directory but keeps a past league record.
const past={id:'past',year:2025,status:'ready',size:1,members:[{id:'a'}],picks:[{birdId:id,userId:'a'}]};sql[0].prepare('INSERT INTO leagues VALUES(?,?,0)').run('past',JSON.stringify(past));sql[0].prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({...bird,recordedDead:true}),id);
await cleanupBirds(now);for(const db of sql)assert.equal(db.prepare('SELECT count(*) n FROM history_chunks').get().n,0);assert.equal(sql[0].prepare('SELECT count(*) n FROM history_shard_routes').get().n,0);assert.ok(JSON.parse(sql[0].prepare('SELECT state FROM leagues').get().state).picks[0].bird);
mkdirSync('.runner/sharding',{recursive:true});writeFileSync('.runner/sharding/report.json',JSON.stringify({stores:3,fullResolutionRecords:season.length,multipartInterruptedAndResumed:true,restoredProfileAndRankingsMatch:true,maxQueries,externalCalls:0,emails:0},null,2));
console.log('PASS: multi-shard routing, exact full-resolution round trips, interruption/retry, stable multipart generations, legacy verification, storage guards, missing binding failure, profile/ranking parity, isolated restore and lifecycle cleanup. Maximum handler queries:',maxQueries);
for(const db of sql)db.close();globalThis.Date=RealDate;
