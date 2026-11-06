// Local end-to-end season: synthetic Movebank-shaped events, real collector,
// authenticated writer, SQLite triggers, background pump and private inbox API.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {arrivalCollector} from '../lib/race-observations.mjs';
import {standings} from '../lib/race.mjs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,invite TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0004_race','0007_notifications','0008_notification_outbox'])sql.exec(readFileSync(`drizzle/${m}.sql`,'utf8'));
const RealDate=Date,DAY=86400000;let now=Date.parse('2027-01-12T12:00:00Z'),queries=0,maxDeliveryQueries=0,failUser=null,inboxReads=0;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
sql.function('unixepoch',()=>Math.floor(now/1000));
const db={prepare(q){queries++;const s=sql.prepare(q);const bound=(a=[])=>({run:async()=>{if(failUser&&q.startsWith('UPDATE notification_accounts SET payload=')&&a[1]===failUser){failUser=null;throw Error('Simulated interrupted fanout');}return {meta:{changes:Number(s.run(...a).changes)}};},first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.seasonNotificationEnv={DB:db,SYNC_SECRET:'synthetic-test-only',APP_ORIGIN:'https://season.test'};globalThis.seasonNotificationUser=null;
await build({entryPoints:['lib/race-endpoint.ts','lib/notification-delivery.ts','app/api/notifications/route.ts','lib/geo.ts'],outdir:'.runner/notification-season',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',plugins:[{name:'local-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'local'}));b.onResolve({filter:/lib\/auth$/},()=>({path:'auth',namespace:'local'}));b.onLoad({filter:/.*/,namespace:'local'},a=>({contents:a.path==='env'?'export const env=globalThis.seasonNotificationEnv':'export const getUser=async()=>globalThis.seasonNotificationUser',loader:'js'}));}}]});
const {POST:racePost}=await import('../.runner/notification-season/lib/race-endpoint.mjs');
const {GET:inboxGet,POST:inboxPost}=await import('../.runner/notification-season/app/api/notifications/route.mjs');
const {deliverNotificationEvent:deliver,notificationTick:tick,pumpNotifications:pump}=await import('../.runner/notification-season/lib/notification-delivery.mjs');
const {germanyPosition,germanyInteriorMargin,BOUNDARY_VERSION}=await import('../.runner/notification-season/lib/geo.mjs');
const members=[{id:'own-only',race:true,leagueRace:false},{id:'league-only',race:false,leagueRace:true},{id:'both',race:true,leagueRace:true},{id:'neither',race:false,leagueRace:false}].map(m=>({...m,name:m.id}));
const birds=members.flatMap((m,i)=>['migrant','control'].map(kind=>({id:`24442409:Simulation-${i}-${kind}`,individual:{id:`synthetic-${i}-${kind}`,local_identifier:`Simulation-${i}-${kind}`},userId:m.id,kind,offset:i})));
const league={id:'simulated-season',name:'Simulated season',year:2027,status:'ready',size:2,members:members.map(({id,name})=>({id,name})),picks:birds.map(b=>({birdId:b.id,userId:b.userId,individualId:b.individual.id,bird:{name:b.individual.local_identifier}})),trades:[]};
sql.prepare('INSERT INTO leagues(id,state,invite) VALUES(?,?,?)').run(league.id,JSON.stringify(league),'not-a-real-invite');
const account=id=>JSON.parse(sql.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').get(id).payload);
const departures=id=>account(id).events.filter(e=>e.title==='Migration detected');
const visibleDepartures=id=>departures(id).filter(e=>!e.suppressed);
const setPrefs=async(m,prefs)=>{globalThis.seasonNotificationUser={userId:m.id};const r=await inboxPost(new Request('https://season.test/api/notifications',{method:'POST',headers:{origin:'https://season.test','content-type':'application/json'},body:JSON.stringify({action:'preferences',preferences:prefs})}));assert.equal(r.status,200);};
// The HTTP transport is local; the production background processor handles each job.
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://season.test/api/notification-jobs');assert.equal(options.headers.Authorization,'Bearer synthetic-test-only');assert.equal(options.redirect,'manual');const {action}=JSON.parse(options.body);try{if(action==='tick')return Response.json(await tick(now));assert.equal(action,'deliver');queries=0;const result=await deliver(now);maxDeliveryQueries=Math.max(maxDeliveryQueries,queries);assert.ok(queries<50);return Response.json(result);}catch{return Response.json({error:'Simulated delivery failure'}, {status:500});}};
const background=async()=>{for(let i=0;i<10;i++){const result=await pump(globalThis.seasonNotificationEnv,true,12);if(result.status==='empty')return;}throw Error('Queue did not drain');};
await background();for(const m of members)await setPrefs(m,{race:m.race,leagueRace:m.leagueRace});globalThis.seasonNotificationUser=null;
function events(b){const controls=[[35,35,35,35,35,35.1,35.2,35.1,35,35.1,35],[35,35,35,35,35,65,35,35,35,35,35],[35,35,35,35,35,36,37,38,35,35,35],[35,35,35,35,35,36,36,37,37,38,38]];const lats=b.kind==='migrant'?[35,35,35,35,35,36,36,37,37,38,38]:controls[b.offset];return lats.flatMap((lat,i)=>[0,1].map(h=>({event_id:`${b.individual.id}-${i}-${h}`,timestamp:new Date(Date.parse('2027-02-01T08:00Z')+(i+b.offset)*DAY+h*3600000).toISOString(),individual_local_identifier:b.individual.local_identifier,individual_taxon_canonical_name:'Ciconia ciconia',tag_local_identifier:b.individual.id,location_long:'-5',location_lat:String(lat),visible:'true'})));}
const histories=new Map(birds.map(b=>[b.id,events(b).filter((_,i)=>!(b.kind==='control'&&b.offset===3&&(i===12||i===13)))]));
const delayedBird=birds.find(b=>b.kind==='migrant'&&b.offset===3),delayedFix=histories.get(delayedBird.id).pop();
const admin=body=>racePost(new Request('https://season.test/api/race',{method:'POST',headers:{authorization:'Bearer synthetic-test-only'},body:JSON.stringify(body)}));
async function commit(b){const c=arrivalCollector({year:2027,individual:b.individual,deployments:[{individual_id:b.individual.id,tag_local_identifier:b.individual.id,deploy_on_timestamp:'2026-01-01T00:00Z'}],classify:germanyPosition,interior:germanyInteriorMargin,now});histories.get(b.id).filter(e=>Date.parse(e.timestamp)<=now).forEach(e=>c.add(e));const result=c.result();const claim=await admin({action:'claim',birdId:b.id,year:2027});assert.equal(claim.status,200);const {lease}=await claim.json();const body={action:'commit',birdId:b.id,year:2027,lease,result:{...result,individualId:b.individual.id,boundaryVersion:BOUNDARY_VERSION,startedAt:new Date(now).toISOString()}};assert.equal((await admin(body)).status,200);return {body,result};}
// Daily incremental imports; no notification GET or browser visit during the race.
for(let day=0;day<17;day++){
 now=Date.parse('2027-02-01T12:00Z')+day*DAY;
 if(day===16)histories.get(delayedBird.id).push(delayedFix); // Three-day transmission delay, original observation time retained.
 for(const b of birds){const {result}=await commit(b);assert.equal(!!result.migrationStart,b.kind==='migrant'&&day>=(b.id===delayedBird.id?16:10+b.offset));}
 if(day===10){failUser='league-only';await assert.rejects(background(),/HTTP 500/);assert.equal(departures('own-only').length,1,'First recipient persisted before interruption');assert.ok(sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n>0);}
 await background();assert.equal(inboxReads,0);
}
const expected={'own-only':1,'league-only':4,both:4,neither:0};
for(const m of members){assert.equal(departures(m.id).length,4,'One durable record per migrating bird even when suppressed');assert.equal(visibleDepartures(m.id).length,expected[m.id]);assert.ok(departures(m.id).every(e=>!e.read));assert.ok(!JSON.stringify(account(m.id)).includes('longitude'));}
// Same-slot retries and replaying an already consumed source snapshot are harmless.
const prior=members.map(m=>departures(m.id).length);now+=1000;const repeated=await commit(birds[0]);assert.equal((await admin(repeated.body)).status,409);const replay=sql.prepare('SELECT payload FROM notification_outbox ORDER BY id DESC LIMIT 1').get().payload;await background();
sql.prepare('INSERT INTO notification_outbox(event_key,created_at,payload) VALUES(?,?,?)').run('synthetic-redelivery',now,replay);await background();assert.deepEqual(members.map(m=>departures(m.id).length),prior);
// A corrected/withdrawn source signal, followed by restored data, never repeats departure.
const saved=histories.get(birds[0].id);histories.set(birds[0].id,saved.map(e=>({...e,visible:'false'})));now+=1000;await commit(birds[0]);await background();histories.set(birds[0].id,saved);now+=1000;await commit(birds[0]);await background();assert.deepEqual(members.map(m=>departures(m.id).length),prior);
// First app open reads persisted, unread alerts. Reads cannot advance the source baseline.
const matrix=[];
for(const m of members){globalThis.seasonNotificationUser={userId:m.id};const snapshot=JSON.stringify(account(m.id).raceSnapshots);inboxReads++;const data=await (await inboxGet(new Request('https://season.test/api/notifications'))).json();const items=data.items.filter(e=>e.title==='Migration detected');assert.equal(items.length,expected[m.id]);assert.ok(items.every(e=>!e.read));assert.equal(JSON.stringify(account(m.id).raceSnapshots),snapshot);matrix.push({myRace:m.race,leagueRace:m.leagueRace,migrationAlerts:items.length});}
// Enabling both later must not resurrect suppressed departures.
await setPrefs(members[3],{race:true,leagueRace:true});globalThis.seasonNotificationUser={userId:'neither'};assert.equal((await (await inboxGet(new Request('https://season.test/api/notifications'))).json()).items.filter(e=>e.title==='Migration detected').length,0);await setPrefs(members[3],{race:false,leagueRace:false});globalThis.seasonNotificationUser=null;
// All four migrants finish; the control birds remain nonfinishers.
for(const b of birds.filter(b=>b.kind==='migrant')){histories.get(b.id).push(...[0,1].map(h=>({...events(b)[0],event_id:`${b.individual.id}-arrival-${h}`,timestamp:new Date(Date.parse('2027-03-01T10:00Z')+b.offset*DAY+h*3600000).toISOString(),location_long:'10',location_lat:'51'})));}
for(let day=0;day<4;day++){now=Date.parse('2027-03-01T12:00Z')+day*DAY;for(const b of birds)await commit(b);await background();}
for(const m of members)assert.equal(account(m.id).events.filter(e=>e.title==='Arrival confirmed'&&!e.suppressed).length,expected[m.id]);
// Final results settle while the app is closed and obey only My race updates.
now=Date.parse('2027-07-05T12:00Z');for(const b of birds)await commit(b);await background();
const results=sql.prepare('SELECT payload FROM race_results').all().map(r=>JSON.parse(r.payload)),board=standings(league,results,now);assert.equal(board.status,'complete');assert.equal(board.birds.filter(b=>b.status==='nonfinisher').length,4);
for(const m of members){const finals=account(m.id).events.filter(e=>e.title==='Final results'&&!e.suppressed);assert.equal(finals.length,m.race?1:0);if(m.race){const t=board.teams.find(t=>t.userId===m.id);assert.ok(finals[0].body.includes('#'+t.rank));assert.ok(finals[0].body.includes(t.points+' points'));}}
await background();for(const m of members)assert.equal(account(m.id).events.filter(e=>e.title==='Final results').length,1);
globalThis.seasonNotificationUser={userId:'outsider'};assert.equal((await (await inboxGet(new Request('https://season.test/api/notifications'))).json()).items.length,0);
const report={mode:'Local simulated 2027 season; no production writes or external requests',detectorVersion:2,birds:8,migrants:4,nonfinishers:4,matrix,offlineRecording:true,delayedGPSRecordedOnce:true,interruptedDeliveryRecovered:true,duplicatePrevention:true,suppressedAlertsNotResurrected:true,finalResultsUseMyRaceOnly:true,maxDeliveryQueries,notificationQueue:sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n};
writeFileSync('.runner/notification-season-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
globalThis.fetch=nativeFetch;globalThis.Date=RealDate;sql.close();
