// Exercise the real endpoint and SQL with an isolated in-memory SQLite database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);');
sql.exec(readFileSync('drizzle/0002_history.sql','utf8'));
sql.exec(readFileSync('drizzle/0003_history_parts.sql','utf8'));
const makeDb=(sql)=>({prepare(query){const statement=sql.prepare(query);return {bind(...values){return {async run(){const r=statement.run(...values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};}}},async all(){return {results:statement.all()};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}});
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
const {lease}=await (await post({action:'claim',birdId:bird.id})).json();assert.ok(lease);
assert.equal((await post({action:'claim',birdId:bird.id})).status,409);
const summary={records:1,valid:1,first:'2014-06-01T00:00:00Z',last:'2014-06-01T00:00:00Z',preview:[[10,40,'2014-06-01T00:00:00Z']]};
assert.equal((await post({action:'chunk',birdId:bird.id,lease:'wrong',month:'2014-06',data:'opaque',summary})).status,409);
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-06',data:'opaque',summary})).status,200);
// Derived summaries require the existing lease and matching archive revision.
const migration={version:1,boundaryVersion:'test',valid:1,first:{at:'2014-06-01T00:00:00Z',position:'outside'},last:{at:'2014-06-01T00:00:00Z',position:'outside'},inside:null};
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease:'wrong',month:'2014-06',expectedSummary:JSON.stringify(summary),migration})).status,409);
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease,month:'2014-06',expectedSummary:'{}',migration})).status,409);
assert.equal((await post({action:'migrationSummary',birdId:bird.id,lease,month:'2014-06',expectedSummary:JSON.stringify(summary),migration})).status,200);
const scouting=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)))).json();
assert.equal(scouting.migration.attempts,1);assert.equal(scouting.migration.successes,0);
const rankings=await (await GET(new Request('https://example.test/api/history?rankings=1'))).json();assert.equal(rankings.rankings[bird.id].attempts,1);assert.equal(rankings.rankings[bird.id].typicalArrival,null);
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
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT);');sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));
sql.prepare('INSERT INTO leagues VALUES(?,?)').run('r',JSON.stringify({year:2026,status:'ready',size:1,members:[{id:'a'},{id:'b'}],picks:[{birdId:bird.id,userId:'a'},{birdId:'other',userId:'b'}]}));
sql.prepare('INSERT INTO race_audit VALUES(?,?,?,?,?,?,?)').run('a',bird.id,2026,JSON.stringify({eventId:'old-arrival'}),JSON.stringify({eventId:'corrected-arrival'}),new Date().toISOString(),'boundary');
const policy=await (await post({action:'retention'})).json();assert.deepEqual(policy.protections[bird.id].heldYears,[2026]);assert.deepEqual(policy.protections[bird.id].pinnedIds,['old-arrival','corrected-arrival']);
archiveSql.close();
console.log('PASS: automatic discovery queue, exclusive leases, denied writes, multipart recovery, cursor completion, and archive preservation through normal syncing.');
sql.close();
