import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {notificationDefaults,emailNotificationEnabled,reconcileNotifications,newNotificationAccount,NOTIFICATION_CATEGORIES} from '../lib/notifications.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const f of ['0004_race','0007_notifications','0010_notification_email'])sql.exec(readFileSync(`drizzle/${f}.sql`,'utf8'));
let queries=0;const db={prepare(q){queries++;const s=sql.prepare(q);const bound=(a=[])=>({run:async()=>({meta:{changes:Number(s.run(...a).changes)}}),first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.emailEnv={DB:db,APP_ORIGIN:'https://storkleague.fans',EMAIL_ENABLED:'true',RESEND_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans'};
await build({entryPoints:['lib/notification-email.ts'],outfile:'.runner/email.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.emailEnv',loader:'js'}));}}]});
const {deliverEmail,unsubscribeEmail,emailMessage}=await import('../.runner/email.mjs');
let now=Date.now(),serial=0,mode='ok',verified=true,calls=[];globalThis.fetch=async(url,o)=>{if(url.includes('clerk.com'))return Response.json({primary_email_address_id:'primary',email_addresses:[{id:'other',email_address:'wrong@example.test',verification:{status:'verified'}},{id:'primary',email_address:'right@example.test',verification:{status:verified?'verified':'unverified'}}]});calls.push({body:o.body,key:new Headers(o.headers).get('Idempotency-Key')});if(mode==='timeout')throw Error('Simulated timeout after provider acceptance');return Response.json({id:'provider-id'});};
sql.prepare('INSERT INTO leagues VALUES(?,?)').run('l',JSON.stringify({id:'l',name:'League',year:2027,status:'lobby',members:[{id:'u'}],picks:[],trades:[]}));
const token=crypto.randomUUID()+crypto.randomUUID();let account={since:now,preferences:{...notificationDefaults,email_draft:true},events:[],raceSnapshots:{},leagueSnapshots:{},emailUnsubscribeToken:token};
const save=()=>sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=revision+1').run('u',JSON.stringify(account));
const event=()=>{const e={id:'event'+(++serial),leagueId:'l',leagueName:'League',title:'The draft is open',body:'Fixture <script>bad</script>',category:'draft',createdAt:now,actionable:false,emailSuppressed:false};account.events.push(e);save();return e;};
for(const own of [false,true])for(const other of [false,true]){const p={email_race:own,email_leagueRace:other};assert.equal(emailNotificationEnabled(p,{category:'race',createdAt:now}),own||other);assert.equal(emailNotificationEnabled(p,{category:'leagueRace',createdAt:now}),other);assert.equal(emailNotificationEnabled(p,{category:'race',title:'Final results',createdAt:now}),own);}
assert.equal(emailNotificationEnabled({}, {category:'draft',createdAt:now}),false);assert.equal(emailNotificationEnabled({email_draft:true},{category:'draft',createdAt:now},{draft:now+1}),false);
event();event();queries=0;assert.equal((await deliverEmail(now)).status,'accepted');assert.ok(queries<50);assert.equal(calls.length,1);const msg=JSON.parse(calls[0].body);assert.deepEqual(msg.to,['right@example.test']);assert.ok(msg.template.variables.SUMMARY.includes('&lt;script&gt;'));assert.ok(!msg.template.variables.SUMMARY.includes('<script>'));save();assert.equal((await deliverEmail(now)).status,'empty');
// Durable ambiguous-send retry uses exactly the same recipient, payload and key.
event();mode='timeout';assert.equal((await deliverEmail(now)).status,'retry-needed');const first=calls.at(-1);now+=16*60000;mode='ok';assert.equal((await deliverEmail(now)).status,'accepted');assert.deepEqual(calls.at(-1),first);
// Opt-out cancels queued email without changing in-app preferences.
event();const before=account.preferences.draft;assert.equal((await unsubscribeEmail(new Request('https://storkleague.fans/api/email-unsubscribe?token='+token))).status,200);assert.equal(JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload).preferences.email_draft,true);await unsubscribeEmail(new Request('https://storkleague.fans/api/email-unsubscribe?token='+token,{method:'POST'}));assert.equal((await deliverEmail(now)).status,'skipped');account=JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload);assert.equal(account.preferences.draft,before);assert.equal(account.preferences.email_draft,false);
account.preferences.email_draft=true;event();verified=false;assert.equal((await deliverEmail(now)).status,'no-verified-email');verified=true;
// Quota stops requests before the external call; overlapping invocations cannot double-send.
event();const day='day:'+new Date(now).toISOString().slice(0,10);sql.prepare('INSERT INTO notification_email_budget VALUES(?,90) ON CONFLICT(period) DO UPDATE SET attempts=90').run(day);const count=calls.length;assert.equal((await deliverEmail(now)).status,'free-limit');assert.equal(calls.length,count);sql.prepare('UPDATE notification_email_budget SET attempts=0').run();const overlapping=await Promise.all([deliverEmail(now),deliverEmail(now)]);assert.ok(overlapping.some(x=>x.status==='busy'));assert.ok(overlapping.some(x=>x.status==='accepted'));
// A billing period can cross a calendar-month boundary; rolling cap still applies.
event();sql.prepare('INSERT INTO notification_email_budget VALUES(?,2700) ON CONFLICT(period) DO UPDATE SET attempts=2700').run('day:'+new Date(now-2*86400000).toISOString().slice(0,10));assert.equal((await deliverEmail(now)).status,'free-limit');sql.prepare('UPDATE notification_email_budget SET attempts=0').run();await deliverEmail(now);
// Do not retry after provider's idempotency retention expires.
event();mode='timeout';await deliverEmail(now);now+=24*3600000;assert.equal((await deliverEmail(now)).status,'uncertain-expired');
console.log('PASS email: channel scopes, defaults, opt-in boundary, atomic capture, verified primary address, batching, escaping, duplicate prevention, stable retries, unsubscribe, free caps, lock, retry expiry.');

