import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {operationalChecks,alertTransition,STUDY_IDS,HOUR} from '../lib/operational-policy.mjs';
import {scheduledJobs,SYNC_CRON,EMAIL_CRON} from '../lib/scheduled-jobs.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const f of ['0004_race','0007_notifications','0010_notification_email','0011_bug_reports','0012_bug_report_email','0013_email_digest','0018_operations'])sql.exec(readFileSync(`drizzle/${f}.sql`,'utf8'));
const db={prepare(q){const s=sql.prepare(q);const bound=(a=[])=>({run:async()=>({meta:{changes:Number(s.run(...a).changes),size_after:10000000}}),first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const config={DB:db,HISTORY_ARCHIVE:db,HISTORY_ARCHIVE_2:db,HISTORY_SHARD_COUNT:'2',OPERATIONS_ENABLED:'true',GITHUB_SYNC_TOKEN:'fixture',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans',BUG_REPORT_EMAIL:'owner@example.test',APP_ORIGIN:'https://storkleague.fans'};
globalThis.opsEnv=config;
await build({entryPoints:['lib/operational-monitor.ts'],outfile:'.runner/ops-monitor.mjs',bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['lib/notification-email.ts'],outfile:'.runner/ops-email.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.opsEnv',loader:'js'}));}}]});
const {runOperations,backupStatus,collectOperations}=await import('../.runner/ops-monitor.mjs');
const {deliverEmail}=await import('../.runner/ops-email.mjs');
let now=Date.parse('2027-02-02T12:00:00Z');
const healthy=()=>({now,backup:{completedAt:new Date(now-HOUR).toISOString()},sources:{values:STUDY_IDS.map(studyId=>({studyId,lastSuccessAt:new Date(now-HOUR).toISOString()}))},databases:{main:10000000,history:300000000,history2:10000000},email:{pending:0,oldest:null,failed:0}});
assert.ok(operationalChecks(healthy()).every(c=>c.level==='ok'));
let sample=healthy();sample.sources.values[0].lastSuccessAt=new Date(now-3*HOUR).toISOString();assert.equal(operationalChecks(sample).find(c=>c.id==='sync').level,'critical');
sample=healthy();sample.databases.history=400000000;assert.equal(operationalChecks(sample).find(c=>c.id==='storage:history').level,'warning-expand');
sample=healthy();sample.backup.completedAt=new Date(now-31*HOUR).toISOString();sample.email={pending:101,oldest:now-2*HOUR,failed:0};
assert.equal(operationalChecks(sample).find(c=>c.id==='backup').level,'critical');assert.equal(operationalChecks(sample).find(c=>c.id==='email').level,'warning');
const collect=async()=>({...sample,now});
await runOperations(config,{now,collect});assert.equal(sql.prepare('SELECT count(*) n FROM operational_email').get().n,0);
assert.equal((await runOperations(config,{now,collect})).status,'locked-or-current');
now+=15*60000;await Promise.all([runOperations(config,{now,collect}),runOperations(config,{now,collect})]);assert.equal(sql.prepare('SELECT count(*) n FROM operational_email').get().n,1);
const notices=JSON.parse(sql.prepare('SELECT payload FROM operational_email').get().payload);assert.deepEqual(notices.map(n=>n.id),['backup','email']);
now+=15*60000;await runOperations(config,{now,collect});assert.equal(sql.prepare('SELECT count(*) n FROM operational_email').get().n,1);
let calls=[],timeout=true;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');calls.push(JSON.parse(options.body));if(timeout)throw new TypeError('simulated ambiguous delivery');return Response.json({messageId:'mocked-id'});};
assert.equal((await deliverEmail(now)).status,'retry-needed');now+=60000;timeout=false;assert.equal((await deliverEmail(now)).status,'accepted');assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0].to,[{email:'owner@example.test'}]);assert.equal((await deliverEmail(now)).status,'empty');assert.equal(calls.length,2);
// Recovery takes two good samples, and a repeated healthy sample cannot duplicate it.
now+=15*60000;sample=healthy();await runOperations(config,{now,collect});now+=15*60000;sample=healthy();await runOperations(config,{now,collect});assert.equal(sql.prepare('SELECT count(*) n FROM operational_email').get().n,2);
const recovery=JSON.parse(sql.prepare("SELECT payload FROM operational_email WHERE status='pending'").get().payload);assert.ok(recovery.every(n=>n.level==='recovered'));
sql.prepare('INSERT INTO notification_email_budget(period,attempts) VALUES(?,270) ON CONFLICT(period) DO UPDATE SET attempts=270').run('day:'+new Date(now).toISOString().slice(0,10));assert.equal((await deliverEmail(now)).status,'free-limit');assert.equal(calls.length,2);sql.exec('DELETE FROM notification_email_budget');
assert.equal((await deliverEmail(now)).status,'accepted');assert.equal(calls.length,3);
const bad={id:'x',level:'critical',message:'x'};let t=alertTransition(null,bad,now);t=alertTransition(t.state,bad,now+HOUR);assert.ok(t.notice);assert.equal(alertTransition(t.state,bad,now+2*HOUR).notice,null);assert.ok(alertTransition(t.state,bad,now+25*HOUR).notice);
assert.equal(alertTransition(t.state,{...bad,level:'unknown'},now+2*HOUR).notice,null);
// Off-season cadence is six hours; missing/invalid timestamps never look healthy.
const offseason=healthy();offseason.now=Date.parse('2026-11-08T04:00:00Z');offseason.sources.values=STUDY_IDS.map(studyId=>({studyId,lastSuccessAt:new Date(offseason.now-7*HOUR).toISOString()}));
assert.equal(operationalChecks(offseason).find(c=>c.id==='sync').level,'ok');offseason.sources.values.pop();assert.equal(operationalChecks(offseason).find(c=>c.id==='sync').level,'critical');
for(const [bytes,level] of [[349999999,'ok'],[350000000,'warning'],[400000000,'warning-expand'],[450000000,'critical'],[null,'unknown']]){const s=healthy();s.databases.history=bytes;assert.equal(operationalChecks(s).find(c=>c.id==='storage:history').level,level);}
for(const email of [{pending:500,oldest:now,failed:0},{pending:1,oldest:now-24*HOUR,failed:0},{pending:0,oldest:null,failed:1}]){const s=healthy();s.email=email;assert.equal(operationalChecks(s).find(c=>c.id==='email').level,'critical');}
// Pending operational mail cannot retry beyond provider idempotency protection.
sql.prepare('INSERT INTO operational_email(id,created_at,payload,first_attempt_at) VALUES(?,?,?,?)').run('expired-retry',now-HOUR,JSON.stringify([bad]),now-HOUR);
assert.equal((await deliverEmail(now)).status,'uncertain-expired');assert.equal(calls.length,3);
// Successful but skipped workflow jobs are not accepted as verified backups.
const github=async url=>Response.json(url.includes('/jobs')?{jobs:[{conclusion:'success',steps:[{name:'Capture, restore-check, encrypt and upload privately',conclusion:url.includes('/1/')?'skipped':'success',completed_at:new Date(now).toISOString()}]}]}:{workflow_runs:[1,2].map(id=>({id,status:'completed',conclusion:'success'}))});
assert.equal((await backupStatus(config,github)).runId,2);
assert.equal((await backupStatus(config,async()=>Response.json({workflow_runs:[]}))).completedAt,null);
for(const id of STUDY_IDS)sql.prepare('INSERT INTO sync_state VALUES(?,?)').run('study:'+id,JSON.stringify({lastSuccessAt:new Date(now).toISOString()}));
const actual=await collectOperations(config,now,github);assert.equal(actual.backup.runId,2);assert.equal(actual.sources.values.length,8);assert.equal(Object.keys(actual.databases).length,3);assert.equal(actual.email.pending,0);
const unavailable=await collectOperations(config,now,async()=>new Response('',{status:403}));assert.ok(unavailable.backup.error);
const invoked=[],jobs={sync:async()=>{invoked.push('sync');throw Error('simulated sync failure');},notifications:async()=>invoked.push('notifications'),operations:async()=>invoked.push('operations'),email:async()=>invoked.push('email')};
await assert.rejects(scheduledJobs({cron:SYNC_CRON},config,jobs));assert.ok(invoked.includes('operations'));invoked.length=0;await scheduledJobs({cron:EMAIL_CRON},config,jobs);assert.deepEqual(invoked,['email']);
console.log('PASS isolated operations: thresholds, cadence, atomic deduplication, recovery, cooldown, sender retry/idempotency, shared free budget, skipped backups rejected, all stores sampled, failures isolated. No real network/email.');
