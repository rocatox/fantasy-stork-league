import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {newNotificationAccount} from '../lib/notifications.mjs';
const RealDate=Date;let now=Date.parse('2027-03-01T12:00:00Z');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
globalThis.fetch=async()=>{throw Error('Unexpected network access');};
const sql=new DatabaseSync(':memory:');sql.function('unixepoch',()=>Math.floor(now/1000));
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,invite TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0004_race','0007_notifications','0008_notification_outbox','0014_race_notification_changes','0015_race_initial_notifications','0016_race_notification_cycles','0010_notification_email','0013_email_digest'])sql.exec(readFileSync(`drizzle/${m}.sql`,'utf8'));
let failUser='',failClose=false;
const db={prepare(q){const st=sql.prepare(q);const bound=(a=[])=>({run:async()=>{if(failUser&&q.startsWith('UPDATE notification_accounts')&&a[1]===failUser){failUser='';throw Error('Interrupted recipient');}if(failClose&&q.startsWith('UPDATE race_notification_cycles')){failClose=false;throw Error('Interrupted close');}return {meta:{changes:Number(st.run(...a).changes)}};},first:async()=>st.get(...a)||null,all:async()=>({results:st.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.cycleEnv={DB:db,SYNC_SECRET:'fixture',APP_ORIGIN:'https://storkleague.fans',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans'};
await build({entryPoints:['lib/notification-delivery.ts','lib/race-notification-cycles.ts','lib/race-endpoint.ts','lib/notification-email.ts'],outdir:'.runner/cycle-integration',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',plugins:[{name:'isolation',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.cycleEnv',loader:'js'}));}}]});
const {deliverNotificationEvent:deliver}=await import('../.runner/cycle-integration/notification-delivery.mjs');
const {closeRaceNotificationCycle:close,pruneRaceNotificationCycles:prune}=await import('../.runner/cycle-integration/race-notification-cycles.mjs');
const {POST}=await import('../.runner/cycle-integration/race-endpoint.mjs');
const {deliverEmail}=await import('../.runner/cycle-integration/notification-email.mjs');
const request=async(body)=>{const r=await POST(new Request('https://storkleague.fans/api/race',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
const begin=async()=>{const r=await request({action:'cycle-begin'});assert.equal(r.status,200);return r.cycleId;};
const drain=async()=>{for(let i=0;i<100;i++){const r=await deliver(now);if(r.status==='empty')return;}throw Error('Queue stuck');};
const account=id=>JSON.parse(sql.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').get(id).payload);
const members=Array.from({length:4},(_,i)=>({id:'u'+i,name:'Manager '+i}));
const l={id:'l',name:'Cycle league',year:2027,status:'ready',size:1,owner:'u0',members,picks:members.map((m,i)=>({birdId:'bird'+i,userId:m.id,bird:{name:'Bird '+i}})),trades:[]};
for(let i=0;i<4;i++){const a=newNotificationAccount(now-86400000);a.preferences.race=!!(i&1);a.preferences.leagueRace=!!(i&2);a.preferences.email_race=!!(i&1);a.preferences.email_leagueRace=!!(i&2);a.emailUnsubscribeToken=crypto.randomUUID()+crypto.randomUUID();sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run('u'+i,JSON.stringify(a));}
sql.prepare('INSERT INTO leagues VALUES(?,?,?,0)').run(l.id,JSON.stringify(l),'private');await drain();
const arrival=(id,hour=8)=>({eventId:id,observedAt:`2027-03-01T${String(hour).padStart(2,'0')}:00:00.000Z`,longitude:10,latitude:51,tagId:'tag',qualityVersion:4,support:'repeat-inside',confirmation:{eventId:id+'confirm',observedAt:`2027-03-01T${String(hour+1).padStart(2,'0')}:00:00.000Z`,longitude:10,latitude:51,tagId:'tag'}});
let revision=0;
const write=(i,a=null,migration=null)=>{now+=1000;const r={birdId:'bird'+i,year:2027,version:4,arrival:a,migrationStart:migration,migrationStartVersion:2,revision:++revision,boundaryVersion:'fixture',checkedAt:new Date(now).toISOString(),startedAt:new Date(now).toISOString(),changedAt:new Date(now).toISOString()};sql.prepare('INSERT INTO race_results VALUES(?,?,?) ON CONFLICT(bird_id,year) DO UPDATE SET payload=excluded.payload').run(r.birdId,2027,JSON.stringify(r));};
let id=await begin();for(let i=0;i<4;i++)write(i);await close(db,id,now);await drain();
id=await begin();assert.equal((await request({action:'cycle-begin'})).status,409);
for(let i=0;i<4;i++){write(i,arrival('arr'+i));await drain();assert.equal(account('u3').events.length,0,'no intermediate points alerts');}
// Unrelated leagues remain deliverable while this league waits; per-league cursors remain ordered.
const other={id:'other',name:'Other',year:2028,status:'draft',owner:'host',members:[{id:'u0'},{id:'host'}],picks:[],size:1,trades:[],draftStartedAt:new Date(now).toISOString()};
sql.prepare('INSERT INTO leagues VALUES(?,?,?,0)').run(other.id,JSON.stringify(other),'other');await drain();assert.ok(account('u0').events.some(e=>e.title==='Your pick'));
// Closing snapshots and terminal events are atomic, and retries are idempotent.
failClose=true;await assert.rejects(close(db,id,now),/Interrupted close/);assert.equal(sql.prepare('SELECT COUNT(*) n FROM race_notification_cycle_leagues WHERE cycle_id=?').get(id).n,0);
await close(db,id,now);const count=sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n;await close(db,id,now);assert.equal(sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,count);
failUser='u2';await assert.rejects(deliver(now),/Interrupted recipient/);await drain();
for(let i=0;i<4;i++){const a=account('u'+i),events=a.events.filter(e=>e.leagueId==='l');assert.equal(events.length,4);assert.equal(new Set(events.map(e=>e.id)).size,4);assert.ok(events.every(e=>e.title==='Arrival confirmed'&&e.body.includes('2.5 points')));assert.equal(events.filter(e=>!e.suppressed).length,(i&2)?4:(i&1)?1:0);}
assert.equal(sql.prepare("SELECT COUNT(*) n FROM notification_email_queue WHERE json_extract(payload,'$.leagueId')='l'").get().n,9,'own+league does not duplicate own arrival');
// A later genuine correction changes arrival time and other birds' final points once each.
now+=60000;id=await begin();write(0,arrival('corrected',7));await close(db,id,now);await drain();assert.equal(account('u3').events.filter(e=>e.title==='Race score updated').length,4);
// Retraction/restoration in one cycle remains observable; migration signal survives retraction.
now+=60000;id=await begin();write(1,null,{version:2,observedAt:'2027-03-01T06:00:00Z',confirmedAt:'2027-03-01T11:00:00Z'});write(1,arrival('arr1'));await close(db,id,now);await drain();assert.equal(account('u3').events.filter(e=>e.title==='Migration detected').length,1);assert.equal(account('u3').events.filter(e=>e.title==='Arrival confirmed').length,5);
// Later imports cannot change the points/evidence attached to a closed, undelivered cycle.
now+=60000;id=await begin();write(0,arrival('earlier',6));await close(db,id,now);
const saved=sql.prepare('SELECT payload FROM race_notification_cycle_leagues WHERE cycle_id=?').get(id).payload;
const nextId=await begin();write(0,arrival('later',9));await close(db,nextId,now);
assert.equal(sql.prepare('SELECT payload FROM race_notification_cycle_leagues WHERE cycle_id=?').get(id).payload,saved);
await drain();assert.equal(account('u3').raceSnapshots.l.birds.find(b=>b.id==='bird0').points,1);
// Timeout closes an interrupted partial cycle; old immutable snapshots survive a newer cycle.
now+=60000;id=await begin();write(2,null);now+=26*60000;await drain();assert.notEqual(sql.prepare('SELECT closed_at FROM race_notification_cycles WHERE id=?').get(id).closed_at,null);assert.equal(account('u3').raceSnapshots.l.birds.find(b=>b.id==='bird2').arrival,null);
await prune(db);assert.equal(sql.prepare('SELECT COUNT(*) n FROM race_notification_cycles').get().n,0);
// Real sender path, mocked provider only: individual messages, no digest, no duplicate delivery.
const sent=[];globalThis.fetch=async(url,opts)=>{url=String(url);if(url.startsWith('https://api.clerk.com/v1/users/'))return Response.json({primary_email_address_id:'p',email_addresses:[{id:'p',email_address:'fixture@example.test',verification:{status:'verified'}}]});assert.equal(url,'https://api.brevo.com/v3/smtp/email');const b=JSON.parse(opts.body);assert.ok(b.to.every(x=>x.email==='fixture@example.test'));sent.push(b);return Response.json({messageId:'mock'+sent.length});};
for(let i=0;i<150;i++){const r=await deliverEmail(now);if(r.status==='empty')break;assert.ok(['accepted','skipped'].includes(r.status),JSON.stringify(r));}
assert.equal(new Set(sent.map(b=>b.headers.idempotencyKey)).size,sent.length);const before=sent.length;await deliverEmail(now);assert.equal(sent.length,before);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM notification_email_queue WHERE status='pending'").get().n,0);
// End-of-season terminal snapshot retains final-results routing to My race updates.
now=Date.parse('2027-07-05T12:00:00Z');id=await begin();
for(const row of sql.prepare('SELECT bird_id,payload FROM race_results').all()){
 const r=JSON.parse(row.payload);r.checkedAt=new Date(now).toISOString();r.startedAt=new Date(now).toISOString();
 sql.prepare('UPDATE race_results SET payload=? WHERE bird_id=?').run(JSON.stringify(r),row.bird_id);
}
await close(db,id,now);await drain();
for(let i=0;i<4;i++){const events=account('u'+i).events.filter(e=>e.title==='Final results');assert.equal(events.length,1);assert.equal(events[0].suppressed,!(i&1));assert.equal(events[0].emailSuppressed,!(i&1));}
console.log('PASS cycle notifications: final points, arrivals, corrections, migrations, toggles, no own duplicates, rollback, partial delivery, timeout, unrelated leagues, cleanup, individual mocked emails.');
sql.close();globalThis.Date=RealDate;
