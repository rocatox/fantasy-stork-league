// Exercise the real endpoint and SQL with an isolated in-memory SQLite database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
sql.exec(readFileSync('drizzle/0002_history.sql','utf8'));
sql.exec(readFileSync('drizzle/0003_history_parts.sql','utf8'));
const db={prepare(query){const statement=sql.prepare(query);return {bind(...values){return {async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};}}},async all(){return {results:statement.all()};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__historyTestEnv={DB:db,SYNC_SECRET:'local-test-only'};
await build({entryPoints:['lib/history-endpoint.ts'],outfile:'.runner/history-endpoint-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'test-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__historyTestEnv;',loader:'js'}));}}]});
const {POST,GET}=await import('../.runner/history-endpoint-test.mjs');
const bird={id:'24442409:History test',name:'History test',studyId:'24442409',latestValidFixUtc:new Date().toISOString(),distanceToGermanyMiles:800,countryCode:'ES',currentDeployment:true,recordedDead:false,reviewRequired:false};
sql.prepare('INSERT INTO birds VALUES(?,?)').run(bird.id,JSON.stringify(bird));
async function post(body,authorized=true){return POST(new Request('https://example.test/api/history',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer local-test-only'}:{})},body:JSON.stringify(body)}));}
assert.equal((await post({action:'queue'},false)).status,401);
assert.equal((await post({action:'queue'})).status,200);
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state WHERE bird_id=?').get(bird.id).payload).complete,false);
// The first-eligibility queue survives a bird becoming stale before its backfill.
bird.latestValidFixUtc='2000-01-01T00:00:00Z';sql.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify(bird),bird.id);
const queue=await (await post({action:'queue'})).json();assert.ok(queue.birds.some(b=>b.id===bird.id));
const {lease}=await (await post({action:'claim',birdId:bird.id})).json();assert.ok(lease);
assert.equal((await post({action:'claim',birdId:bird.id})).status,409);
const summary={records:1,valid:1,first:'2014-06-01T00:00:00Z',last:'2014-06-01T00:00:00Z',preview:[[10,40,'2014-06-01T00:00:00Z']]};
assert.equal((await post({action:'chunk',birdId:bird.id,lease:'wrong',month:'2014-06',data:'opaque',summary})).status,409);
assert.equal((await post({action:'chunk',birdId:bird.id,lease,month:'2014-06',data:'opaque',summary})).status,200);
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
assert.equal((await post({action:'chunks',birdId:bird.id,lease:next.lease,chunks:[{month:'2026-10',data:'new',summary:{...summary,first:'2026-10-01T00:00:00Z',last:'2026-10-01T00:00:00Z'}}]})).status,200);
await post({action:'complete',birdId:bird.id,lease:next.lease,startedAt:new Date().toISOString(),slot:'test',individualId:'123'});
const result=await (await GET(new Request('https://example.test/api/history?bird='+encodeURIComponent(bird.id)+'&year=2014'))).json();
assert.equal(result.state.complete,true);assert.equal(result.records,2);assert.deepEqual(result.years,['2014','2026']);assert.equal(result.points.length,1);
assert.equal(result.first,'2014-06-01T00:00:00Z');
console.log('PASS: durable eligibility queue, exclusive leases, denied writes, partial-import recovery, cursor completion, and old/new history coexistence.');
sql.close();
