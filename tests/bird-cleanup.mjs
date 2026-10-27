import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const RealDate=Date;const clock=Date.parse('2026-10-27T20:00:00Z');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const sql=new DatabaseSync(':memory:'),archive=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER DEFAULT 0);');
for(const f of ['0002_history.sql','0003_history_parts.sql','0004_race.sql'])sql.exec(readFileSync('drizzle/'+f,'utf8'));
archive.exec(readFileSync('drizzle-history/0000_archive.sql','utf8'));
const adapter=s=>({prepare(q){const stmt=s.prepare(q);const bound=(args=[])=>({async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};},async batch(statements){s.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());s.exec('COMMIT');return out;}catch(e){s.exec('ROLLBACK');throw e;}}});
globalThis.cleanupEnv={DB:adapter(sql),HISTORY_ARCHIVE:adapter(archive),SYNC_SECRET:'fixture'};
await build({entryPoints:['lib/bird-cleanup.ts','lib/history-endpoint.ts','lib/snapshot-endpoint.ts','lib/store.ts'],outdir:'.runner/lifecycle',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.cleanupEnv;',loader:'js'}));}}]});
const {cleanupBirds}=await import('../.runner/lifecycle/bird-cleanup.mjs');
const {getBirds}=await import('../.runner/lifecycle/store.mjs');
const {POST,GET}=await import('../.runner/lifecycle/history-endpoint.mjs');
const {POST:sync}=await import('../.runner/lifecycle/snapshot-endpoint.mjs');
const now=Date.now(),offseason=Date.parse('2027-08-01T12:00:00Z');
const bird={id:'24442409:Fixture',name:'Fixture',studyId:'24442409',ringId:'R123',recordedDead:true,currentDeployment:true,reviewRequired:false,latestValidFixUtc:new Date(now).toISOString(),latitude:40,longitude:2,distanceToGermanyMiles:500,history:[]};
sql.prepare('INSERT INTO birds VALUES(?,?)').run(bird.id,JSON.stringify(bird));
const league={id:'past',year:2027,picks:[{birdId:bird.id,userId:'owner'}],members:[{id:'owner'}]};
sql.prepare('INSERT INTO leagues(id,state) VALUES(?,?)').run(league.id,JSON.stringify(league));
sql.prepare('INSERT INTO history_state VALUES(?,?)').run(bird.id,'{"complete":true}');
for(const db of [sql,archive]){db.prepare('INSERT INTO history_chunks VALUES(?,?,?,?)').run(bird.id,'2026-10','data','{}');db.prepare('INSERT INTO history_parts VALUES(?,?,?,?,?)').run(bird.id,'2026-10','old',0,'data');}
sql.prepare('INSERT INTO race_results VALUES(?,?,?)').run(bird.id,2027,'{"points":12}');
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('metadata:24442409',JSON.stringify({individuals:[{id:'1',local_identifier:'Fixture'}],deployments:[{individual_id:'1'}]}));
// A protected season never purges; a writer finishing at the grace boundary is allowed to drain.
assert.deepEqual(await cleanupBirds(Date.parse('2027-07-30T12:00:00Z')),[]);
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('history-lock:'+bird.id,JSON.stringify({lease:'old',expiresAt:offseason+1000}));
assert.deepEqual(await cleanupBirds(offseason),[]);
sql.prepare('DELETE FROM sync_state WHERE id=?').run('history-lock:'+bird.id);
assert.deepEqual(await cleanupBirds(offseason),[bird.id]);assert.deepEqual(await cleanupBirds(offseason),[]);
assert.equal((await getBirds()).length,0); // No seed resurrection.
for(const db of [sql,archive])for(const table of ['history_chunks','history_parts'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM history_state').get().n,0);
const preserved=JSON.parse(sql.prepare('SELECT state FROM leagues').get().state);
assert.equal(preserved.picks[0].bird.name,'Fixture');assert.equal(preserved.picks[0].userId,'owner');
assert.equal(sql.prepare('SELECT payload FROM race_results').get().payload,'{"points":12}');
assert.equal(JSON.parse(sql.prepare("SELECT payload FROM sync_state WHERE id='metadata:24442409'").get().payload).individuals.length,0);
const request=body=>new Request('https://test/api/history',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)});
assert.equal((await POST(request({action:'claim',birdId:bird.id}))).status,400);
assert.equal((await POST(request({action:'chunk',birdId:bird.id,lease:'old'}))).status,409);
assert.equal((await GET(new Request('https://test/api/history?bird='+encodeURIComponent(bird.id)))).status,404);
// A later fresh observation can rediscover an inactive bird and queue a full backfill.
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('external-sync-lock',JSON.stringify({lease:'new',studyId:bird.studyId,expiresAt:now+60000}));
const stamp=new Date(now).toISOString();
const response=await sync(request({action:'commit',lease:'new',studyId:bird.studyId,birds:[{...bird,recordedDead:false}],metadata:{individuals:[{id:'1',local_identifier:'Fixture'}],deployments:[{individual_id:'1'}]},state:{lastSuccessAt:stamp,lastSuccessSlot:'test'},report:{startedAt:stamp,lastSuccessAt:stamp,studyId:bird.studyId,status:'succeeded'}}));
assert.equal(response.status,200);assert.equal((await getBirds()).length,1);
assert.equal(JSON.parse(sql.prepare('SELECT payload FROM history_state').get().payload).complete,false);
assert.equal(JSON.parse(sql.prepare('SELECT state FROM leagues').get().state).picks[0].bird.name,'Fixture');
// A mortality update must replace the previously active row before cleanup, not be silently filtered out.
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('external-sync-lock',JSON.stringify({lease:'death',studyId:bird.studyId,expiresAt:now+60000}));
assert.equal((await sync(request({action:'commit',lease:'death',studyId:bird.studyId,birds:[bird],metadata:{individuals:[{id:'1',local_identifier:'Fixture'}],deployments:[]},state:{lastSuccessAt:stamp,lastSuccessSlot:'death'},report:{startedAt:stamp,lastSuccessAt:stamp,studyId:bird.studyId,status:'succeeded'}}))).status,200);
assert.equal((await getBirds()).length,0);await cleanupBirds(now);assert.equal(sql.prepare('SELECT COUNT(*) n FROM birds').get().n,0);
console.log('PASS: seasonal protection, draining leases, both-database purge, league preservation, metadata cleanup, no seed resurrection, denied late writes, and fresh-data rediscovery.');
