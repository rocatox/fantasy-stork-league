import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,invite TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const migration of ['0004_race','0007_notifications','0008_notification_outbox'])sql.exec(readFileSync(`drizzle/${migration}.sql`,'utf8'));
const RealDate=Date;let now=Date.parse('2027-01-10T12:00:00Z');globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
sql.function('unixepoch',()=>Math.floor(now/1000));
let failUser='',queries=0;
const db={prepare(q){queries++;const s=sql.prepare(q);const bound=(a=[])=>({run:async()=>{if(failUser&&q.startsWith('INSERT OR IGNORE INTO notification_accounts')&&a[0]===failUser){failUser='';throw Error('Simulated interrupted delivery');}return {meta:{changes:Number(s.run(...a).changes)}};},first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};}};
globalThis.backgroundEnv={DB:db};globalThis.backgroundUser={userId:'a'};
await build({entryPoints:['lib/notification-delivery.ts','app/api/notifications/route.ts'],outdir:'.runner/notification-background',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/lib\/auth$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='env'?'export const env=globalThis.backgroundEnv':'export const getUser=async()=>globalThis.backgroundUser',loader:'js'}));}}]});
const {deliverNotificationEvent:deliver,notificationTick:tick,pumpNotifications:pump}=await import('../.runner/notification-background/lib/notification-delivery.mjs');
const {GET,POST}=await import('../.runner/notification-background/app/api/notifications/route.mjs');
const account=id=>JSON.parse(sql.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').get(id).payload);
const drain=async()=>{for(let i=0;i<100;i++){queries=0;const r=await deliver(now);assert.ok(queries<50,`Free query budget: ${queries}`);if(r.status==='empty')return;}throw Error('Did not drain');};
const l={id:'l',name:'Test league',year:2027,status:'draft',members:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],picks:[],trades:[],size:1,draftStartedAt:new Date(now).toISOString()};
const update=()=>sql.prepare('UPDATE leagues SET state=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),l.id);
sql.prepare('INSERT INTO leagues(id,state,invite) VALUES(?,?,?)').run(l.id,JSON.stringify(l),'secret-invite');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1);
assert.ok(!sql.prepare('SELECT payload FROM notification_outbox').get().payload.includes('secret-invite'));
// No browser/inbox request. A partial failure leaves the source event and safely resumes.
failUser='b';await assert.rejects(deliver(now),/interrupted/);assert.equal(account('a').events.length,2);await drain();assert.equal(account('a').events.length,2);assert.equal(account('b').events.length,1);
// Hosts receive joins under draft settings, including a distinct rejoin.
l.owner='a';update();await drain();now+=1000;l.members.push({id:'c',name:'Chris'});update();await drain();assert.equal(account('a').events.filter(e=>e.title==='A manager joined').length,1);assert.equal(account('b').events.filter(e=>e.title==='A manager joined').length,0);
l.members=l.members.filter(m=>m.id!=='c');update();await drain();now+=1000;l.members.push({id:'c',name:'Chris'});update();await drain();assert.equal(account('a').events.filter(e=>e.title==='A manager joined').length,2);l.members=l.members.filter(m=>m.id!=='c');update();await drain();
// Transaction rollback cannot produce a phantom notification.
sql.exec('BEGIN');update();sql.exec('ROLLBACK');assert.equal(sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);
now+=1000;l.picks=[{birdId:'one',userId:'a',bird:{name:'One'}}];update();now+=1000;l.picks.push({birdId:'two',userId:'b',bird:{name:'Two'}});l.status='ready';l.draftCompletedAt=new Date(now).toISOString();update();
// Proposal is cancelled before either manager visits; both transitions must survive.
now+=1000;l.trades=[{id:'t',from:'b',to:'a',offer:['two'],request:['one'],status:'pending',createdAt:new Date(now).toISOString()}];update();now+=1000;l.trades[0].status='cancelled';l.trades[0].resolvedAt=new Date(now).toISOString();update();await drain();
assert.ok(account('a').events.some(e=>e.title==='Trade proposal'&&!e.active));assert.ok(account('a').events.some(e=>e.title==='Trade cancelled'));assert.ok(account('b').events.some(e=>e.title==='Your pick'&&!e.active));
// Tick records both deadline tiers with no open app, then closes the unfinished league.
now=Date.parse('2027-01-15T06:00:00Z');await tick(now);await drain();now=Date.parse('2027-01-16T04:15:00Z');await tick(now);await drain();assert.equal(account('a').events.filter(e=>e.category==='deadlines').length,2);
// Race snapshots preserve each committed arrival/correction while everyone is offline.
now=Date.parse('2027-03-01T13:00:00Z');const arrival={eventId:'one',observedAt:'2027-03-01T12:00:00.000Z',longitude:13.4,latitude:52.5,tagId:'tag',qualityVersion:4,support:'repeat-inside',confirmation:{eventId:'two',observedAt:'2027-03-01T12:10:00.000Z',longitude:13.4,latitude:52.5,tagId:'tag'}};
const race=(id,a)=>{now+=1000;const r={birdId:id,year:2027,version:4,arrival:a,checkedAt:new Date(now).toISOString(),changedAt:new Date(now).toISOString(),startedAt:new Date(now).toISOString()};sql.prepare('INSERT INTO race_results VALUES(?,?,?) ON CONFLICT(bird_id,year) DO UPDATE SET payload=excluded.payload').run(id,2027,JSON.stringify(r));};
race('one',arrival);race('two',null);race('one',null);race('one',arrival);await drain();assert.equal(account('a').events.filter(e=>e.title==='Arrival confirmed').length,2);assert.ok(account('a').events.some(e=>e.title==='Race score updated'));
assert.ok(!JSON.stringify(account('a')).includes('longitude'),'No raw GPS evidence in account inbox');
// Authenticated reads retrieve recorded events without advancing race snapshots.
const before=JSON.stringify(account('a').raceSnapshots);let response=await GET(new Request('https://app.test/api/notifications'));let data=await response.json();assert.ok(data.items.some(e=>e.title==='Trade proposal'));assert.equal(JSON.stringify(account('a').raceSnapshots),before);
const post=async(body,origin='https://app.test')=>POST(new Request('https://app.test/api/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await post({action:'readAll'},'https://evil.test')).status,403);await post({action:'readAll'});assert.ok(account('a').events.every(e=>e.read));
await post({action:'preferences',preferences:{trades:false}});assert.equal(account('a').preferences.trades,false);
globalThis.backgroundUser={userId:'outsider'};data=await (await GET(new Request('https://app.test/api/notifications'))).json();assert.equal(data.items.length,0);globalThis.backgroundUser=null;assert.equal((await GET(new Request('https://app.test/api/notifications'))).status,401);
// Maximum-size league and overlapping processors remain bounded and idempotent.
const large={...l,id:'eight',status:'draft',members:Array.from({length:8},(_,i)=>({id:'eight-'+i,name:'Manager '+i})),picks:[],trades:[]};
sql.prepare('INSERT INTO leagues(id,state,invite) VALUES(?,?,?)').run(large.id,JSON.stringify(large),'test-only');queries=0;const overlap=await Promise.all([deliver(now),deliver(now)]);assert.ok(overlap.some(r=>r.status==='busy'));assert.ok(overlap.some(r=>r.status==='delivered'));assert.ok(queries<50);await drain();
for(const m of large.members)assert.ok(sql.prepare('SELECT 1 FROM notification_accounts WHERE user_id=?').get(m.id));
// The Worker callback uses supported manual redirect handling and never forwards the secret to a redirect.
const originalFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://app.test/api/notification-jobs');assert.equal(options.redirect,'manual');return Response.json({status:calls===1?'delivered':'empty'});};
assert.equal((await pump({SYNC_SECRET:'fixture',APP_ORIGIN:'https://app.test'},false,4)).status,'empty');assert.equal(calls,2);
globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://other.test'}});await assert.rejects(pump({SYNC_SECRET:'fixture',APP_ORIGIN:'https://app.test'},false,4),/HTTP 302/);globalThis.fetch=originalFetch;
console.log('PASS: transactional capture, rollback, offline draft/trade/race/deadlines, partial-failure retry, deduplication, Free query budget, no GPS inbox data, private access and read/settings persistence.');
