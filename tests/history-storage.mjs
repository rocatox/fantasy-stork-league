// Exercise the real endpoint and SQL with an isolated in-memory SQLite database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);');
sql.exec(readFileSync('drizzle/0002_history.sql','utf8'));
sql.exec(readFileSync('drizzle/0003_history_parts.sql','utf8'));
const queryLog=[];
const makeDb=(sql)=>({prepare(query){queryLog.push(query);const statement=sql.prepare(query);return {bind(...values){return {async run(){const r=statement.run(...values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};}}},async all(){return {results:statement.all()};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}});
const db=makeDb(sql);
globalThis.__historyTestEnv={DB:db,SYNC_SECRET:'local-test-only'};
await build({entryPoints:['lib/history-endpoint.ts'],outfile:'.runner/history-endpoint-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'test-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__historyTestEnv;',loader:'js'}));}}]});
const {POST,GET}=await import('../.runner/history-endpoint-test.mjs');
const bird={id:'24442409:History test',name:'History test',studyId:'24442409',latestValidFixUtc:new Date().toISOString(),distanceToGermanyMiles:800,countryCode:'ES',currentDeployment:true,recordedDead:false,reviewRequired:false};
sql.prepare('INSERT INTO birds VALUES(?,?)').run(bird.id,JSON.stringify(bird));
async function post(body,authorized=true){return POST(new Request('https://example.test/api/history',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer local-test-only'}:{})},body:JSON.stringify(body)}));}
assert.equal((await post({action:'queue'},false)).status,401);
assert.equal((await post({action:'queue'})).status,200);
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state WHERE bird_id=?').get(bird.id).payload).complete,false);
// A fresh queued bird remains available for backfill.
const queue=await (await post({action:'queue'})).json();assert.ok(queue.birds.some(b=>b.id===bird.id));
const requestedLease=crypto.randomUUID();
const {lease}=await (await post({action:'claim',birdId:bird.id,lease:requestedLease})).json();assert.equal(lease,requestedLease);
assert.equal((await (await post({action:'claim',birdId:bird.id,lease:requestedLease})).json()).lease,requestedLease);
assert.equal((await post({action:'claim',birdId:bird.id,lease:crypto.randomUUID()})).status,409);
assert.equal((await post({action:'claim',birdId:bird.id})).status,409);
const summary={records:1,valid:1,first:'2014-06-01T00:00:00Z',last:'2014-06-01T00:00:00Z',preview:[[10,40,'2014-06-01T00:00:00Z']]};
assert.equal((await post({action:'chunk',birdId:bird.id,lease:'wrong',month:'2014-06',data:'opaque',summary})).status,409);
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-06',data:'opaque',summary})).status,200);
// Recent map windows retain nearby screening context but exclude unrelated years.
const getWindow=async(start,end)=>GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)+'&start='+start+'&end='+end));
let windowResponse=await getWindow(Date.parse('2014-06-15'),Date.parse('2014-07-15'));assert.equal(windowResponse.status,200);assert.deepEqual((await windowResponse.json()).points,summary.preview);
assert.deepEqual((await (await getWindow(Date.parse('2020-01-01'),Date.parse('2020-01-31'))).json()).points,[]);
assert.equal((await getWindow(100,1)).status,400);assert.equal((await getWindow(0,371*86400000)).status,400);assert.equal((await getWindow('invalid',1)).status,400);
// Derived summaries require the existing lease and matching archive revision.
const migration={version:4,boundaryVersion:'test',valid:1,first:{at:'2014-06-01T00:00:00Z',position:'outside'},last:{at:'2014-06-01T00:00:00Z',position:'outside'},inside:null};
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease:'wrong',month:'2014-06',expectedSummary:JSON.stringify(summary),migration})).status,409);
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease,month:'2014-06',expectedSummary:'{}',migration})).status,409);
queryLog.length=0;
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease,month:'2014-06',expectedSummary:JSON.stringify(summary),migration})).status,200);
assert.ok(!queryLog.some(q=>q.startsWith('SELECT data FROM history_chunks')), 'statistics writes must never read archive BLOBs');
const scouting=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)))).json();
assert.equal(scouting.migration.attempts,1);assert.equal(scouting.migration.successes,0);
assert.equal((await post({action:'rankings',birdId:bird.id,lease:'wrong'})).status,409);
assert.equal((await post({action:'rankings',birdId:bird.id,lease})).status,200);
queryLog.length=0;
const rankings=await (await GET(new Request('https://example.test/api/history?rankings=1'))).json();assert.equal(rankings.rankings[bird.id].attempts,1);assert.equal(rankings.rankings[bird.id].typicalArrival,null);
// Ranking and profile endpoints include late arrivals after July, even with zero race successes.
const lateSummary={...summary,migration:{...migration,first:{at:'2014-09-10T00:00:00Z',position:'inside'},inside:{at:'2014-09-10T00:00:00Z',position:'inside'}}};
sql.prepare('INSERT INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?)').run(bird.id,'2014-09','test',JSON.stringify(lateSummary));
assert.equal((await post({action:'rankings',birdId:bird.id,lease})).status,200);
const lateRankings=await (await GET(new Request('https://example.test/api/history?rankings=1'))).json();
const lateProfile=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)))).json();
assert.equal(lateRankings.rankings[bird.id].typicalArrival,'09-10');
assert.equal(lateProfile.migration.typicalArrival,'09-10');assert.equal(lateProfile.migration.successes,0);
sql.prepare("DELETE FROM history_chunks WHERE month='2014-09'").run();
// A July correction invalidates June evidence that may rely on July corroboration.
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-07',data:'test',summary})).status,200);
assert.equal(JSON.parse(sql.prepare("SELECT summary FROM history_chunks WHERE month='2014-06'").get().summary).migration,undefined);
sql.prepare("DELETE FROM history_chunks WHERE month='2014-07'").run();
// Autumn updates cannot change spring evidence and must not force seasonal reprocessing.
sql.prepare("UPDATE history_chunks SET summary=? WHERE month='2014-06'").run(JSON.stringify({...summary,migration}));
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-10',data:'test',summary})).status,200);
assert.equal(JSON.parse(sql.prepare("SELECT summary FROM history_chunks WHERE month='2014-06'").get().summary).migration.version,4);
sql.prepare("DELETE FROM history_chunks WHERE month='2014-10'").run();
// December fixes provide context to the next spring, not to the previous spring.
sql.prepare('INSERT INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?)').run(bird.id,'2015-01','test',JSON.stringify({...summary,migration}));
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-12',data:'test',summary})).status,200);
assert.equal(JSON.parse(sql.prepare("SELECT summary FROM history_chunks WHERE month='2015-01'").get().summary).migration,undefined);
assert.equal(JSON.parse(sql.prepare("SELECT summary FROM history_chunks WHERE month='2014-06'").get().summary).migration.version,4);
sql.prepare("DELETE FROM history_chunks WHERE month IN ('2014-12','2015-01')").run();



