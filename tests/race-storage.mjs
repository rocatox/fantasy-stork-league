import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {standings} from '../lib/race.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,invite TEXT,revision INTEGER);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));
const db={prepare(query){const s=sql.prepare(query);const bound=(args=[])=>({async run(){return {meta:{changes:Number(s.run(...args).changes)}};},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
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
// An unreplaced pre-season loss stays in standings, but is not imported as a racer.
league.picks[0].replacementRequired={reason:'inactive',detectedAt:'2026-01-10T00:00:00Z'};
sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(league),league.id);
assert.equal((await (await post({action:'queue'})).json()).targets.length,1);
delete league.picks[0].replacementRequired;
sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(league),league.id);

let claim=await (await post({action:'claim',birdId,year})).json();assert.ok(claim.lease);
assert.equal((await post({action:'claim',birdId,year})).status,409);
const arrival={eventId:'event-1',observedAt:'2026-03-01T12:00:00.000Z',longitude:13.4,latitude:52.5,tagId:'tag'};
const makeResult=()=>({arrival,eventRows:2,validFixes:2,boundaryFixes:0,individualId:'123',boundaryVersion:boundary,startedAt:new Date().toISOString()});
assert.equal((await post({action:'commit',birdId,year,lease:'bad',result:makeResult()})).status,409);
assert.equal((await post({action:'commit',birdId,year,lease:claim.lease,result:{...makeResult(),boundaryVersion:'wrong'}})).status,400);
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
console.log('PASS: race writer auth, leases, validation, replay protection, transactional evidence/audit, unchanged-result stability, corrections, failure preservation and member-only standings.');
sql.close();
