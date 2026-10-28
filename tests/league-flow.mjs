import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {standings} from '../lib/race.mjs';
import {cutoff,turn} from '../lib/rules.mjs';
const RealDate=Date;let now=Date.parse('2027-01-10T12:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const sql=new DatabaseSync(':memory:');
sql.function('unixepoch',(_value)=>Math.floor(now/1000));
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,invite TEXT UNIQUE,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));
let conflict=false,advanceOnMetadata=false,advanceOnWrite=false;
const db={prepare(query){const stmt=sql.prepare(query);const bound=(args=[])=>({async run(){if(advanceOnWrite&&query.includes('unixepoch')){advanceOnWrite=false;now=cutoff(2027);}if(conflict&&query.startsWith('UPDATE leagues SET state=')){conflict=false;sql.prepare('UPDATE leagues SET revision=revision+1').run();}return {meta:{changes:Number(stmt.run(...args).changes)}};},async first(){if(advanceOnMetadata&&query.includes('SELECT payload FROM sync_state')){advanceOnMetadata=false;now=cutoff(2027);}return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};}};
globalThis.leagueEnv={DB:db,SYNC_SECRET:'fixture'};globalThis.leagueUser={userId:'owner',displayName:'Owner'};
await build({entryPoints:['app/api/leagues/route.ts','lib/disband.ts','lib/snapshot-endpoint.ts'],outdir:'.runner/league-flow',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/lib\/(auth|profiles)$/},a=>({path:a.path.split('/').pop(),namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.leagueEnv;':a.path==='auth'?'export const getUser=async()=>globalThis.leagueUser;':'export const nameLeagues=async l=>l;'}));b.onLoad({filter:/data[\\/]seed\.json$/},()=>({loader:'json',contents:JSON.stringify({birds:[],studies:[{studyId:'10449318'}]})}));}}]});
const {GET,POST}=await import('../.runner/league-flow/app/api/leagues/route.mjs');
const {disbandExpired}=await import('../.runner/league-flow/lib/disband.mjs');
const {POST:sync}=await import('../.runner/league-flow/lib/snapshot-endpoint.mjs');
const boundary=JSON.parse(readFileSync('data/boundary-source.json')).version;
const user=id=>globalThis.leagueUser=id?{userId:id,displayName:id}:null;
const post=async(body,status=200,headers={})=>{const r=await POST(new Request('https://app.test/api/leagues',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json',...headers},body:JSON.stringify(body)}));const data=await r.json();assert.equal(r.status,status,JSON.stringify({body,data}));return data.league||data;};
const get=async()=> (await GET(new Request('https://app.test/api/leagues'))).json();
const stored=id=>JSON.parse(sql.prepare('SELECT state FROM leagues WHERE id=?').get(id).state);
function seedBirds(count){sql.exec('DELETE FROM birds');const animals=[];for(let i=0;i<count;i++){const b={id:'bird-'+i,name:'Bird '+i,studyId:'10449318',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:500,countryCode:'ES',currentDeployment:true,boundaryVersion:boundary};sql.prepare('INSERT INTO birds VALUES(?,?)').run(b.id,JSON.stringify(b));animals.push({id:String(i+1),local_identifier:b.name});}sql.prepare('INSERT OR REPLACE INTO sync_state VALUES(?,?)').run('metadata:10449318',JSON.stringify({individuals:animals}));}
const changeBird=(id,changes)=>{const b=JSON.parse(sql.prepare('SELECT payload FROM birds WHERE id=?').get(id).payload);sql.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({...b,...changes}),id);};
async function league(players){user('owner');let l=await post({action:'create',name:'Test flock'});for(let i=1;i<players;i++){user('p'+i);l=await post({action:'join',invite:l.invite});}user('owner');return l;}
// Authentication, origin and malformed requests.
user(null);await post({action:'create',name:'x'},401);assert.deepEqual((await get()).leagues,[]);
user('owner');await post({action:'create',name:'x'},403,{origin:'https://evil.test'});await post(null,400);await post([],400);await post({action:'create',name:' '},400);
// Invite redemption, rotation, privacy, eight-player limit and owner-only controls.
seedBirds(30);let l=await league(2);const oldInvite=l.invite;
user('outsider');assert.deepEqual((await get()).leagues,[]);await post({action:'start',id:l.id},404);await post({action:'join',invite:'invalid'},404);
user('p1');await post({action:'rotateInvite',id:l.id},403);await post({action:'start',id:l.id},409);assert.equal((await post({action:'join',invite:l.invite})).members.length,2);
user('owner');l=await post({action:'rotateInvite',id:l.id});assert.notEqual(l.invite,oldInvite);
user('p2');await post({action:'join',invite:oldInvite},404);l=await post({action:'join',invite:'  '+l.invite+'  '});
for(let i=3;i<8;i++){user('p'+i);l=await post({action:'join',invite:l.invite});}user('p8');await post({action:'join',invite:l.invite},409);
user('owner');l=await post({action:'start',id:l.id});assert.equal(l.size,3);assert.equal(new Set(l.members.map(m=>m.id)).size,8);
user('p8');await post({action:'join',invite:l.invite},409);
// Full snake draft, no duplicate picks and rejection of all invalid eligibility states.
const order=l.members.map(m=>m.id);assert.deepEqual(Array.from({length:24},(_,i)=>order[turn(i,8)]),[...order,...order.toReversed(),...order]);
user(order[1]);await post({action:'pick',id:l.id,birdId:'bird-0'},409);
user(order[0]);for(const patch of [{distanceToGermanyMiles:450},{countryCode:'DE'},{recordedDead:true},{currentDeployment:false},{reviewRequired:true},{latestValidFixUtc:'2026-01-01T00:00:00Z'},{latestValidFixUtc:'2028-01-01T00:00:00Z'},{boundaryVersion:'old'}]){seedBirds(30);changeBird('bird-0',patch);await post({action:'pick',id:l.id,birdId:'bird-0'},409);}seedBirds(30);
sql.prepare('DELETE FROM sync_state WHERE id=?').run('metadata:10449318');await post({action:'pick',id:l.id,birdId:'bird-0'},409);seedBirds(30);
for(let i=0;i<24;i++){user(order[turn(i,8)]);if(i)await post({action:'pick',id:l.id,birdId:'bird-0'},409);l=await post({action:'pick',id:l.id,birdId:'bird-'+i});}
assert.equal(l.status,'ready');for(const id of order)assert.equal(l.picks.filter(p=>p.userId===id).length,3);await post({action:'pick',id:l.id,birdId:'bird-24'},409);
const readyId=l.id;let readyPicks=l.picks;
// Replacement picks bypass snake turns but preserve ownership, size, eligibility,
// per-league uniqueness and optimistic concurrency.
changeBird('bird-0',{recordedDead:true});
changeBird('bird-1',{latestValidFixUtc:'2026-11-01T00:00:00Z'});
user(order[0]);await get();
assert.equal(stored(readyId).picks[0].replacementRequired.reason,'deceased');
assert.equal(stored(readyId).picks[1].replacementRequired.reason,'inactive');
user(order[1]);await post({action:'replace',id:readyId,originalBirdId:'bird-0',birdId:'bird-24'},409);
await post({action:'replace',id:readyId,originalBirdId:'bird-1',birdId:'bird-2'},409);
changeBird('bird-24',{distanceToGermanyMiles:450});
await post({action:'replace',id:readyId,originalBirdId:'bird-1',birdId:'bird-24'},409);
changeBird('bird-24',{distanceToGermanyMiles:500});
conflict=true;await post({action:'replace',id:readyId,originalBirdId:'bird-1',birdId:'bird-24'},409);
assert.equal(stored(readyId).picks[1].birdId,'bird-1');
l=await post({action:'replace',id:readyId,originalBirdId:'bird-1',birdId:'bird-24'});
assert.equal(l.picks.length,24);assert.equal(l.size,3);assert.equal(l.status,'ready');
assert.equal(l.picks[1].userId,order[1]);assert.equal(l.picks[1].replacementRequired,undefined);
assert.equal(l.replacements[0].original.birdId,'bird-1');
user(order[0]);await post({action:'replace',id:readyId,originalBirdId:'bird-0',birdId:'bird-24'},409);
user(order[2]);await post({action:'replace',id:readyId,originalBirdId:'bird-2',birdId:'bird-25'},409);
user(order[0]);
// At the exact deadline (including a database write that crosses it), a ready
// league survives but cannot replace. Its original failed slot remains zero.
now=cutoff(2027)-1;advanceOnWrite=true;
await post({action:'replace',id:readyId,originalBirdId:'bird-0',birdId:'bird-25'},409);
assert.equal(stored(readyId).status,'ready');
await post({action:'replace',id:readyId,originalBirdId:'bird-0',birdId:'bird-25'},409);
const zero=standings(stored(readyId),[{birdId:'bird-0',year:2027,version:1,arrival:{eventId:'late',observedAt:'2027-02-01T00:00:00.000Z',longitude:10,latitude:51,tagId:'t'},checkedAt:'2027-02-02T00:00:00Z'}],Date.parse('2027-02-02T00:00:00Z')).birds.find(b=>b.birdId==='bird-0');
assert.equal(zero.points,0);assert.equal(zero.status,'not-replaced');assert.equal(zero.arrival,null);
readyPicks=stored(readyId).picks;
now=Date.parse('2027-01-10T12:00:00Z');

// Six-bird cap, scarce pool, locked team size, concurrent write protection.
seedBirds(100);l=await league(2);l=await post({action:'start',id:l.id});assert.equal(l.size,6);seedBirds(30);assert.equal(stored(l.id).size,6);
user(l.members[0].id);conflict=true;await post({action:'pick',id:l.id,birdId:'bird-0'},409);assert.equal(stored(l.id).picks.length,0);
seedBirds(1);let scarce=await league(2);await post({action:'start',id:scarce.id},409);assert.equal(stored(scarce.id).status,'lobby');
// Exact deadline: no grace period; preserve completed drafts; invalidate invites; idempotent cleanup.
seedBirds(30);now=cutoff(2027)-1;const lobbyId=scarce.id;const draftId=l.id;
assert.equal(await disbandExpired(now),0);user(l.members[0].id);advanceOnMetadata=true;await post({action:'pick',id:l.id,birdId:'bird-0'},409);
assert.equal(stored(draftId).status,'disbanded');assert.equal(stored(lobbyId).status,'disbanded');assert.equal(stored(readyId).status,'ready');assert.deepEqual(stored(readyId).picks,readyPicks);assert.equal(await disbandExpired(now),0);
// Database execution itself can cross midnight after the application clock check.
now=cutoff(2027)-1;seedBirds(30);let atWrite=await league(2);atWrite=await post({action:'start',id:atWrite.id});user(atWrite.members[0].id);advanceOnWrite=true;await post({action:'pick',id:atWrite.id,birdId:'bird-0'},409);assert.equal(stored(atWrite.id).status,'disbanded');assert.equal(stored(atWrite.id).picks.length,0);
user('owner');await post({action:'start',id:lobbyId},409);const next=await post({action:'create',name:'Next year'});assert.equal(next.year,2028);
// Background sync performs expiry even without a league page visit.
const expired={...next,id:'background',year:2027,invite:'old-background'};sql.prepare('INSERT INTO leagues(id,invite,state) VALUES(?,?,?)').run(expired.id,expired.invite,JSON.stringify(expired));
const response=await sync(new Request('https://app.test/api/sync',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({action:'context',studyId:'10449318'})}));assert.equal(response.status,200);assert.equal(stored('background').status,'disbanded');assert.notEqual(stored('background').invite,'old-background');
console.log('PASS: first-come replacements, ownership, collisions, zero-point forfeits and exact replacement deadline; full invite/private league flow; 8-player limit; 6-bird cap; 24-pick snake draft; duplicate, eligibility and identity checks; concurrent write rejection; exact ET deadline; mid-request deadline; completed-draft preservation; background expiry; next-season rollover.');
sql.close();globalThis.Date=RealDate;
