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
sql.function('unixepoch',()=>Math.floor(now/1000));
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,invite TEXT UNIQUE,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0004_race','0007_notifications','0008_notification_outbox','0014_race_notification_changes','0015_race_initial_notifications','0010_notification_email','0013_email_digest'])sql.exec(readFileSync('drizzle/'+m+'.sql','utf8'));
let conflict=false,advanceOnMetadata=false,advanceOnWrite=false;
const db={prepare(query){const stmt=sql.prepare(query);const bound=(args=[])=>({async run(){if(advanceOnWrite&&query.includes('unixepoch')){advanceOnWrite=false;now=cutoff(2027);}if(conflict&&query.startsWith('UPDATE leagues SET state=')){conflict=false;sql.prepare('UPDATE leagues SET revision=revision+1').run();}return {meta:{changes:Number(stmt.run(...args).changes)}};},async first(){if(advanceOnMetadata&&query.includes('SELECT payload FROM sync_state')){advanceOnMetadata=false;now=cutoff(2027);}return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}});return {...bound(),bind(...args){return bound(args);}};}};
db.batch=async statements=>{sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}};
globalThis.leagueEnv={DB:db,SYNC_SECRET:'fixture',APP_ORIGIN:'https://storkleague.fans',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans'};globalThis.leagueUser={userId:'owner',displayName:'Owner'};
await build({entryPoints:['app/api/leagues/route.ts','lib/disband.ts','lib/snapshot-endpoint.ts','lib/notification-delivery.ts','lib/notification-email.ts'],outdir:'.runner/trade-notification-flow',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/lib\/(auth|profiles)$/},a=>({path:a.path.split('/').pop(),namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.leagueEnv;':a.path==='auth'?'export const getUser=async()=>globalThis.leagueUser;':'export const nameLeagues=async l=>l;'}));b.onLoad({filter:/data[\\/]seed\.json$/},()=>({loader:'json',contents:JSON.stringify({birds:[],studies:[{studyId:'10449318'}]})}));}}]});
const {GET,POST}=await import('../.runner/trade-notification-flow/app/api/leagues/route.mjs');
const {disbandExpired}=await import('../.runner/trade-notification-flow/lib/disband.mjs');
const {POST:sync}=await import('../.runner/trade-notification-flow/lib/snapshot-endpoint.mjs');
const boundary=JSON.parse(readFileSync('data/boundary-source.json')).version;
const user=id=>globalThis.leagueUser=id?{userId:id,displayName:id}:null;
const post=async(body,status=200,headers={})=>{const r=await POST(new Request('https://storkleague.fans/api/leagues',{method:'POST',headers:{origin:'https://storkleague.fans','content-type':'application/json',...headers},body:JSON.stringify(body)}));const data=await r.json();assert.equal(r.status,status,JSON.stringify({body,data}));return data.league||data;};
const get=async()=> (await GET(new Request('https://storkleague.fans/api/leagues'))).json();
const stored=id=>JSON.parse(sql.prepare('SELECT state FROM leagues WHERE id=?').get(id).state);
function seedBirds(count){sql.exec('DELETE FROM birds');const animals=[];for(let i=0;i<count;i++){const b={id:'bird-'+i,name:'Bird '+i,studyId:'10449318',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:500,countryCode:'ES',currentDeployment:true,boundaryVersion:boundary};sql.prepare('INSERT INTO birds VALUES(?,?)').run(b.id,JSON.stringify(b));animals.push({id:String(i+1),local_identifier:b.name});}sql.prepare('INSERT OR REPLACE INTO sync_state VALUES(?,?)').run('metadata:10449318',JSON.stringify({individuals:animals}));}
const changeBird=(id,changes)=>{const b=JSON.parse(sql.prepare('SELECT payload FROM birds WHERE id=?').get(id).payload);sql.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({...b,...changes}),id);};
async function league(players){user('owner');let l=await post({action:'create',name:'Test flock'});for(let i=1;i<players;i++){user('p'+i);l=await post({action:'join',invite:l.invite});}user('owner');return l;}

const {newNotificationAccount,notificationResponse}=await import('../lib/notifications.mjs');
const {deliverNotificationEvent}=await import('../.runner/trade-notification-flow/lib/notification-delivery.mjs');
const {deliverEmail:deliverReadyEmail}=await import('../.runner/trade-notification-flow/lib/notification-email.mjs');
const deliverEmail=(time=Date.now())=>deliverReadyEmail(time);
let sent=[];
globalThis.fetch=async(url,options)=>{
 if(url.startsWith('https://api.clerk.com/')){const id=url.split('/').pop();return Response.json({primary_email_address_id:'primary',email_addresses:[{id:'primary',email_address:id+'@example.test',verification:{status:'verified'}}]});}
 assert.equal(url,'https://api.brevo.com/v3/smtp/email');sent.push(JSON.parse(options.body));return Response.json({messageId:'fixture-'+sent.length});
};
const account=id=>JSON.parse(sql.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').get(id).payload);
const save=(id,a)=>sql.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(a),id);
async function drain(){for(let i=0;i<40;i++){const r=await deliverNotificationEvent(now);if(r.status==='empty')return;assert.equal(r.status,'delivered');}throw Error('Outbox did not drain');}
async function mail(){for(let i=0;i<40;i++){const r=await deliverEmail(now);if(r.status==='empty')return;assert.ok(['accepted','skipped'].includes(r.status),r.status);}throw Error('Email queue did not drain');}
for(const action of ['acceptTrade','declineTrade','cancelTrade','swap'])for(const inApp of [false,true])for(const email of [false,true]){
 sql.exec("DELETE FROM sync_state WHERE id LIKE 'league-join-rate:%'");
 sql.exec('DELETE FROM notification_email_queue;DELETE FROM notification_email_batches;DELETE FROM notification_email_budget;DELETE FROM notification_accounts;DELETE FROM notification_outbox;DELETE FROM leagues;');
 seedBirds(10);sent=[];
 const members=['a','b','c','d'].map(id=>({id,name:id}));
 const l={id:'scenario',invite:'fixture',name:'Fixture',owner:'a',year:2027,status:'ready',size:1,members,picks:members.map((m,i)=>({userId:m.id,birdId:'bird-'+i,individualId:String(i+1),bird:{id:'bird-'+i,name:'Bird '+i},pickedAt:new Date(now).toISOString()})),trades:[]};
 sql.prepare('INSERT INTO leagues(id,invite,state) VALUES(?,?,?)').run(l.id,'fixture',JSON.stringify(l));
 for(const m of members){const a=newNotificationAccount(now);a.preferences.trades=inApp;a.preferences.email_trades=email;a.emailUnsubscribeToken=crypto.randomUUID()+crypto.randomUUID();sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run(m.id,JSON.stringify(a));}
 await drain();
 user('a');now+=1000;let changed=await post({action:'proposeTrade',id:l.id,to:'b',offer:['bird-0'],request:['bird-1']});const tradeId=changed.trades.at(-1).id;
 if(action==='swap'){
  user('c');changed=await post({action:'proposeTrade',id:l.id,to:'a',offer:['bird-2'],request:['bird-0']});
  user('b');await post({action:'proposeTrade',id:l.id,to:'d',offer:['bird-1'],request:['bird-3']});
 }
 await drain();await mail();
 // Preserve queue tombstones and source cursors, remove earlier proposal records from assertions.
 for(const m of members){const a=account(m.id);a.events=[];save(m.id,a);}sent=[];
 const actor=['acceptTrade','declineTrade'].includes(action)?'b':'a';user(actor);now+=1000;
 if(action==='swap')changed=await post({action,id:l.id,originalBirdId:'bird-0',birdId:'bird-8'});
 else changed=await post({action,id:l.id,tradeId});
 await drain();await mail();
 const recipients=action==='swap'?['b','c']:actor==='a'?['b']:['a'];
 for(const m of members){const events=account(m.id).events.filter(e=>e.category==='trades'&&!e.actionable);assert.equal(events.length,recipients.includes(m.id)?1:0,action+' recorded for '+m.id);assert.equal(notificationResponse(account(m.id)).items.filter(e=>!e.actionable).length,inApp&&recipients.includes(m.id)?1:0,action+' visible for '+m.id);}
 assert.deepEqual(sent.flatMap(m=>m.to.map(t=>t.email)).sort(),email?recipients.map(id=>id+'@example.test').sort():[],action+' email recipients');
 const sentCount=sent.length;await drain();await mail();assert.equal(sent.length,sentCount,'No retry duplicates');
 if(action==='swap'){assert.equal(changed.trades.filter(t=>t.status==='cancelled'&&t.resolvedBy==='a').length,2);assert.equal(changed.trades.find(t=>t.from==='b'&&t.to==='d').status,'pending');}
 console.log('PASS',action,{inApp,email,recipients,actorQuiet:true});
}
// Join-by-code alerts use the draft category; retries by existing members are silent.
for(const inApp of [false,true])for(const email of [false,true]){
 sql.exec("DELETE FROM sync_state WHERE id LIKE 'league-join-rate:%'");
 sql.exec('DELETE FROM notification_email_queue;DELETE FROM notification_email_batches;DELETE FROM notification_email_budget;DELETE FROM notification_accounts;DELETE FROM notification_outbox;DELETE FROM leagues;');sent=[];
 for(const id of ['host','guest']){const a=newNotificationAccount(now);a.preferences.draft=inApp;a.preferences.email_draft=email;a.emailUnsubscribeToken=crypto.randomUUID()+crypto.randomUUID();sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run(id,JSON.stringify(a));}
 user('host');const l=await post({action:'create',name:'Code notification test'});
 sql.prepare("UPDATE leagues SET invite=?,state=json_set(state,'$.invite',?),revision=revision+1 WHERE id=?").run('012345','012345',l.id);
 await drain();await mail();sent=[];
 user('guest');await post({action:'join',invite:'012345'});await drain();await mail();
 const joined=account('host').events.filter(e=>e.title==='A manager joined');assert.equal(joined.length,1);assert.equal(joined[0].category,'draft');
 assert.ok(JSON.stringify(joined[0]).includes('guest'));
 assert.equal(notificationResponse(account('host')).items.filter(e=>e.title==='A manager joined').length,inApp?1:0);
 assert.equal(account('guest').events.filter(e=>e.title==='A manager joined').length,0);
 assert.deepEqual(sent.flatMap(m=>m.to.map(t=>t.email)),email?['host@example.test']:[]);
 if(email)assert.ok(JSON.stringify(sent[0]).includes('guest'));
 const count=sent.length;await post({action:'join',invite:'012345'});await post({action:'join',invite:'012345'});await drain();await mail();
 assert.equal(account('host').events.filter(e=>e.title==='A manager joined').length,1);assert.equal(sent.length,count);assert.equal(stored(l.id).members.length,2);
 console.log('PASS code-join host notifications',{inApp,email,repeatJoinSilent:true});
}
sql.close();globalThis.Date=RealDate;

