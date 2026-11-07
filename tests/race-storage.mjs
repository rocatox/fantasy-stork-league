import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {standings} from '../lib/race.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,invite TEXT,revision INTEGER);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));sql.exec(readFileSync('drizzle/0008_notification_outbox.sql','utf8'));sql.exec(readFileSync('drizzle/0016_race_notification_cycles.sql','utf8'));sql.exec('DROP TRIGGER notification_league_insert; DROP TRIGGER notification_league_update;');
const queries=[];
const db={prepare(query){queries.push(query);const s=sql.prepare(query);const bound=(args=[])=>({async run(){return {meta:{changes:Number(s.run(...args).changes)}};},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.raceTestEnv={DB:db,SYNC_SECRET:'test-only'};
globalThis.raceTestUser={userId:'owner',displayName:'Owner'};
const plugins=[{name:'test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/lib\/auth$/},()=>({path:'auth',namespace:'test'}));b.onResolve({filter:/lib\/profiles$/},()=>({path:'profiles',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.raceTestEnv;':a.path==='auth'?'export const getUser=async()=>globalThis.raceTestUser;':'export const nameLeagues=async l=>l;'}));}}];
await build({entryPoints:['lib/race-endpoint.ts','app/api/leagues/route.ts'],outdir:'.runner/race-storage',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins});
const {POST}=await import('../.runner/race-storage/lib/race-endpoint.mjs');
const {GET}=await import('../.runner/race-storage/app/api/leagues/route.mjs');
const boundary=JSON.parse(readFileSync('data/boundary-source.json')).version;
const year=2026,birdId='24442409:Simulation',otherId='24442409:No arrival';
const league={id:'private-league',year,status:'ready',size:1,members:[{id:'owner',name:'Owner'},{id:'friend',name:'Friend'}],picks:[{birdId,userId:'owner'},{birdId:otherId,userId:'friend'}]};
sql.prepare('INSERT INTO leagues VALUES(?,?,?,0)').run(league.id,JSON.stringify(league),'private-invite');
const post=(body,auth=true)=>POST(new Request('https://app.test/api/race',{method:'POST',headers:{...(auth?{authorization:'Bearer test-only'}:{})},body:JSON.stringify(body)}));
assert.equal((await post({action:'queue'},false)).status,401);
assert.equal((await (await post({action:'queue'})).json()).targets.length,2);
assert.equal((await (await post({action:'queue'})).json()).migrationStartVersion,2);
// A replacement flag must not exclude a bird from reconciliation.
league.picks[0].replacementRequired={reason:'inactive',detectedAt:'2026-01-10T00:00:00Z'};
sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(league),league.id);
assert.equal((await (await post({action:'queue'})).json()).targets.length,2);
delete league.picks[0].replacementRequired;
sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(league),league.id);

queries.length=0;
let claim=await (await post({action:'claim',birdId,year})).json();assert.ok(claim.lease);
assert.ok(!queries.includes("SELECT state FROM leagues WHERE json_extract(state,'$.status')='ready'"),'claim must not materialize every ready league');
assert.ok(!queries.includes('SELECT payload FROM birds'),'claim must not read the full bird roster');
assert.equal((await post({action:'claim',birdId:'24442409:Not drafted',year})).status,400);
assert.equal((await post({action:'claim',birdId,year:new Date().getUTCFullYear()+1})).status,400);
assert.equal((await post({action:'claim',birdId,year})).status,409);
const arrival={eventId:'event-1',observedAt:'2026-03-01T12:00:00.000Z',longitude:13.4,latitude:52.5,tagId:'tag',qualityVersion:4,support:'repeat-inside',confirmation:{eventId:'proof',observedAt:'2026-03-01T12:10:00.000Z',longitude:13.4,latitude:52.5,tagId:'tag'}};
// A signed writer must still provide inside-Germany corroboration.

