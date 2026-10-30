import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {standings} from '../lib/race.mjs';
import {cutoff,turn,eligible} from '../lib/rules.mjs';
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
user('owner');await post({action:'start',id:lobbyId},409);await post({action:'create',name:'During season'},409);now=Date.parse('2027-07-01T04:00:00Z');const next=await post({action:'create',name:'Next year'});assert.equal(next.year,2028);
// Background sync performs expiry even without a league page visit.
const expired={...next,id:'background',year:2027,invite:'old-background'};sql.prepare('INSERT INTO leagues(id,invite,state) VALUES(?,?,?)').run(expired.id,expired.invite,JSON.stringify(expired));
const response=await sync(new Request('https://app.test/api/sync',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({action:'context',studyId:'10449318'})}));assert.equal(response.status,200);assert.equal(stored('background').status,'disbanded');assert.notEqual(stored('background').invite,'old-background');
console.log('PASS: first-come replacements, ownership, collisions, zero-point forfeits and exact replacement deadline; full invite/private league flow; 8-player limit; 6-bird cap; 24-pick snake draft; duplicate, eligibility and identity checks; concurrent write rejection; exact ET deadline; mid-request deadline; completed-draft preservation; background expiry; next-season rollover.');
// Membership cap includes joined leagues and is enforced at the database write.
now=Date.parse('2027-07-02T12:00:00Z');user('cap-player');
for(let i=0;i<5;i++)await post({action:'create',name:'Cap '+i});
user('cap-host');const invitation=await post({action:'create',name:'Sixth by invite'});
const blockedInvite=await post({action:'create',name:'Seventh by invite'});
user('cap-player');await post({action:'join',invite:invitation.invite});
await post({action:'join',invite:invitation.invite}); // Already a member: idempotent.
await post({action:'create',name:'Seventh'},409);await post({action:'join',invite:blockedInvite.invite},409);
const old=(await get()).leagues.find(l=>l.owner==='cap-player');old.status='disbanded';sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(old),old.id);
await post({action:'join',invite:blockedInvite.invite});
user('concurrent-player');for(let i=0;i<5;i++)await post({action:'create',name:'Concurrent '+i});
const attempts=await Promise.all(['A','B'].map(name=>POST(new Request('https://app.test/api/leagues',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({action:'create',name})}))));
assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);assert.equal((await get()).leagues.length,6);
now=Date.parse('2028-01-16T05:00:00Z');user('season-test');await post({action:'create',name:'Closed'},409);await post({action:'join',invite:blockedInvite.invite},409);
now=Date.parse('2028-07-01T03:59:59Z');await post({action:'create',name:'Still closed'},409);
now=Date.parse('2028-07-01T04:00:00Z');await post({action:'create',name:'Open again'});
console.log('PASS: six memberships across owned/joined leagues, idempotent join, disbanded slot release, exact Eastern season entry boundaries.');
// Host disbanding and preseason trading use the same revision/deadline guard as picks.
sql.exec('DELETE FROM leagues');now=Date.parse('2027-01-10T12:00:00Z');seedBirds(100);
let dismissed=await league(2);user('p1');await post({action:'disband',id:dismissed.id},403);
user('owner');const dismissedInvite=dismissed.invite;dismissed=await post({action:'disband',id:dismissed.id});assert.equal(dismissed.status,'disbanded');assert.equal((await get()).leagues.length,0);
user('outsider');await post({action:'join',invite:dismissedInvite},404);
let abandoned=await league(2);abandoned=await post({action:'start',id:abandoned.id});await post({action:'disband',id:abandoned.id});assert.equal((await get()).leagues.length,0);
let tradeLeague=await league(3);await post({action:'proposeTrade',id:tradeLeague.id,to:'p1',offer:['bird-0'],request:['bird-1']},409);tradeLeague=await post({action:'start',id:tradeLeague.id});
for(let i=0;i<18;i++){user(tradeLeague.members[turn(i,3)].id);tradeLeague=await post({action:'pick',id:tradeLeague.id,birdId:'bird-'+i});}
const tid=tradeLeague.id;user('owner');await post({action:'disband',id:tid},409);
const [A,B,C]=tradeLeague.members.map(m=>m.id),roster=id=>stored(tid).picks.filter(p=>p.userId===id).map(p=>p.birdId),aa=roster(A),bb=roster(B),cc=roster(C);
// Distance is an entry rule, not a continuing roster/trade condition.
changeBird(aa[0],{distanceToGermanyMiles:0,countryCode:'DE'});changeBird(bb[0],{distanceToGermanyMiles:100,countryCode:'FR'});changeBird(bb[1],{distanceToGermanyMiles:450,countryCode:'FR'});
user(A);await get();for(const id of [aa[0],bb[0],bb[1]]){const bird=JSON.parse(sql.prepare('SELECT payload FROM birds WHERE id=?').get(id).payload);assert.equal(eligible(bird,now),false);assert.ok(stored(tid).picks.some(p=>p.birdId===id));assert.equal(stored(tid).picks.find(p=>p.birdId===id).replacementRequired,undefined);}
const propose=async(from,to,offer,request,status=200)=>{user(from);return post({action:'proposeTrade',id:tid,to,offer,request},status);};
user('outsider');await post({action:'acceptTrade',id:tid,tradeId:'none'},404);
await propose(A,A,[aa[0]],[aa[1]],409);await propose(A,B,[],[bb[0]],409);await propose(A,B,[aa[0],aa[0]],[bb[0]],409);await propose(A,B,[bb[0]],[aa[0]],409);
tradeLeague=await propose(A,B,[aa[0]],[bb[0],bb[1]]);const swap=tradeLeague.trades.at(-1).id;
tradeLeague=await propose(A,C,[aa[0]],[cc[0]]);const conflictA=tradeLeague.trades.at(-1).id;
tradeLeague=await propose(A,C,[aa[1]],[cc[1]]);const independent=tradeLeague.trades.at(-1).id;
await propose(A,C,[aa[2]],[cc[2]],409);
tradeLeague=await propose(B,C,[bb[1]],[cc[2]]);const conflictB=tradeLeague.trades.at(-1).id;
tradeLeague=await propose(C,A,[cc[3]],[aa[0]]);const conflictC=tradeLeague.trades.at(-1).id;
user(A);await post({action:'acceptTrade',id:tid,tradeId:swap},409);user(C);await post({action:'cancelTrade',id:tid,tradeId:swap},409);await post({action:'declineTrade',id:tid,tradeId:swap},409);
user(B);const before=JSON.stringify(stored(tid).picks);conflict=true;await post({action:'acceptTrade',id:tid,tradeId:swap},409);assert.equal(JSON.stringify(stored(tid).picks),before);
tradeLeague=await post({action:'acceptTrade',id:tid,tradeId:swap});assert.equal(roster(A).length,7);assert.equal(roster(B).length,5);assert.equal(roster(C).length,6);assert.equal(new Set(tradeLeague.picks.map(p=>p.birdId)).size,18);
for(const id of [conflictA,conflictB,conflictC])assert.equal(tradeLeague.trades.find(t=>t.id===id).status,'cancelled');assert.equal(tradeLeague.trades.find(t=>t.id===independent).status,'pending');
assert.equal(standings(tradeLeague,[],now).status,'not-started');await post({action:'acceptTrade',id:tid,tradeId:swap},409);
user(A);tradeLeague=await post({action:'cancelTrade',id:tid,tradeId:independent});assert.equal(tradeLeague.trades.find(t=>t.id===independent).status,'cancelled');
tradeLeague=await propose(A,C,[aa[2]],[cc[2]]);const declined=tradeLeague.trades.at(-1).id;user(C);tradeLeague=await post({action:'declineTrade',id:tid,tradeId:declined});assert.equal(tradeLeague.trades.at(-1).status,'declined');
// Replacement invalidates offers without transferring a deceased/inactive pick.
tradeLeague=await propose(A,C,[aa[3]],[cc[3]]);const replacedTrade=tradeLeague.trades.at(-1).id;changeBird(aa[3],{recordedDead:true});user(A);await get();assert.equal(stored(tid).trades.find(t=>t.id===replacedTrade).status,'cancelled');await propose(A,C,[aa[3]],[cc[3]],409);
await post({action:'replace',id:tid,originalBirdId:aa[3],birdId:'bird-50'});assert.equal(roster(A).length,7);
// Concurrent accept/cancel can only commit one outcome.
tradeLeague=await propose(A,C,[aa[4]],[cc[4]]);const concurrentTrade=tradeLeague.trades.at(-1).id;user(C);
const competing=await Promise.all(['acceptTrade','declineTrade'].map(action=>POST(new Request('https://app.test/api/leagues',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({action,id:tid,tradeId:concurrentTrade})}))));assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
// A database write crossing midnight cannot transfer ownership.
tradeLeague=await propose(A,B,[aa[5]],[bb[2]]);const lateTrade=tradeLeague.trades.at(-1).id;const beforeLate=JSON.stringify(stored(tid).picks);now=cutoff(2027)-1;user(B);advanceOnWrite=true;await post({action:'acceptTrade',id:tid,tradeId:lateTrade},409);assert.equal(JSON.stringify(stored(tid).picks),beforeLate);assert.equal(stored(tid).trades.find(t=>t.id===lateTrade).status,'cancelled');
await propose(A,B,[aa[5]],[bb[2]],409);assert.equal(standings(stored(tid),[],now).status,'racing');
console.log('PASS: host disband before draft completion; hidden disbanded leagues; bilateral unequal trades above six, including birds now within 450 miles or inside Germany; three outgoing proposal cap; participant authorization; cancellation/decline; all-side conflict cancellation; replacement invalidation; atomic competing decisions; exact trade cutoff; unequal-roster standings.');
sql.close();globalThis.Date=RealDate;