await build({entryPoints:['app/api/notifications/route.ts'],outfile:'.runner/email-route.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/lib\/auth$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='env'?'export const env=globalThis.emailEnv':'export const getUser=async()=>globalThis.emailUser',loader:'js'}));}}]});
const {POST}=await import('../.runner/email-route.mjs');globalThis.emailUser={userId:'u'};
const testRequest=()=>new Request('https://storkleague.fans/api/notifications',{method:'POST',headers:{origin:'https://storkleague.fans','content-type':'application/json'},body:JSON.stringify({action:'testEmail'})});
mode='ok';sql.prepare("DELETE FROM notification_email_queue WHERE status='pending'").run();sql.prepare("DELETE FROM notification_email_batches WHERE status='pending'").run();
assert.equal((await POST(testRequest())).status,200);assert.equal((await POST(testRequest())).status,429);assert.equal((await deliverEmail(Date.now())).status,'accepted');globalThis.emailUser=null;assert.equal((await POST(testRequest())).status,401);
console.log('PASS: authenticated test-email action uses durable queue, respects hourly rate limit and rejects signed-out callers.');

// Generated league events -> persisted account -> SQL trigger -> production sender.
// Only Clerk and the provider HTTP boundary are mocked; no real managers receive fixtures.
now=Date.parse('2027-01-15T18:00:00Z');mode='ok';
const fixtureLeague={id:'l',name:'Fixture league',year:2027,status:'ready',owner:'u',size:1,members:[{id:'u',name:'You'},{id:'v',name:'Other manager'}],draftCompletedAt:new Date(now).toISOString(),picks:[{userId:'u',birdId:'own',pickedAt:now-1000,bird:{name:'Own bird'},replacementRequired:{reason:'inactive'}}],trades:[{id:'t',from:'v',to:'u',status:'accepted',resolvedAt:new Date(now).toISOString()}]};
const reset=()=>{sql.exec('DELETE FROM notification_email_queue;DELETE FROM notification_email_batches;DELETE FROM notification_email_budget;DELETE FROM notification_email_lock;DELETE FROM notification_accounts;DELETE FROM leagues;');sql.prepare('INSERT INTO leagues VALUES(?,?)').run('l',JSON.stringify(fixtureLeague));calls=[];};
const generate=(prefs)=>{
 let a={...newNotificationAccount(now-1000),preferences:prefs,emailUnsubscribeToken:token};
 const birds=[{birdId:'own',userId:'u',bird:{name:'Own bird'},points:0},{birdId:'other',userId:'v',bird:{name:'Other bird'},points:0}];
 const standings={status:'racing',birds,teams:[{userId:'u',rank:1,points:2}]};
 a=reconcileNotifications(a,[{...fixtureLeague,standings}],'u',now);
 const migrating=birds.map(b=>({...b,migrationStart:{confirmedAt:new Date(now).toISOString()}}));
 a=reconcileNotifications(a,[{...fixtureLeague,standings:{...standings,birds:migrating}}],'u',now);
 const arrived=migrating.map(b=>({...b,points:1,arrival:{observedAt:new Date(now).toISOString()}}));
 a=reconcileNotifications(a,[{...fixtureLeague,standings:{...standings,birds:arrived}}],'u',now);
 const corrected={...fixtureLeague,standings:{...standings,birds:arrived.map(b=>({...b,points:2}))}};
 a=reconcileNotifications(a,[corrected],'u',now);
 const count=a.events.length;a=reconcileNotifications(a,[corrected],'u',now);assert.equal(a.events.length,count,'Repeated source snapshots cannot duplicate events');
 return a;
};
let categoryCases=0;
for(const [category] of NOTIFICATION_CATEGORIES)for(const inApp of [false,true])for(const email of [false,true]){
 reset();const prefs=Object.fromEntries(Object.keys(notificationDefaults).map(k=>[k,false]));prefs[category]=inApp;prefs['email_'+category]=email;
 account=generate(prefs);account.events=account.events.filter(e=>e.category===category);assert.ok(account.events.length,category+' must have a generated event');
 const beforeEvents=structuredClone(account.events);save();save();
 assert.equal(sql.prepare('SELECT count(*) n FROM notification_email_queue').get().n,email?account.events.length:0);
 assert.equal((await deliverEmail(now)).status,email?'accepted':'empty',category);
 assert.equal(calls.length,email?1:0,category);assert.ok(account.events.every(e=>e.suppressed===!inApp));
 assert.deepEqual(JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload).events,beforeEvents);
 assert.equal((await deliverEmail(now)).status,'empty');categoryCases++;
}
// Both race toggles route the owner's event once, while only leagueRace includes others.
for(const own of [false,true])for(const league of [false,true]){
 reset();account=generate({...notificationDefaults,email_race:own,email_leagueRace:league});account.events=account.events.filter(e=>['race','leagueRace'].includes(e.category));save();save();
 const expected=3*(Number(own||league)+Number(league));assert.equal(sql.prepare('SELECT count(*) n FROM notification_email_queue').get().n,expected);
 assert.equal((await deliverEmail(now)).status,expected?'accepted':'empty');
 if(expected){const summary=JSON.parse(calls[0].body).template.variables.SUMMARY;assert.equal(summary.split('Own bird').length-1,3);assert.equal(summary.split('Other bird').length-1,3*Number(league));}
 assert.equal((await deliverEmail(now)).status,'empty');
 // A final result is deliberately excluded from league-only email subscriptions.
 reset();account={...newNotificationAccount(now-1000),preferences:{...notificationDefaults,email_race:own,email_leagueRace:league},emailUnsubscribeToken:token,raceSnapshots:{l:{birds:[],status:'reconciling',revision:0}}};
 account=reconcileNotifications(account,[{...fixtureLeague,standings:{status:'complete',birds:[],teams:[{userId:'u',rank:1,points:2}]}}],'u',now);account.events=account.events.filter(e=>e.title==='Final results');save();assert.equal((await deliverEmail(now)).status,own?'accepted':'empty');
}
// Unsubscribe preserves all six mixed in-app choices and exact event read/visibility states.
reset();const mixed={...notificationDefaults};NOTIFICATION_CATEGORIES.forEach(([k],i)=>{mixed[k]=i%2===0;mixed['email_'+k]=true;});account=generate(mixed);account.events[0].read=true;save();
const beforeUnsubscribe=JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload);
const unsubscribeRequest=method=>new Request('https://storkleague.fans/api/email-unsubscribe?token='+token,{method});
await unsubscribeEmail(unsubscribeRequest('GET'));assert.deepEqual(JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload),beforeUnsubscribe);
await unsubscribeEmail(unsubscribeRequest('POST'));await unsubscribeEmail(unsubscribeRequest('POST'));
const afterUnsubscribe=JSON.parse(sql.prepare('SELECT payload FROM notification_accounts').get().payload);
for(const [key] of NOTIFICATION_CATEGORIES){assert.equal(afterUnsubscribe.preferences[key],beforeUnsubscribe.preferences[key]);assert.equal(afterUnsubscribe.preferences['email_'+key],false);}
assert.deepEqual(afterUnsubscribe.events.map(({emailSuppressed,...e})=>e),beforeUnsubscribe.events.map(({emailSuppressed,...e})=>e));
assert.equal((await deliverEmail(now)).status,'skipped');assert.equal(calls.length,0);
console.log(`PASS: ${categoryCases} generated category/channel cases; four race-toggle combinations; owner deduplication; final-result routing; unsubscribe preserves all in-app preferences and event states.`);