const makeResult=()=>({arrival,eventRows:2,validFixes:2,boundaryFixes:0,individualId:'123',boundaryVersion:boundary,startedAt:new Date().toISOString()});
assert.equal((await post({action:'commit',birdId,year,lease:'bad',result:makeResult()})).status,409);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),boundaryVersion:'wrong'}})).status,400);
for(const bad of [{...arrival,confirmation:undefined},{...arrival,qualityVersion:1},{...arrival,longitude:2,confirmation:{...arrival.confirmation,longitude:2}},{...arrival,confirmation:{...arrival.confirmation,eventId:arrival.eventId}},{...arrival,confirmation:{...arrival.confirmation,tagId:'wrong-tag'}}])assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),arrival:bad}})).status,400);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()})).status,200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM race_audit').get().n,1);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()})).status,409,'retry cannot duplicate commit');
const payload=()=>JSON.parse(sql.prepare('SELECT payload FROM race_results WHERE bird_id=?').get(birdId).payload);
const unchanged=payload();claim=await (await post({action:'claim',birdId,year})).json();
await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()});
assert.equal(payload().revision,unchanged.revision);assert.equal(payload().changedAt,unchanged.changedAt);
// Source failure/empty export must preserve last committed evidence.
claim=await (await post({action:'claim',birdId,year})).json();
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),eventRows:0,validFixes:0,arrival:null}})).status,409);
assert.deepEqual(payload().arrival,arrival);
// A nonempty full reconciliation can retract a source-corrected or withdrawn event.
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),arrival:null}})).status,200);
assert.equal(payload().arrival,null);assert.equal(payload().revision,2);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM race_audit').get().n,2);
// Expired leases cannot overwrite the result.
claim=await (await post({action:'claim',birdId,year})).json();sql.prepare("UPDATE sync_state SET payload=json_set(payload,'$.expiresAt',0)").run();
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()})).status,409);
// Full private-league API includes standings only for members.
let response=await (await GET(new Request('https://app.test/api/leagues'))).json();assert.equal(response.leagues.length,1);assert.ok(response.leagues[0].standings);assert.equal(response.leagues[0].standings.birds.length,2);
globalThis.raceTestUser={userId:'outsider'};response=await (await GET(new Request('https://app.test/api/leagues'))).json();assert.deepEqual(response.leagues,[]);
globalThis.raceTestUser=null;response=await (await GET(new Request('https://app.test/api/leagues'))).json();assert.deepEqual(response.leagues,[]);
// A supported single-fix brief crossing passes the same server validation as the collector.
claim=await (await post({action:'claim',birdId,year})).json();
const brief={...arrival,longitude:6.731,latitude:52.633,support:'surrounding',before:{eventId:'approach',observedAt:'2026-03-01T11:55:00.000Z',longitude:6.741,latitude:52.646,tagId:'tag'},confirmation:{eventId:'departure',observedAt:'2026-03-01T12:05:00.000Z',longitude:6.704,latitude:52.63,tagId:'tag'}};
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),arrival:brief,eventRows:3,validFixes:3}})).status,200);
console.log('PASS: race writer auth, leases, validation, replay protection, transactional evidence/audit, unchanged-result stability, corrections, failure preservation and member-only standings.');
const {migrationStart}=await import('../lib/migration-start.mjs');
const points=[35,35,35,35,35,36,37,38,38].flatMap((lat,i)=>[0,1].map(h=>[-5,lat,new Date(Date.parse('2026-02-01T08:00:00Z')+i*86400000+h*3600000).toISOString(),{tagId:'tag',eventId:`departure-${i}-${h}`} ]));
const departure=migrationStart(points,{start:Date.parse('2026-01-16T05:00Z'),end:Date.parse('2026-07-01T04:00Z')});assert.ok(departure);
claim=await (await post({action:'claim',birdId,year})).json();
const departureResult={...makeResult(),migrationStartVersion:2,migrationStart:departure,eventRows:20,validFixes:20};
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...departureResult,migrationStart:{...departure,evidence:[]}}})).status,400);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:departureResult})).status,200);
assert.equal(payload().migrationStart.observedAt,departure.observedAt);
const viewed=standings(league,[payload()],Date.now());assert.equal(viewed.birds.find(b=>b.birdId===birdId).migrationStart.observedAt,departure.observedAt);assert.ok(!JSON.stringify(viewed.birds.find(b=>b.birdId===birdId).migrationStart).includes('longitude'));
console.log('PASS: migration-start evidence validated at commit and exposed without GPS evidence.');
// Both supported stopover lengths are revalidated by the deployed write path.
for(const lats of [[35,35,35,35,35,36,36,37,38,38],[35,35,35,35,35,36,36,37,37,38,38]]){
 const rows=lats.flatMap((lat,i)=>[0,1].map(h=>[-5,lat,new Date(Date.parse('2026-02-01T08:00:00Z')+i*86400000+h*3600000).toISOString(),{tagId:'tag',eventId:`stopover-${i}-${h}`} ]));
 const signal=migrationStart(rows,{start:Date.parse('2026-01-16T05:00Z'),end:Date.parse('2026-07-01T04:00Z')});assert.equal(signal.evidence.length,rows.length);
 const next={...makeResult(),migrationStartVersion:2,migrationStart:signal,eventRows:rows.length+2,validFixes:rows.length+2};claim=await (await post({action:'claim',birdId,year})).json();
 assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...next,validFixes:18}})).status,400);
 assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...next,migrationStartVersion:1}})).status,400);
 const previous=payload();assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:next})).status,200);
 assert.equal(payload().revision,previous.revision,'Departure updates do not change arrival scoring revision');assert.equal(payload().changedAt,previous.changedAt);
}
console.log('PASS: v2 stopover evidence lengths, insufficient fixes and legacy-version rejection, stable race scoring.');
// A writer cannot contaminate a closed/expired cycle or cross another runner's boundary.
const cycle=await (await post({action:'cycle-begin'})).json();assert.ok(cycle.cycleId);
assert.equal((await post({action:'claim',birdId,year})).status,409);
assert.equal((await post({action:'claim',birdId,year,cycleId:'wrong'})).status,409);
claim=await (await post({action:'claim',birdId,year,cycleId:cycle.cycleId})).json();assert.ok(claim.lease);
await post({action:'cycle-end',cycleId:cycle.cycleId});const closed=payload();
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()})).status,409);assert.deepEqual(payload(),closed);
await post({action:'release',birdId,year,lease:claim.lease});
const expiredCycle=await (await post({action:'cycle-begin'})).json();
claim=await (await post({action:'claim',birdId,year,cycleId:expiredCycle.cycleId})).json();
sql.prepare('UPDATE race_notification_cycles SET expires_at=0 WHERE id=?').run(expiredCycle.cycleId);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:makeResult()})).status,409);assert.deepEqual(payload(),closed);
await post({action:'release',birdId,year,lease:claim.lease});
assert.equal((await post({action:'cycle-begin'})).status,200,'a new runner can recover an expired cycle');
console.log('PASS: cycle ownership, late/expired commit rejection and takeover without overwriting evidence.');
sql.close();
