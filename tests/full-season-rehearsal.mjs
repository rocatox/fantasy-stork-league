// Isolated combined season: production handlers, in-memory SQLite and intercepted HTTP.
// Never reads production credentials or dispatches external network requests.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {arrivalCollector} from '../lib/race-observations.mjs';
import {standings} from '../lib/race.mjs';
import {cutoff,turn,eligible} from '../lib/rules.mjs';
const RealDate=Date;let now=Date.parse('2027-01-10T12:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0020_stork_notifications.sql','utf8'));
sql.function('unixepoch',(_value)=>Math.floor(now/1000));
sql.function('unixepoch',()=>Math.floor(now/1000));
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,invite TEXT UNIQUE,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0004_race','0007_notifications','0008_notification_outbox','0014_race_notification_changes','0015_race_initial_notifications','0016_race_notification_cycles','0010_notification_email','0013_email_digest'])sql.exec(readFileSync('drizzle/'+m+'.sql','utf8'));
let conflict=false,advanceOnMetadata=false,advanceOnWrite=false;
const db={prepare(query){const stmt=sql.prepare(query);const bound=(args=[])=>({async run(){if(advanceOnWrite&&query.includes('unixepoch')){advanceOnWrite=false;now=cutoff(2027);}if(conflict&&query.startsWith('UPDATE leagues SET state=')){conflict=false;sql.prepare('UPDATE leagues SET revision=revision+1').run();}return {meta:{changes:Number(stmt.run(...args).changes)}};},async first(){if(advanceOnMetadata&&query.includes('SELECT payload FROM sync_state')){advanceOnMetadata=false;now=cutoff(2027);}return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};}};
db.batch=async statements=>{sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}};
globalThis.leagueEnv={DB:db,SYNC_SECRET:'fixture',APP_ORIGIN:'https://storkleague.fans',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans'};globalThis.leagueUser={userId:'owner',displayName:'Owner'};
await build({entryPoints:['app/api/leagues/route.ts','lib/disband.ts','lib/snapshot-endpoint.ts','lib/notification-delivery.ts','lib/notification-email.ts','lib/race-endpoint.ts','lib/geo.ts','app/api/notifications/route.ts'],outdir:'.runner/full-season-rehearsal',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/lib\/(auth|profiles)$/},a=>({path:a.path.split('/').pop(),namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.leagueEnv;':a.path==='auth'?'export const getUser=async()=>globalThis.leagueUser;':'export const nameLeagues=async l=>l;'}));b.onLoad({filter:/data[\\/]seed\.json$/},()=>({loader:'json',contents:JSON.stringify({birds:[],studies:[{studyId:'10449318'}]})}));}}]});
const {GET,POST}=await import('../.runner/full-season-rehearsal/app/api/leagues/route.mjs');
const {disbandExpired}=await import('../.runner/full-season-rehearsal/lib/disband.mjs');
const {POST:sync}=await import('../.runner/full-season-rehearsal/lib/snapshot-endpoint.mjs');
const boundary=JSON.parse(readFileSync('data/boundary-source.json')).version;
const user=id=>globalThis.leagueUser=id?{userId:id,displayName:id}:null;
const post=async(body,status=200,headers={})=>{const r=await POST(new Request('https://storkleague.fans/api/leagues',{method:'POST',headers:{origin:'https://storkleague.fans','content-type':'application/json',...headers},body:JSON.stringify(body)}));const data=await r.json();assert.equal(r.status,status,JSON.stringify({body,data}));return data.league||data;};
const get=async()=> (await GET(new Request('https://storkleague.fans/api/leagues'))).json();
const stored=id=>JSON.parse(sql.prepare('SELECT state FROM leagues WHERE id=?').get(id).state);
function seedBirds(count){sql.exec('DELETE FROM birds');const animals=[];for(let i=0;i<count;i++){const b={id:'10449318:Bird '+i,name:'Bird '+i,studyId:'10449318',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:500,countryCode:'ES',currentDeployment:true,boundaryVersion:boundary};sql.prepare('INSERT INTO birds VALUES(?,?)').run(b.id,JSON.stringify(b));animals.push({id:String(i+1),local_identifier:b.name});}sql.prepare('INSERT OR REPLACE INTO sync_state VALUES(?,?)').run('metadata:10449318',JSON.stringify({individuals:animals}));}
const changeBird=(id,changes)=>{const b=JSON.parse(sql.prepare('SELECT payload FROM birds WHERE id=?').get(id).payload);sql.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({...b,...changes}),id);};
async function league(players){user('owner');let l=await post({action:'create',name:'Test flock'});for(let i=1;i<players;i++){user('p'+i);l=await post({action:'join',invite:l.invite});}user('owner');return l;}

const {newNotificationAccount,notificationResponse}=await import('../lib/notifications.mjs');
const {deliverNotificationEvent,notificationTick}=await import('../.runner/full-season-rehearsal/lib/notification-delivery.mjs');
const {deliverEmail:deliverReadyEmail}=await import('../.runner/full-season-rehearsal/lib/notification-email.mjs');
const deliverEmail=(time=Date.now())=>deliverReadyEmail(time);
let sent=[];
globalThis.fetch=async(url,options)=>{
 if(url.startsWith('https://api.clerk.com/')){const id=url.split('/').pop();return Response.json({primary_email_address_id:'primary',email_addresses:[{id:'primary',email_address:id+'@example.test',verification:{status:'verified'}}]});}
 assert.equal(url,'https://api.brevo.com/v3/smtp/email');sent.push(JSON.parse(options.body));return Response.json({messageId:'fixture-'+sent.length});
};
const account=id=>JSON.parse(sql.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').get(id).payload);
const save=(id,a)=>sql.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(a),id);
async function drain(){for(let i=0;i<1000;i++){const r=await deliverNotificationEvent(now);if(r.status==='empty')return;assert.equal(r.status,'delivered');}throw Error('Outbox did not drain');}
async function mail(){for(let i=0;i<1000;i++){const r=await deliverEmail(now);if(r.status==='empty')return;assert.ok(['accepted','skipped'].includes(r.status),r.status);}throw Error('Email queue did not drain');}
const {POST:racePost}=await import('../.runner/full-season-rehearsal/lib/race-endpoint.mjs');
const {GET:inboxGet}=await import('../.runner/full-season-rehearsal/app/api/notifications/route.mjs');
const {germanyPosition,germanyInteriorMargin}=await import('../.runner/full-season-rehearsal/lib/geo.mjs');
const checks=[];const pass=name=>{checks.push(name);console.log('PASS:',name);};
const DAY=86400000,managers=['owner',...Array.from({length:7},(_,i)=>'p'+(i+1))];
for(const [i,id] of managers.entries()){
 const a=newNotificationAccount(now);a.preferences.race=!!(i%4&1);a.preferences.leagueRace=!!(i%4&2);
 a.preferences.email_race=i<4?a.preferences.race:!a.preferences.race;a.preferences.email_leagueRace=i<4?a.preferences.leagueRace:!a.preferences.leagueRace;
 a.preferences.email_trades=true;a.preferences.email_draft=true;a.emailUnsubscribeToken=crypto.randomUUID()+crypto.randomUUID();
 sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run(id,JSON.stringify(a));
}
seedBirds(64);let l=await league(8);const lid=l.id;await drain();await mail();
assert.equal(l.members.length,8);assert.match(l.invite,/^\d{6}$/);
const n=account('owner').events.length;
user('p1');await post({action:'join',invite:l.invite});await drain();assert.equal(account('owner').events.length,n);
user('owner');l=await post({action:'start',id:lid});assert.equal(l.size,6);
const order=l.members.map(m=>m.id),draftSequence=[];
for(let i=0;i<48;i++){const id=order[turn(i,8)];user(id);draftSequence.push(id);l=await post({action:'pick',id:lid,birdId:'10449318:Bird '+i});}
assert.deepEqual(draftSequence.slice(0,16),[...order,...order.toReversed()]);assert.equal(l.status,'ready');assert.equal(new Set(l.picks.map(p=>p.birdId)).size,48);
await drain();await mail();pass('Eight real handler-created memberships, idempotent joins, six rounds / 48 unique snake picks');
const owned=id=>stored(lid).picks.filter(p=>p.userId===id).map(p=>p.birdId);
const a=owned('owner'),b=owned('p1');
user('owner');l=await post({action:'proposeTrade',id:lid,to:'p1',offer:a.slice(0,2),request:b.slice(0,1)});const accepted=l.trades.at(-1).id;await drain();await mail();
const actorBefore=account('p1').events.length;user('p1');await post({action:'acceptTrade',id:lid,tradeId:accepted});await drain();await mail();
assert.equal(owned('p1').length,7);assert.equal(owned('owner').length,5);assert.equal(account('p1').events.length,actorBefore);
pass('Unequal two-for-one trade produces seven- and five-bird teams; accepting manager gets no self-action alert');
// Swap invalidates the other manager's pending offer and excludes the actor.
user('owner');l=await post({action:'proposeTrade',id:lid,to:'p1',offer:[owned('owner')[0]],request:[owned('p1')[0]]});const cancelled=l.trades.at(-1).id;await drain();await mail();
const swapActorBefore=account('p1').events.length;user('p1');await post({action:'swap',id:lid,originalBirdId:owned('p1')[0],birdId:'10449318:Bird 48'});await drain();await mail();
assert.equal(stored(lid).trades.find(t=>t.id===cancelled).status,'cancelled');assert.equal(account('p1').events.length,swapActorBefore);
pass('Pool swap transfers ownership, cancels impossible proposal, and notifies only the other manager');
const pre=owned('p2')[0],during=owned('p3')[0],deadSwap=owned('p4')[0],deadKept=owned('p5')[0],late=owned('p6')[0];
for(const id of [pre,during])changeBird(id,{latestValidFixUtc:'2026-11-01T00:00:00Z'});
for(const id of [deadSwap,deadKept])changeBird(id,{recordedDead:true});await get();await drain();await mail();
for(const id of [pre,during,deadSwap,deadKept])assert.ok(stored(lid).picks.find(p=>p.birdId===id).replacementRequired);
changeBird(pre,{latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:100});await get();assert.equal(stored(lid).picks.find(p=>p.birdId===pre).replacementRequired,undefined);
user('p4');await post({action:'swap',id:lid,originalBirdId:deadSwap,birdId:'10449318:Bird 49'});await drain();await mail();
now=cutoff(2027);user('p3');await post({action:'replace',id:lid,originalBirdId:during,birdId:'10449318:Bird 50'},409);await post({action:'swap',id:lid,originalBirdId:during,birdId:'10449318:Bird 50'},409);
pass('Preseason inactivity/death alerts, recovery inside 450 miles, replacement swap, and exact race-start lock');
l=stored(lid);const histories=new Map();
const event=(p,id,time,lon=2,lat=42)=>({event_id:id,timestamp:time,individual_local_identifier:p.bird.name,individual_taxon_canonical_name:'Ciconia ciconia',tag_local_identifier:'tag-'+p.individualId,location_long:String(lon),location_lat:String(lat),visible:'true'});
for(const p of l.picks)histories.set(p.birdId,[event(p,p.birdId+'-base','2027-01-16T06:00:00Z')]);
const admin=body=>racePost(new Request('https://storkleague.fans/api/race',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)}));
async function commit(p){
 const c=arrivalCollector({year:2027,individual:{id:p.individualId,local_identifier:p.bird.name,...(p.birdId===deadKept?{mortality_date:'2027-01-10T00:00:00Z'}:{})},deployments:[{individual_id:p.individualId,tag_local_identifier:'tag-'+p.individualId,deploy_on_timestamp:'2026-01-01T00:00:00Z'}],classify:germanyPosition,interior:germanyInteriorMargin,now});
 histories.get(p.birdId).forEach(e=>c.add(e));const r=await admin({action:'claim',year:2027,birdId:p.birdId});assert.equal(r.status,200);const {lease}=await r.json();
 const body={action:'commit',year:2027,birdId:p.birdId,lease,result:{...c.result(),individualId:p.individualId,boundaryVersion:boundary,startedAt:new Date(now).toISOString()}};
 const saved=await admin(body);assert.equal(saved.status,200,JSON.stringify(await saved.json()));return body;
}
const board=()=>standings(stored(lid),sql.prepare('SELECT payload FROM race_results').all().map(r=>JSON.parse(r.payload)),now);
let checkedRaceEvents=0;
const finish=async()=>{user(null);await drain();await mail();
 for(const id of managers){const a=account(id),events=a.events.filter(e=>['race','leagueRace'].includes(e.category));assert.equal(new Set(events.map(e=>e.id)).size,events.length);
  for(const e of events){const allowed=prefix=>e.title==='Final results'?a.preferences[prefix+'race']:e.category==='race'?(a.preferences[prefix+'race']||a.preferences[prefix+'leagueRace']):a.preferences[prefix+'leagueRace'];
   assert.equal(!e.suppressed,!!allowed(''));assert.equal(!e.emailSuppressed,!!allowed('email_'));
   const row=sql.prepare('SELECT status FROM notification_email_queue WHERE user_id=? AND event_id=?').get(id,e.id);
   if(allowed('email_'))assert.equal(row?.status,'accepted');else assert.equal(row,undefined);checkedRaceEvents++;
  }
 }
};
const all=async()=>{user(null);for(const p of l.picks)await commit(p);await finish();};
assert.equal((await (await admin({action:'queue'})).json()).targets.length,48);await all();
// One migration signal on the bird that recovers during the race.
const dp=l.picks.find(p=>p.birdId===during);
const lats=[35,35,35,35,35,36,36,37,37,38,38];
histories.set(during,lats.flatMap((lat,i)=>[0,1].map(h=>event(dp,'migration-'+i+'-'+h,new Date(Date.parse('2027-02-01T08:00:00Z')+i*DAY+h*3600000).toISOString(),-5,lat))));
now=Date.parse('2027-02-12T12:00:00Z');changeBird(during,{latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:100});await all();
assert.equal(stored(lid).picks.find(p=>p.birdId===during).replacementRequired,undefined);
for(const id of managers){const records=account(id).events.filter(e=>e.title==='Migration detected');assert.equal(records.length,1);const pref=account(id).preferences;assert.equal(records.filter(e=>!e.suppressed).length,(id==='p3'?(pref.race||pref.leagueRace):pref.leagueRace)?1:0);}
pass('Offline migration-start alerts obey all four race-toggle combinations; in-season recovery clears the flag');
function arrive(id,time){const p=l.picks.find(p=>p.birdId===id);histories.get(id).push(event(p,id+'-arrival',time,10,51),event(p,id+'-confirm',new Date(Date.parse(time)+3600000).toISOString(),10,51));}
arrive(pre,'2027-03-01T10:00:00Z');arrive(during,'2027-03-01T10:00:00Z');now=Date.parse('2027-03-02T12:00:00Z');await all();
assert.equal(board().birds.find(b=>b.birdId===pre).points,47.5);assert.equal(board().birds.find(b=>b.birdId===during).points,47.5);
pass('Both recovered birds score; exact-time tie shares first and second place points (47.5 each)');
arrive(late,'2027-02-28T10:00:00Z');now+=DAY;await all();assert.equal(board().birds[0].birdId,late);assert.equal(board().birds[0].points,48);assert.equal(board().birds.find(b=>b.birdId===pre).points,46.5);
const previousAlertCounts=managers.map(id=>account(id).events.length);const sends=sent.length;await all();assert.deepEqual(managers.map(id=>account(id).events.length),previousAlertCounts);assert.equal(sent.length,sends);
pass('Delayed GPS arrival takes first place and revises other scores; repeat imports create no duplicate alerts or emails');
histories.set(late,histories.get(late).map(e=>({...e,...(e.event_id.includes('-arrival')||e.event_id.includes('-confirm')?{visible:'false'}:{})})));now+=DAY;await all();assert.equal(board().birds.find(b=>b.birdId===late).points,0);assert.equal(board().birds.find(b=>b.birdId===pre).points,47.5);
pass('Withdrawn GPS evidence retracts arrival and restores tied points');
// After season-end coverage and the 72-hour review interval, finalize without inbox visits.
now=Date.parse('2027-07-02T12:00:00Z');await all();assert.equal(board().status,'reconciling');now+=4*DAY;await notificationTick(now);await finish();assert.equal(board().status,'complete');
assert.equal(board().birds.filter(b=>b.status==='nonfinisher').length,46);assert.equal(board().birds.find(b=>b.birdId===deadKept).points,0);
for(const id of managers){const a=account(id),finals=a.events.filter(e=>e.title==='Final results');assert.equal(finals.length,1);assert.equal(finals.filter(e=>!e.suppressed).length,a.preferences.race?1:0);const t=board().teams.find(t=>t.userId===id);assert.ok(finals[0].body.includes('#'+t.rank));assert.ok(finals[0].body.includes(t.points+' points'));}
pass('46 nonfinishers score zero, team ties settle, and final results follow My race updates only');
// First inbox visits occur after background recording; no browser was needed.
for(const id of managers){user(id);const r=await inboxGet(new Request('https://storkleague.fans/api/notifications'));assert.equal(r.status,200);}
user('outsider');assert.equal((await (await inboxGet(new Request('https://storkleague.fans/api/notifications'))).json()).items.length,0);
const before=sent.length;await finish();assert.equal(sent.length,before);assert.ok(sent.length>0);assert.ok(sent.every(m=>m.to.map(t=>t.email).every(to=>to.endsWith('@example.test'))));
assert.equal(sql.prepare("SELECT COUNT(*) n FROM notification_email_queue WHERE status='pending'").get().n,0);
pass('Private inboxes, email transport mocked exclusively to example.test, empty retry queues, and no real external requests');
const report={mode:'In-memory SQLite, synthetic identities/GPS, intercepted Clerk/Brevo fetch; no production writes',managers:8,initialPicks:48,finalRosterSizes:managers.map(id=>({manager:id,birds:owned(id).length})),checks,finalStandings:board().teams,mockedEmailMessages:sent.length,checkedRaceEventAssertions:checkedRaceEvents};
writeFileSync('.runner/full-season-rehearsal-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));sql.close();globalThis.Date=RealDate;
