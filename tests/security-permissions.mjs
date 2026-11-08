import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const RealDate=Date,now=Date.parse('2027-01-10T12:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
globalThis.fetch=async()=>{throw Error('External HTTP forbidden during security audit');};
const sql=new DatabaseSync(':memory:');sql.function('unixepoch',()=>Math.floor(now/1000));
sql.exec('PRAGMA foreign_keys=ON;CREATE TABLE leagues(id TEXT PRIMARY KEY,invite TEXT UNIQUE,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const f of ['0004_race','0006_scout_lists','0007_notifications','0008_notification_outbox','0010_notification_email','0011_bug_reports','0012_bug_report_email','0013_email_digest'])sql.exec(readFileSync(`drizzle/${f}.sql`,'utf8'));
const db={prepare(q){const s=sql.prepare(q);const bound=(a=[])=>({run:async()=>({meta:{changes:Number(s.run(...a).changes)}}),first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.securityEnv={DB:db};
await build({entryPoints:['app/api/leagues/route.ts','app/api/lists/route.ts','app/api/notifications/route.ts','app/api/bug-reports/route.ts','lib/league-invites.ts','lib/bounded-json.ts'],outdir:'.runner/security',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'isolated',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 b.onResolve({filter:/lib\/(auth|profiles)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.securityEnv;':a.path==='auth'?`export async function getUser(req){const id=req.headers.get('authorization')?.replace(/^Bearer /,'');return ['alice','bob','eve'].includes(id)?{userId:id,displayName:id}:null;}`:'export const nameLeagues=async leagues=>leagues;'}));
}}]});
const routes={};for(const name of ['leagues','lists','notifications','bug-reports'])routes[name]=await import(`../.runner/security/app/api/${name}/route.mjs`);
const req=(route,user,body,headers={})=>new Request('https://app.test/api/'+route,{method:body===undefined?'GET':'POST',headers:{...(user?{authorization:'Bearer '+user}:{}),origin:'https://app.test','content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const post=async(route,user,body,status=200,headers={})=>{const r=await routes[route].POST(req(route,user,body,headers));assert.equal(r.status,status,route+': '+await r.clone().text());return r.json();};
for(const [name,route] of Object.entries(routes)){
 await post(name,null,{action:'readAll'},401);await post(name,'forged',{action:'readAll'},401);
 await post(name,'alice',{action:'readAll'},403,{origin:'https://attacker.test'});
 await post(name,'alice',{action:'readAll'},403,{'content-type':'text/plain'});
 const missingOrigin=req(name,'alice',{});missingOrigin.headers.delete('origin');assert.equal((await route.POST(missingOrigin)).status,403);
 if(name!=='bug-reports')await post(name,'alice','{"extra":"'+'a'.repeat(20000)+'"}',413);
}
// A forged user/owner in the JSON cannot change the authenticated actor.
let l=(await post('leagues','alice',{action:'create',name:'Private fixture',owner:'eve',userId:'eve',members:[{id:'eve'}]})).league;
assert.equal(l.owner,'alice');assert.deepEqual(l.members.map(m=>m.id),['alice']);
assert.deepEqual((await (await routes.leagues.GET(req('leagues','eve'))).json()).leagues,[]);
for(const action of ['start','disband','leave','pick','replace','swap','proposeTrade','acceptTrade','declineTrade','cancelTrade'])await post('leagues','eve',{action,id:l.id,birdId:'none',originalBirdId:'none',tradeId:'none'},404);
l=(await post('leagues','bob',{action:'join',invite:l.invite})).league;
await post('leagues','bob',{action:'disband',id:l.id},403);
await post('leagues','bob',{action:'start',id:l.id},409);
await post('leagues','alice',{action:'leave',id:l.id},403);
// Inaccessible disbanded leagues return the same answer as missing leagues.
await post('leagues','alice',{action:'disband',id:l.id});
const hidden=await post('leagues','eve',{action:'start',id:l.id},404),missing=await post('leagues','eve',{action:'start',id:'missing'},404);assert.deepEqual(hidden,missing);
// One user's rejected action must not run maintenance over other users' leagues.
const old={id:'old-private',invite:'000001',name:'Private old',owner:'alice',year:2026,status:'lobby',members:[{id:'alice'}],picks:[]};sql.prepare('INSERT INTO leagues(id,invite,state) VALUES(?,?,?)').run(old.id,old.invite,JSON.stringify(old));
await post('leagues','eve',{action:'start',id:old.id},404);assert.equal(JSON.parse(sql.prepare('SELECT state FROM leagues WHERE id=?').get(old.id).state).status,'lobby');
let lists=(await post('lists','alice',{action:'create',name:'Private list',icon:'trophy',userId:'eve'})).lists;const listId=lists[0].id;
assert.deepEqual((await (await routes.lists.GET(req('lists','eve'))).json()).lists,[]);
for(const action of ['delete','membership'])await post('lists','eve',{action,id:listId,birdId:'bird',add:true},404);
await post('notifications','alice',{action:'preferences',preferences:{email_trades:true},userId:'eve'});
const before=sql.prepare("SELECT payload FROM notification_accounts WHERE user_id='alice'").get().payload;
await post('notifications','eve',{action:'preferences',preferences:{email_trades:false},userId:'alice'});
await post('notifications','eve',{action:'readAll',userId:'alice'});assert.equal(sql.prepare("SELECT payload FROM notification_accounts WHERE user_id='alice'").get().payload,before);
await post('notifications','alice',{action:'preferences',preferences:{emailUnsubscribeToken:'forged'}},400);
await post('notifications','alice',{action:'testEmail'},400);assert.equal(sql.prepare('SELECT count(*) n FROM notification_email_queue').get().n,0);
const report={id:crypto.randomUUID(),title:'Private report',description:'Synthetic report with <script> text.',area:'other',user_id:'eve'};
await post('bug-reports','alice',report,201);await post('bug-reports','eve',report,409);assert.equal(sql.prepare('SELECT user_id FROM bug_reports').get().user_id,'alice');assert.equal(sql.prepare('SELECT count(*) n FROM bug_report_email').get().n,1);
// Shared-IP limits survive rotating accounts and concurrent guesses; no raw IP persists.
const {allowJoinAttempt}=await import('../.runner/security/lib/league-invites.mjs');
const network=await Promise.all(Array.from({length:40},(_,i)=>allowJoinAttempt(db,'network-'+i,now,'192.0.2.12')));assert.equal(network.filter(Boolean).length,30);
assert.equal(await allowJoinAttempt(db,'fresh',now,'192.0.2.13'),true);
const account=await Promise.all(Array.from({length:15},()=>allowJoinAttempt(db,'same-account',now)));assert.equal(account.filter(Boolean).length,10);
assert.ok(!JSON.stringify(sql.prepare("SELECT * FROM sync_state WHERE id LIKE 'league-join-ip:%'").all()).includes('192.0.2.'));
assert.equal(await allowJoinAttempt(db,'same-account',now+1200000,'192.0.2.12'),true);assert.equal(sql.prepare("SELECT count(*) n FROM sync_state WHERE id LIKE 'league-join-ip:%'").get().n,1);
const {boundedJson}=await import('../.runner/security/lib/bounded-json.mjs');
let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(20000));},cancel(){cancelled=true;}});
await assert.rejects(boundedJson(new Request('https://app.test',{method:'POST',duplex:'half',body:stream})),e=>e.status===413);assert.ok(cancelled);
assert.deepEqual(await boundedJson(new Request('https://app.test',{method:'POST',body:'{"valid":true}'})),{valid:true});
await assert.rejects(boundedJson(new Request('https://app.test',{method:'POST',body:'{'})),e=>e.status===400);
assert.match(readFileSync('public/_headers','utf8'),/frame-ancestors 'none'/);
// Real administrative handlers reject unauthenticated/incorrect bearer requests
// before parsing input or touching a database. Their high-volume inputs stay separate.
await build({entryPoints:['lib/snapshot-endpoint.ts','lib/history-endpoint.ts','lib/race-endpoint.ts','lib/capacity.ts'],outdir:'.runner/security-admin',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export const env=globalThis.securityEnv;'}));}}]});
globalThis.securityEnv={SYNC_SECRET:'isolated-secret'};
for(const file of ['snapshot-endpoint','history-endpoint','race-endpoint','capacity']){
 const module=await import(`../.runner/security-admin/${file}.mjs`),handler=module.POST||module.capacity;
 for(const authorization of ['', 'Bearer wrong'])assert.equal((await handler(new Request('https://app.test/api/private',{method:'POST',headers:{authorization},body:'not-json'}))).status,401);
}
console.log('PASS security: isolated account/league/list/inbox/report boundaries, actor spoofing, host privileges, private-state concealment, scoped maintenance, CSRF, bounded streaming, retired test-email rejection, atomic account/network invite limits. No external requests or real emails.');