// Owner bug-report mail shares the real sender lock, budget and retry path.
reset();sql.exec(readFileSync('drizzle/0011_bug_reports.sql','utf8'));sql.exec(readFileSync('drizzle/0012_bug_report_email.sql','utf8'));
globalThis.emailEnv.BUG_REPORT_EMAIL='owner@example.test';
const makeReport=()=>{const id=crypto.randomUUID();sql.prepare('INSERT INTO bug_reports(id,user_id,title,area,description,created_at) VALUES(?,?,?,?,?,?)').run(id,'reporter','A <script>title</script>\r\nExtra','map','Full report <b>details</b>\n'+'x'.repeat(3900)+' END',now);return id;};
let reportId=makeReport();assert.equal((await deliverEmail(now)).status,'accepted');assert.equal(calls.length,1);
let reportMessage=JSON.parse(calls[0].body);assert.deepEqual(reportMessage.to,['owner@example.test']);assert.ok(reportMessage.text.endsWith(' END'));assert.ok(reportMessage.html.includes('&lt;b&gt;details&lt;/b&gt;'));assert.ok(!reportMessage.html.includes('<script>'));assert.ok(!/[\r\n]/.test(reportMessage.subject));assert.equal(sql.prepare('SELECT message FROM bug_report_email WHERE report_id=?').get(reportId).message,null);
assert.equal((await deliverEmail(now)).status,'empty');assert.equal(calls.length,1);
reportId=makeReport();mode='timeout';assert.equal((await deliverEmail(now)).status,'retry-needed');const reportAttempt=calls.at(-1);now+=16*60000;mode='ok';assert.equal((await deliverEmail(now)).status,'accepted');assert.deepEqual(calls.at(-1),reportAttempt);
// Ordinary notifications and report emails consume one combined daily allowance.
makeReport();sql.prepare('INSERT INTO notification_email_budget VALUES(?,90) ON CONFLICT(period) DO UPDATE SET attempts=90').run('day:'+new Date(now).toISOString().slice(0,10));const sentBeforeLimit=calls.length;assert.equal((await deliverEmail(now)).status,'free-limit');assert.equal(calls.length,sentBeforeLimit);
sql.prepare('UPDATE notification_email_budget SET attempts=0').run();sql.prepare('INSERT INTO notification_email_budget VALUES(?,2700) ON CONFLICT(period) DO UPDATE SET attempts=2700').run('day:'+new Date(now-86400000).toISOString().slice(0,10));assert.equal((await deliverEmail(now)).status,'free-limit');sql.prepare('UPDATE notification_email_budget SET attempts=0').run();
const reportConcurrent=await Promise.all([deliverEmail(now),deliverEmail(now)]);assert.ok(reportConcurrent.some(r=>r.status==='busy'));assert.ok(reportConcurrent.some(r=>r.status==='accepted'));
makeReport();mode='timeout';await deliverEmail(now);now+=24*3600000;assert.equal((await deliverEmail(now)).status,'uncertain-expired');
assert.ok(sql.prepare('SELECT count(*) n FROM bug_reports').get().n>0,'Report remains available even if mail fails');
console.log('PASS owner report email: atomic queue, full details, escaping, fixed recipient, shared daily/rolling budget, lease, stable retries, single delivery and retained reports.');