// A partial import must not advance the source cursor or mark completion.
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state WHERE bird_id=?').get(bird.id).payload).complete,false);
await post({action:'release',birdId:bird.id,lease});
const next=await (await post({action:'claim',birdId:bird.id})).json();
assert.equal((await (await post({action:'read',birdId:bird.id,lease:next.lease,month:'2014-06'})).json()).data,'opaque');
// Incomplete multipart replacements cannot displace the last committed month.
await post({action:'part',birdId:bird.id,lease:next.lease,month:'2014-06',part:0,data:'first'});
assert.equal((await post({action:'chunk',birdId:bird.id,lease:next.lease,month:'2014-06',data:`parts:${next.lease}:2`,summary})).status,400);
assert.equal((await (await post({action:'read',birdId:bird.id,lease:next.lease,month:'2014-06'})).json()).data,'opaque');
await post({action:'part',birdId:bird.id,lease:next.lease,month:'2014-06',part:1,data:'second'});
assert.equal((await post({action:'chunk',birdId:bird.id,lease:next.lease,month:'2014-06',data:`parts:${next.lease}:2`,summary})).status,200);
assert.equal((await (await post({action:'read',birdId:bird.id,lease:next.lease,month:'2014-06'})).json()).data,'firstsecond');
const manifest=await (await post({action:'read',birdId:bird.id,lease:next.lease,month:'2014-06',manifest:true})).json();
assert.equal(manifest.parts.count,2);
assert.equal((await (await post({action:'readPart',birdId:bird.id,lease:next.lease,month:'2014-06',generation:manifest.parts.generation,part:1})).json()).data,'second');
assert.equal((await post({action:'chunks',birdId:bird.id,lease:next.lease,chunks:[{month:'2026-10',data:'new',summary:{...summary,first:'2026-10-01T00:00:00Z',last:'2026-10-01T00:00:00Z'}}]})).status,200);
await post({action:'complete',birdId:bird.id,lease:next.lease,startedAt:new Date().toISOString(),slot:'test',individualId:'123'});
const result=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)+'&year=2014'))).json();
assert.equal(result.state.complete,true);assert.equal(result.records,2);assert.deepEqual(result.years,['2014','2026']);assert.equal(result.points.length,1);
assert.equal(result.first,'2014-06-01T00:00:00Z');
const timeline=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)+'&timeline=1'))).json();assert.equal(timeline.points.length,2);assert.deepEqual(timeline.years,['2014','2026']);
// A newly eligible bird is queued atomically by the ordinary study-sync endpoint.
await build({entryPoints:['lib/snapshot-endpoint.ts'],outfile:'.runner/history-snapshot-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'test-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__historyTestEnv;',loader:'js'}));}}]});
const {POST:sync}=await import('../.runner/history-snapshot-test.mjs');
const now=new Date().toISOString(),discovered={...bird,id:'24442409:New discovery',name:'New discovery',latestValidFixUtc:now,latitude:40,longitude:-5,history:[]};
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('external-sync-lock',JSON.stringify({lease:'sync-test',studyId:'24442409',expiresAt:Date.now()+60000}));
const snapshot={action:'commit',studyId:'24442409',lease:'sync-test',birds:[discovered,{...discovered,id:'24442409:Research discovery',name:'Research discovery',countryCode:'DE',distanceToGermanyMiles:0}],metadata:{individuals:[],deployments:[]},state:{lastSuccessAt:now,lastSuccessSlot:'test'},report:{studyId:'24442409',status:'succeeded',lastSuccessAt:now,startedAt:now}};
const committed=await sync(new Request('https://example.test/api/sync',{method:'POST',headers:{Authorization:'Bearer local-test-only'},body:JSON.stringify(snapshot)}));
assert.equal(committed.status,200);
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state WHERE bird_id=?').get(discovered.id).payload).complete,false);
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state WHERE bird_id=?').get('24442409:Research discovery').payload).complete,false);
assert.equal((await post({action:'claim',birdId:'24442409:Research discovery'})).status,200);
assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM history_chunks WHERE bird_id=?').get(bird.id).count,2);
const archiveSql=new DatabaseSync(':memory:');archiveSql.exec(readFileSync('drizzle-history/0000_archive.sql','utf8'));globalThis.__historyTestEnv.HISTORY_ARCHIVE=makeDb(archiveSql);
const rollover=await (await post({action:'claim',birdId:bird.id})).json();
assert.equal((await (await post({action:'read',birdId:bird.id,lease:rollover.lease,month:'2014-06'})).json()).data,'firstsecond');
assert.equal((await post({action:'chunk',birdId:bird.id,lease:rollover.lease,month:'2014-06',data:'updated',summary})).status,200);
const combined=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)+'&year=2014'))).json();
assert.equal(combined.records,2);assert.equal(combined.points.length,1);
assert.equal((await (await post({action:'read',birdId:bird.id,lease:rollover.lease,month:'2014-06'})).json()).data,'updated');
assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM history_chunks').get().count,2);
assert.equal(archiveSql.prepare('SELECT COUNT(*) AS count FROM history_chunks').get().count,1);
// New BLOB archives round-trip through JSON and only verified replacements prune legacy.
const blobData=Buffer.from('binary archive bytes').toString('base64');
assert.equal((await post({action:'chunk',birdId:bird.id,lease:rollover.lease,month:'2014-06',data:blobData,binary:true,summary})).status,200);
assert.equal(archiveSql.prepare('SELECT typeof(data) AS kind FROM history_chunks').get().kind,'blob');
assert.equal((await (await post({action:'read',birdId:bird.id,lease:rollover.lease,month:'2014-06'})).json()).data,blobData);
assert.equal((await post({action:'pruneLegacy',birdId:bird.id,lease:rollover.lease,month:'2014-06',verifiedSummary:{...summary,records:999}})).status,409);
assert.equal((await post({action:'pruneLegacy',birdId:bird.id,lease:rollover.lease,month:'2014-06',verifiedSummary:summary})).status,200);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM history_chunks WHERE month='2014-06'").get().n,0);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM history_parts WHERE month='2014-06'").get().n,0);
// Retention context extends unresolved seasons and pins original/corrected arrival IDs.
sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));
sql.prepare('INSERT INTO leagues(id,state) VALUES(?,?)').run('r',JSON.stringify({year:2026,status:'ready',size:1,members:[{id:'a'},{id:'b'}],picks:[{birdId:bird.id,userId:'a'},{birdId:'other',userId:'b'}]}));
sql.prepare('INSERT INTO race_audit VALUES(?,?,?,?,?,?,?)').run('a',bird.id,2026,JSON.stringify({eventId:'old-arrival'}),JSON.stringify({eventId:'corrected-arrival',confirmation:{eventId:'confirmation-fix'},before:{eventId:'approach-fix'}}),new Date().toISOString(),'boundary');
const policy=await (await post({action:'retention'})).json();assert.deepEqual(policy.protections[bird.id].heldYears,[2026]);assert.deepEqual(policy.protections[bird.id].pinnedIds,['old-arrival','corrected-arrival','confirmation-fix','approach-fix']);
// Compact rankings must match full profile calculations, including overlapping stores,
// invalid versions, first-seen-inside seasons, late arrivals, and missing evidence.
for(let year=2001;year<=2025;year++)for(let month=1;month<=12;month++){
 const key=year+'-'+String(month).padStart(2,'0'),at=key+'-10T12:00:00.000Z';
 const migration={version:year%7===0&&month===2?3:4,first:month%3?{at,position:year%4===0?'inside':'outside'}:null,inside:month===(year%2?3:9)?{at}:null};
 const sum=JSON.stringify({records:1,valid:1,migration});
 sql.prepare('INSERT OR REPLACE INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?)').run(bird.id,key,'local-only',sum);
 if(year%5===0)archiveSql.prepare('INSERT OR REPLACE INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?)').run(bird.id,key,'local-only',JSON.stringify({records:1,valid:1,migration:{...migration,inside:null}}));
}
const fullProfile=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)))).json();
assert.equal((await post({action:'rankings',birdId:bird.id,lease:rollover.lease})).status,200);
queryLog.length=0;
const compactRanking=(await (await GET(new Request('https://example.test/api/history?rankings=1'))).json()).rankings[bird.id];
assert.ok(!queryLog.some(q=>q.includes('history_chunks')),'rankings reads must never scan archives');
assert.deepEqual(compactRanking,Object.fromEntries(['successes','attempts','pendingYears','typicalArrival'].map(k=>[k,fullProfile.migration[k]])));
console.log('PASS: compact rankings match full profiles across 25 synthetic years and archive precedence.');
// Version changes and invalidation cannot serve old derived results.
const saved=JSON.parse(sql.prepare('SELECT payload FROM sync_state WHERE id=?').get('ranking:'+bird.id).payload);
assert.equal(saved.rulesVersion,4);
sql.prepare('UPDATE sync_state SET payload=? WHERE id=?').run(JSON.stringify({...saved,rulesVersion:3}),'ranking:'+bird.id);
assert.equal((await (await GET(new Request('https://example.test/api/history?rankings=1'))).json()).rankings[bird.id].pendingYears,1);
await post({action:'rankings',birdId:bird.id,lease:rollover.lease});
assert.equal((await post({action:'chunk',birdId:bird.id,lease:rollover.lease,month:'2014-06',data:'changed',summary})).status,200);
assert.equal(sql.prepare('SELECT payload FROM sync_state WHERE id=?').get('ranking:'+bird.id),undefined);
assert.equal((await (await GET(new Request('https://example.test/api/history?rankings=1'))).json()).rankings[bird.id].pendingYears,1);
assert.equal((await post({action:'release',birdId:bird.id,lease:rollover.lease})).status,200);
assert.ok(sql.prepare('SELECT payload FROM sync_state WHERE id=?').get('ranking:'+bird.id));
assert.equal((await post({action:'rankings',birdId:bird.id,lease:rollover.lease})).status,409);
archiveSql.close();
console.log('PASS: automatic discovery queue, exclusive leases, denied writes, multipart recovery, cursor completion, and archive preservation through normal syncing.');
sql.close();
