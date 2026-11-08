import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {standings} from '../lib/race.mjs';
import {shouldDisband} from '../lib/sync-policy.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
let queryCount=0,fail='',maxQueries=0;
const db={prepare(q){queryCount++;const st=sql.prepare(q);const bound=(args=[])=>({first:async()=>st.get(...args)||null,all:async()=>({results:st.all(...args)}),run:async()=>{if(fail&&q.includes(fail)){fail='';throw Error('Injected database failure');}return {meta:{changes:Number(st.run(...args).changes)}};}});return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const now=Date.parse('2026-11-08T12:00:00Z');
globalThis.deletionEnv={DB:db,APP_ORIGIN:'https://storkleague.fans',ACCOUNT_DELETION_ENABLED:'true',CLERK_SECRET_KEY:'fixture',CLERK_PUBLISHABLE_KEY:'fixture',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',EMAIL_FROM:'fixture@notify.storkleague.fans'};
let identity='delete-me',fresh=true,profileCalls=[];
globalThis.deletionClerk={authenticateRequest:async()=>({isAuthenticated:!!identity,toAuth:()=>({userId:identity,has:({reverification})=>{assert.equal(reverification,'strict');return fresh;}})}),users:{getUser:async id=>({id,username:'OldName'}),getUserList:async({userId})=>{profileCalls.push(...userId);return {data:userId.map(id=>({id,username:id,imageUrl:null}))};}}};
await build({entryPoints:{cleanup:'lib/account-deletion.ts',endpoint:'app/api/account/route.ts',auth:'lib/auth.ts',profiles:'lib/profiles.ts',delivery:'lib/notification-delivery.ts',email:'lib/notification-email.ts'},outdir:'.runner/deletion',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/clerk-client$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.deletionEnv;':'export const clerkClient=()=>globalThis.deletionClerk;'}));}}]});
const {beginDeletion,processDeletion}=await import('../.runner/deletion/cleanup.mjs');
const {POST}=await import('../.runner/deletion/endpoint.mjs');const {getUser}=await import('../.runner/deletion/auth.mjs');
const {nameLeagues}=await import('../.runner/deletion/profiles.mjs');
const {deliverNotificationEvent}=await import('../.runner/deletion/delivery.mjs');const {deliverEmail}=await import('../.runner/deletion/email.mjs');
let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('No external calls allowed');};
const member=(id,name=id)=>({id,name,imageUrl:'https://private.invalid/photo/'+id,email:id+'@example.test'});
const league=(id,status,members=[member('delete-me','OldName'),member('remaining')])=>({id,invite:id.padEnd(6,'0'),owner:id==='other'?'remaining':'delete-me',name:'Fixture '+id,year:status==='ready'?2026:2027,status,members,picks:status==='lobby'?[]:[{userId:'delete-me',birdId:'b1',bird:{name:'Bird One'}},{userId:'remaining',birdId:'b2',bird:{name:'Bird Two'}}].slice(0,status==='draft'?1:2),size:1,trades:status==='ready'?[{id:'pending-trade',from:'delete-me',to:'remaining',offer:['b1'],request:['b2'],status:'pending'}]:[]});
const original=league('race','ready');
for(const l of [league('lobby','lobby',[member('delete-me','OldName'),member('first-joined'),member('last-joined')]),league('empty','lobby',[member('delete-me','OldName')]),league('draft','draft'),original,league('other','lobby',[member('remaining'),member('other-manager')])])sql.prepare('INSERT INTO leagues(id,invite,state) VALUES(?,?,?)').run(l.id,l.invite,JSON.stringify(l));
const fix=(id,time)=>({eventId:id,tagId:'synthetic',observedAt:time,longitude:10,latitude:50});
const raceResults=['b1','b2'].map((birdId,i)=>({birdId,year:2026,version:4,startedAt:'2026-07-02T00:00:00Z',checkedAt:'2026-07-02T00:00:00Z',changedAt:'2026-06-01T00:00:00Z',arrival:{...fix('a'+i,`2026-03-0${i+1}T12:00:00Z`),qualityVersion:4,support:'repeat-inside',confirmation:fix('c'+i,`2026-03-0${i+1}T13:00:00Z`)}}));
const scoreBefore=standings(original,raceResults,now);
const event=(id,leagueId,body)=>({id,leagueId,leagueName:'Fixture',title:'Trade accepted',body,category:'trades',createdAt:now-100,emailSuppressed:false,read:false});
const state=events=>({emailUnsubscribeToken:crypto.randomUUID()+crypto.randomUUID(),since:now-1000,preferences:{trades:true,email_trades:true},events,raceSnapshots:{},leagueSnapshots:{race:{members:['delete-me','remaining'],revision:1}},sourceCursors:{}});
sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run('delete-me',JSON.stringify(state([event('mine','race','OldName accepted')])));
sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run('remaining',JSON.stringify(state([event('joined:delete-me','race','OldName accepted'),event('old-name','race','EvenOlderName offered a trade'),event('safe','other','Unrelated message')])));
sql.prepare('INSERT INTO scout_lists VALUES(?,?,?,?,?)').run('list','delete-me','MVP','star',1);sql.prepare('INSERT INTO scout_list_birds VALUES(?,?)').run('list','b1');
sql.prepare('INSERT INTO bug_reports(id,user_id,title,area,description,created_at) VALUES(?,?,?,?,?,?)').run('report','delete-me','Private','privacy','Private account details',now);
sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('league-join-rate:delete-me','{}');
sql.prepare('INSERT INTO race_notification_cycles VALUES(?,?,?)').run('cycle',now,now);
sql.prepare('INSERT INTO race_notification_cycle_leagues VALUES(?,?,?)').run('cycle','race',JSON.stringify({league:original,results:raceResults}));
sql.prepare('INSERT INTO notification_email_batches(id,user_id,payload,created_at,status,first_attempt_at) VALUES(?,?,?,?,?,?)').run('attempted','remaining',JSON.stringify({events:[event('joined:delete-me','race','OldName accepted')],message:{to:['remaining@example.test'],text:'OldName accepted'}}),now,'pending',now);
const request=(body={action:'delete',confirmation:'DELETE'},origin='https://fixture.test')=>POST(new Request('https://fixture.test/api/account',{method:'POST',headers:{origin,'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify(body)}));
assert.equal((await request(undefined,'https://evil.test')).status,403);identity=null;await assert.rejects(request(),e=>e.code==='session-unverified');identity='delete-me';
assert.equal((await request({action:'delete',confirmation:'no'})).status,400);fresh=false;assert.equal((await request()).status,403);assert.equal(sql.prepare('SELECT count(*) n FROM account_deletions').get().n,0);fresh=true;
sql.prepare('INSERT INTO notification_email_lock VALUES(1,?,?)').run('sending',Date.now()+60000);assert.equal((await request()).status,409);sql.exec('DELETE FROM notification_email_lock');
fail='DELETE FROM scout_lists';await assert.rejects(beginDeletion(deletionEnv,'delete-me',now));assert.equal(sql.prepare('SELECT count(*) n FROM account_deletions').get().n,0);assert.ok(sql.prepare('SELECT 1 FROM scout_lists').get());
assert.equal((await request({action:'delete',confirmation:'DELETE',userId:'remaining'})).status,202);fresh=false;assert.equal((await request()).status,202);
const job=sql.prepare('SELECT * FROM account_deletions').get();assert.equal(job.user_id,'delete-me');assert.ok(job.alias.startsWith('deleted_'));
assert.equal(sql.prepare("SELECT count(*) n FROM notification_accounts WHERE user_id='delete-me'").get().n,0);
assert.equal(sql.prepare('SELECT count(*) n FROM scout_list_birds').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM bug_report_email').get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM sync_state WHERE id='league-join-rate:delete-me'").get().n,0);
await assert.rejects(getUser(new Request('https://fixture.test/api/leagues',{headers:{Authorization:'Bearer stale'}})),e=>e.code==='account-deleted');
assert.throws(()=>sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run('delete-me','{}'),/deletion/);
assert.throws(()=>sql.prepare('UPDATE leagues SET state=? WHERE id=?').run(JSON.stringify(original),'race'),/manager/);
assert.equal((await deliverNotificationEvent()).status,'account-cleanup');assert.equal((await deliverEmail()).status,'account-cleanup');assert.equal(externalCalls,0);
fail='UPDATE leagues SET state';let t=Date.now(),identityAttempts=0;const deleteIdentity=async id=>{assert.equal(id,'delete-me');if(++identityAttempts===1)throw Error('Transient Clerk failure');};
let finished=false;
for(let n=0;n<250;n++){queryCount=0;const r=await processDeletion(deletionEnv,{now:t,deleteIdentity});maxQueries=Math.max(maxQueries,queryCount);if(r.status==='retry-needed')t+=3600001;if(r.status==='complete'){finished=true;break;}}
assert.ok(finished);assert.equal(identityAttempts,2);assert.ok(maxQueries<50,`Free queries ${maxQueries}`);
const read=id=>JSON.parse(sql.prepare('SELECT state FROM leagues WHERE id=?').get(id).state);
assert.equal(read('lobby').owner,'first-joined');assert.deepEqual(read('lobby').members.map(m=>m.id),['first-joined','last-joined']);assert.equal(read('empty').status,'disbanded');
assert.equal(read('draft').status,'draft');assert.ok(shouldDisband(read('draft'),Date.parse('2027-01-16T06:00:00Z')));
const after=read('race');assert.equal(after.owner,'remaining');assert.equal(read('draft').owner,'remaining');assert.equal(after.members[0].name,'Deleted manager');assert.equal(after.members[0].imageUrl,undefined);assert.equal(after.members[0].email,undefined);assert.equal(after.trades[0].status,'cancelled');
const scoreAfter=standings(after,raceResults,now);assert.deepEqual(scoreAfter.birds.map(b=>[b.birdId,b.rank,b.points,b.arrival]),scoreBefore.birds.map(b=>[b.birdId,b.rank,b.points,b.arrival]));assert.equal(scoreAfter.teams.find(m=>m.userId===job.alias).points,scoreBefore.teams.find(m=>m.userId==='delete-me').points);
await nameLeagues([after]);assert.ok(!profileCalls.includes(job.alias));
for(const table of ['leagues','notification_accounts','notification_outbox','race_notification_cycle_leagues','notification_email_queue','notification_email_batches','bug_reports','scout_lists']){const rows=sql.prepare(`SELECT * FROM ${table}`).all();const serialized=JSON.stringify(rows);assert.ok(!serialized.includes('delete-me'),table+' retains identity');assert.ok(!serialized.includes('OldName'),table+' retains display name');}
const inbox=JSON.parse(sql.prepare("SELECT payload FROM notification_accounts WHERE user_id='remaining'").get().payload);assert.equal(inbox.events.find(e=>e.id==='safe').body,'Unrelated message');assert.ok(!JSON.stringify(inbox).includes('EvenOlderName'));
assert.equal(sql.prepare("SELECT status FROM notification_email_batches WHERE id='attempted'").get().status,'privacy-cancelled');assert.equal(sql.prepare('SELECT payload FROM account_deletions').get().payload,'{}');
assert.equal((await processDeletion(deletionEnv,{now:t,deleteIdentity})).status,'empty');assert.equal(externalCalls,0);
console.log('PASS automatic deletion: confirmation/reverification, CSRF/ownership, sender lease, atomic rollback, stale-write guards, retryable cleanup/identity deletion, lobby transfer, empty lobby, expired draft, historical scoring, private data/queued email removal, no provider calls; max queries',maxQueries);
const {discoverDeletedAccounts}=await import('../.runner/deletion/cleanup.mjs');
const discoveryTime=Date.now()+2*86400000;
sql.prepare('INSERT INTO account_registry(user_id) VALUES(?)').run('clerk-removed');
assert.equal((await discoverDeletedAccounts(deletionEnv,{now:discoveryTime,lookup:async()=>{throw Error('Simulated outage');}})).status,'retry-needed');
assert.equal(sql.prepare('SELECT count(*) n FROM account_deletions').get().n,1);
assert.equal((await discoverDeletedAccounts(deletionEnv,{now:discoveryTime+900001,lookup:async()=>({data:[],totalCount:0})})).status,'retry-needed');
assert.equal(sql.prepare('SELECT count(*) n FROM account_deletions').get().n,1,'No live anchor must not mass-delete');
const discovery=await discoverDeletedAccounts(deletionEnv,{now:discoveryTime+1800002,lookup:async ids=>{const data=ids.filter(id=>id!=='clerk-removed').map(id=>({id}));return {data,totalCount:data.length};}});
assert.equal(discovery.queued,1);assert.ok(sql.prepare("SELECT 1 FROM account_deletions WHERE user_id='clerk-removed'").get());
for(let n=0;n<250;n++){const r=await processDeletion(deletionEnv,{now:discoveryTime+1800002,deleteIdentity:async()=>{}});if(r.status==='complete')break;}
assert.equal(sql.prepare("SELECT status FROM account_deletions WHERE user_id='clerk-removed'").get().status,'complete');
// Queued snapshots cannot recreate a deleted account after maintenance resumes.
for(let n=0;n<100;n++){const r=await deliverNotificationEvent();if(r.status==='empty')break;assert.equal(r.status,'delivered');}
assert.equal(sql.prepare("SELECT count(*) n FROM notification_accounts WHERE user_id='delete-me' OR user_id LIKE 'deleted_%'").get().n,0);
const sent=[];globalThis.fetch=async(url,options)=>{
 if(url.includes('api.clerk.com')){assert.ok(!url.includes('delete-me')&&!url.includes('deleted_'));return Response.json({primary_email_address_id:'p',email_addresses:[{id:'p',email_address:'remaining@example.test',verification:{status:'verified'}}]});}
 assert.ok(url.includes('api.brevo.com'));const body=JSON.parse(options.body);sent.push(body);return Response.json({messageId:'mock-'+sent.length});
};
for(let n=0;n<20;n++){const r=await deliverEmail();if(r.status==='empty')break;assert.ok(['accepted','nothing-eligible','skipped'].includes(r.status),r.status);}
assert.ok(sent.length>0,'Unrelated opted-in mail resumes');assert.equal(new Set(sent.map(m=>m.headers.idempotencyKey)).size,sent.length);assert.ok(sent.every(m=>!JSON.stringify(m).includes('OldName')&&!JSON.stringify(m).includes('delete-me')));
console.log('PASS Clerk orphan reconciliation fails closed; notification queue resumes without deleted recipients, old names or duplicate mocked email.');
// Simulate an old, privately restored snapshot, with its later receipt reapplied.
const {reapplyDeletionReceipt}=await import('../.runner/deletion/cleanup.mjs');
sql.exec('DELETE FROM account_deletions');
sql.prepare("UPDATE leagues SET state=?,revision=revision+1 WHERE id='race'").run(JSON.stringify(original));
sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run('delete-me',JSON.stringify(state([])));
await assert.rejects(reapplyDeletionReceipt(deletionEnv,{user_id:'bad',alias:'invalid',requested_at:now}));
assert.equal((await reapplyDeletionReceipt(deletionEnv,{user_id:job.user_id,alias:job.alias,requested_at:job.requested_at})).accepted,true);
identity='delete-me';await assert.rejects(getUser(new Request('https://fixture.test/api/leagues',{headers:{Authorization:'Bearer fixture'}})),e=>e.code==='account-deleted');
for(let n=0;n<250;n++){const r=await processDeletion(deletionEnv,{deleteIdentity:async()=>{}});if(r.status==='complete')break;}
assert.equal(read('race').members[0].id,job.alias);assert.equal(read('race').members[0].name,'Deleted manager');assert.equal(sql.prepare("SELECT count(*) n FROM notification_accounts WHERE user_id='delete-me'").get().n,0);
console.log('PASS isolated old-backup receipt replay: stable anonymous identity, private-data removal and blocked access before recovery is served.');

// Recorded join order wins over shuffled draft order; legacy order is fallback.
const {anonymizeLeague}=await import('../lib/account-deletion-policy.mjs');
const ordered=league('ordered','ready',[member('delete-me'),{...member('late'),joinedOrder:9},{...member('early'),joinedOrder:1}]);
const anonymous=anonymizeLeague(ordered,job);assert.equal(anonymous.owner,'early');assert.deepEqual(anonymous.members.map(m=>m.id),[job.alias,'late','early']);
console.log('PASS host transfer respects recorded join order without changing draft order.');
// Exercise the real HTTP deletion adapter with a mocked already-deleted identity.
await beginDeletion(deletionEnv,'delete-404');let deleteRequests=0;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.clerk.com/v1/users/delete-404');assert.equal(options.method,'DELETE');deleteRequests++;return new Response('',{status:404});};
for(let n=0;n<100;n++){const r=await processDeletion(deletionEnv);if(r.status==='complete')break;}
assert.equal(deleteRequests,1);assert.equal(sql.prepare("SELECT status FROM account_deletions WHERE user_id='delete-404'").get().status,'complete');
console.log('PASS actual identity adapter accepts mocked Clerk 404 without sending email.');
