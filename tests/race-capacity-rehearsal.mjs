import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {arrivalCollector} from '../lib/race-observations.mjs';
import {standings} from '../lib/race.mjs';
import {newNotificationAccount} from '../lib/notifications.mjs';
const [birdCount=100,leagueCount=10,hours=24,overlap=0]=process.argv.slice(2).map(Number);
assert.ok([birdCount,leagueCount,hours,overlap].every(Number.isInteger)&&birdCount>=48&&birdCount<=500&&leagueCount>=1&&leagueCount<=100&&hours>=1&&hours<=24&&[0,1].includes(overlap));
const RealDate=Date;let now=Date.parse('2027-03-01T00:00:00Z');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
// Never forward HTTP: self-calls are routed to local handlers; all other destinations fail closed.
let sent=[],selfCalls=0,clerkCalls=0;
globalThis.fetch=async()=>{throw Error('Network disabled before fixture setup');};
const sql=new DatabaseSync(':memory:');sql.function('unixepoch',()=>Math.floor(now/1000));
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,invite TEXT UNIQUE,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0002_history','0003_history_parts','0004_race','0005_bird_portraits','0007_notifications','0008_notification_outbox','0009_notification_race_scope','0010_notification_email','0011_bug_reports','0012_bug_report_email','0013_email_digest'])sql.exec(readFileSync('drizzle/'+m+'.sql','utf8'));
let active=null;const metrics={};
async function measure(label,fn){const parent=active,s={queries:0,returnedRows:0,returnedBytes:0};active=s;const started=performance.now(),cpu=process.cpuUsage();try{return await fn();}finally{const elapsed=performance.now()-started,c=process.cpuUsage(cpu);active=parent;const m=metrics[label]??={calls:0,queries:0,maxQueries:0,returnedRows:0,returnedBytes:0,totalMs:0,maxMs:0,cpuMs:0};m.calls++;m.queries+=s.queries;m.maxQueries=Math.max(m.maxQueries,s.queries);m.returnedRows+=s.returnedRows;m.returnedBytes+=s.returnedBytes;m.totalMs+=elapsed;m.maxMs=Math.max(m.maxMs,elapsed);m.cpuMs+=(c.user+c.system)/1000;}}
const db={prepare(q){const st=sql.prepare(q);const bound=(args=[])=>{const execute=kind=>{if(active)active.queries++;const result=st[kind](...args);if(active&&kind!=='run'){active.returnedRows+=kind==='all'?result.length:result?1:0;active.returnedBytes+=Buffer.byteLength(JSON.stringify(result??null));}return result;};return {run:async()=>({meta:{changes:Number(execute('run').changes)}}),first:async()=>execute('get')||null,all:async()=>({results:execute('all')})};};return {...bound(),bind:(...a)=>bound(a)};},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const st of statements)r.push(await st.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const studies=Array.from({length:8},(_,i)=>({studyId:String(1000+i)}));
globalThis.capacityEnv={DB:db,SYNC_SECRET:'fixture',APP_ORIGIN:'https://storkleague.fans',EMAIL_ENABLED:'true',BREVO_API_KEY:'fixture',CLERK_SECRET_KEY:'fixture',EMAIL_FROM:'updates@notify.storkleague.fans'};
const out='.runner/race-capacity';mkdirSync(out,{recursive:true});
await build({entryPoints:['lib/race-endpoint.ts','lib/snapshot-endpoint.ts','lib/notification-delivery.ts','lib/notification-email.ts','lib/geo.ts'],outdir:out,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'isolation',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.capacityEnv;',loader:'js'}));b.onLoad({filter:/data[\\/]seed\.json$/},()=>({contents:JSON.stringify({birds:[],studies}),loader:'json'}));}}]});
const {POST:race}=await import('../'+out+'/race-endpoint.mjs');
const {POST:snapshot}=await import('../'+out+'/snapshot-endpoint.mjs');
const {deliverNotificationEvent,pumpNotifications}=await import('../'+out+'/notification-delivery.mjs');
const {deliverEmail,pumpEmails}=await import('../'+out+'/notification-email.mjs');
const {germanyPosition,germanyInteriorMargin}=await import('../'+out+'/geo.mjs');
globalThis.fetch=async(url,options={})=>{
 url=String(url);
 if(url==='https://storkleague.fans/api/notification-jobs'){selfCalls++;const {action}=JSON.parse(options.body);assert.ok(['deliver','email'].includes(action));return Response.json(await measure(action==='deliver'?'notification-delivery':'email-delivery',()=>action==='deliver'?deliverNotificationEvent(now):deliverEmail(now)));}
 if(url.startsWith('https://api.clerk.com/v1/users/')){clerkCalls++;const id=url.split('/').pop();return Response.json({primary_email_address_id:'primary',email_addresses:[{id:'primary',email_address:id+'@example.test',verification:{status:'verified'}}]});}
 assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(options.headers['api-key'],'fixture');const body=JSON.parse(options.body);assert.ok(body.to.every(r=>r.email.endsWith('@example.test')));sent.push(body);return Response.json({messageId:'mock-'+sent.length});
};
const boundary=JSON.parse(readFileSync('data/boundary-source.json')).version;
const birds=Array.from({length:birdCount},(_,i)=>({id:studies[i%8].studyId+':Bird '+i,name:'Bird '+i,studyId:studies[i%8].studyId,latitude:42,longitude:2,latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:700,countryCode:'ES',currentDeployment:true,recordedDead:false,reviewRequired:false,boundaryVersion:boundary,history:[]}));
for(const b of birds)sql.prepare('INSERT INTO birds VALUES(?,?)').run(b.id,JSON.stringify(b));
const leagues=[];
for(let n=0;n<leagueCount;n++){
 const members=Array.from({length:8},(_,i)=>({id:`manager-${n}-${i}`,name:`Manager ${i}`}));
 const l={id:'league-'+n,name:'Synthetic league '+n,invite:String(n).padStart(6,'0'),year:2027,status:'ready',owner:members[0].id,size:6,members,picks:[],trades:[],swaps:[]};
 for(let i=0;i<48;i++){const j=(i+(overlap?0:n*13))%birdCount,b=birds[j];l.picks.push({birdId:b.id,userId:members[i%8].id,bird:b,individualId:String(j+1),pickedAt:'2027-01-10T00:00:00Z'});}
 for(const m of members){const a=newNotificationAccount(now-86400000);a.preferences.email_race=true;a.preferences.email_leagueRace=true;a.emailUnsubscribeToken=crypto.randomUUID()+crypto.randomUUID();sql.prepare('INSERT INTO notification_accounts(user_id,payload) VALUES(?,?)').run(m.id,JSON.stringify(a));}
 leagues.push(l);sql.prepare('INSERT INTO leagues VALUES(?,?,?,0)').run(l.id,l.invite,JSON.stringify(l));
}
const counts=()=>({outbox:sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,pendingEmail:sql.prepare("SELECT COUNT(*) n FROM notification_email_queue WHERE status='pending'").get().n});
// Establish existing race baselines without simulating a signup flood.
while(counts().outbox)await measure('baseline-delivery',()=>deliverNotificationEvent(now));
const admin=async(handler,body,label)=>{const r=await measure(label,()=>handler(new Request('https://storkleague.fans/api/'+(handler===race?'race':'sync'),{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)})));const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));await pumpNotifications(globalThis.capacityEnv,false,4);return value;};
const queue=await admin(race,{action:'queue'},'race-queue');const targets=queue.targets;assert.equal(targets.length,new Set(leagues.flatMap(l=>l.picks.map(p=>p.birdId))).size);
const resultFor=(target,arrived)=>{const i=birds.findIndex(b=>b.id===target.birdId),name=birds[i].name;const c=arrivalCollector({year:2027,individual:{id:String(i+1),local_identifier:name},deployments:[{individual_id:String(i+1),tag_local_identifier:'tag-'+i,deploy_on_timestamp:'2026-01-01T00:00:00Z'}],classify:germanyPosition,interior:germanyInteriorMargin,now});const add=(at,lon,lat,suffix)=>c.add({event_id:`${i}-${suffix}`,timestamp:at,individual_local_identifier:name,individual_taxon_canonical_name:'Ciconia ciconia',tag_local_identifier:'tag-'+i,location_long:String(lon),location_lat:String(lat),visible:'true'});add('2027-01-16T06:00:00Z',2,42,'base');if(arrived){add('2027-02-28T10:00:00Z',10,51,'arrival');add('2027-02-28T11:00:00Z',10,51,'confirm');}return {...c.result(),individualId:String(i+1),boundaryVersion:boundary,startedAt:new Date(now).toISOString()};};
const timeline=[];let peakOutbox=0;
for(let h=0;h<hours;h++){
 now=Date.parse('2027-03-01T00:00:00Z')+h*3600000;
 for(const study of studies){const subset=birds.filter(b=>b.studyId===study.studyId).map(b=>({...b,latestValidFixUtc:new Date(now).toISOString()}));const {lease}=await admin(snapshot,{action:'context',studyId:study.studyId},'snapshot-context');const timestamp=new Date(now).toISOString();await admin(snapshot,{action:'commit',studyId:study.studyId,lease,birds:subset,metadata:{individuals:subset.map(b=>({id:String(birds.findIndex(x=>x.id===b.id)+1),local_identifier:b.name})),deployments:[]},state:{lastSuccessAt:timestamp,lastSuccessSlot:'2027-03-01:'+String(h).padStart(2,'0')},report:{studyId:study.studyId,status:'succeeded',lastSuccessAt:timestamp,startedAt:timestamp}},'snapshot-commit');}
 for(let j=0;j<targets.length;j++){const t=targets[j],{lease}=await admin(race,{action:'claim',birdId:t.birdId,year:2027},'race-claim');await admin(race,{action:'commit',birdId:t.birdId,year:2027,lease,result:resultFor(t,h>=1&&j<8)},'race-commit');peakOutbox=Math.max(peakOutbox,counts().outbox);}
 // Simulated time advances; same production pump limits, no inbox/page visits.
 for(let minute=0;minute<60;minute++){now=Date.parse('2027-03-01T00:00:00Z')+h*3600000+minute*60000;if([11,26,41,56].includes(minute))await pumpNotifications(globalThis.capacityEnv,false,12);await measure('email-timer',()=>pumpEmails(globalThis.capacityEnv));}
 timeline.push({hour:h+1,...counts(),sent:sent.length});if(h%4===0||h===hours-1)console.log(JSON.stringify(timeline.at(-1)));
 assert.ok(sent.length<=270,'daily budget exceeded');
}
const results=sql.prepare('SELECT payload FROM race_results').all().map(r=>JSON.parse(r.payload));assert.equal(results.length,targets.length);
for(const l of leagues){const s=standings(l,results,now);assert.equal(s.birds.length,48);const arrived=hours>1?l.picks.filter(p=>targets.slice(0,8).some(t=>t.birdId===p.birdId)).length:0;assert.equal(s.birds.filter(b=>b.arrival).length,arrived);for(const b of s.birds)assert.equal(b.points,b.arrival?48-(arrived-1)/2:0);assert.equal(s.teams.reduce((n,t)=>n+t.points,0),s.birds.reduce((n,b)=>n+b.points,0));}
const accepted=sql.prepare("SELECT COUNT(*) n FROM notification_email_queue WHERE status='accepted'").get().n;assert.equal(accepted,sent.length);assert.equal(sql.prepare("SELECT COUNT(DISTINCT provider_id) n FROM notification_email_batches WHERE status='accepted'").get().n,sent.length);
for(const row of sql.prepare('SELECT payload FROM notification_accounts').all()){const a=JSON.parse(row.payload);assert.equal(new Set(a.events.map(e=>e.id)).size,a.events.length);}
const report={scenario:{birdCount,leagueCount,managers:leagueCount*8,hours,overlap:!!overlap,uniqueRaceTargets:targets.length},timeline,peakOutbox,final:counts(),mockedEmails:sent.length,selfCalls,clerkCalls,sqliteChangedRowsIncludingTriggers:sql.prepare('SELECT total_changes() n').get().n,metrics,limitations:['Local SQLite/Node timings are not Cloudflare CPU or billed D1 row-scan measurements.','Snapshots and validated race results use production handlers; no Movebank network or GitHub runner capacity measured.','Eight synthetic studies; fixture leagues already drafted; no live credentials, DNS or emails.','Run race-capacity-history.mjs separately for full-resolution archive write/read and incremental checks.','Background callbacks serialized; real contention may reduce throughput.']};
writeFileSync(`${out}/result-${birdCount}-${leagueCount}-${hours}-${overlap}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({scenario:report.scenario,final:report.final,mockedEmails:sent.length,peakOutbox,maxQueries:Object.fromEntries(Object.entries(metrics).map(([k,m])=>[k,m.maxQueries]))}));sql.close();globalThis.Date=RealDate;
