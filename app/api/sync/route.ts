import {env} from 'cloudflare:workers';
import {database,getBirds,json} from '../../../lib/store';
import {readMovebank,readMovebankEvents,timestamp,validEvent} from '../../../lib/feed.mjs';
import {distanceMiles,countryLabel} from '../../../lib/geo';
import {syncPolicy,speciesOf,sameRing} from '../../../lib/sync-policy.mjs';
import {disbandExpired} from '../../../lib/disband';
import seed from '../../../data/seed.json';
export const dynamic='force-dynamic';
const stamp=(v:number)=>new Date(v).toISOString().replace(/[-:TZ.]/g,'');
const DAY=86400000;
export async function POST(req:Request){
 const secrets=env as any;if(!secrets.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${secrets.SYNC_SECRET}`)return json({error:'Unauthorized'},401);
 if(!secrets.MOVEBANK_API_TOKEN)return json({error:'Movebank credential not configured'},503);
 const input:any=await req.json().catch(()=>({}));
 if(input.action==='register-schedules'){
  if(!Array.isArray(input.scheduleIds)||input.scheduleIds.length!==2||input.scheduleIds.some((id:any)=>typeof id!=='string'||id.length>200))return json({error:'Two verified schedule identifiers required'},400);
  await database().prepare('INSERT INTO sync_state(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind('schedules',JSON.stringify({enabled:true,scheduleIds:input.scheduleIds,registeredAt:new Date().toISOString()})).run();return json({registered:true});
 }
 const study=seed.studies.find(s=>s.studyId===String(input.studyId));if(!study)return json({error:'Study is not approved'},400);
 const db=database(),now=Date.now(),policy=syncPolicy(now);await disbandExpired(now);
 const stateRow=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind('study:'+study.studyId).first();const state=stateRow?JSON.parse(stateRow.payload):null;
 if(input.reconcile!==true&&state?.importerVersion===2&&state?.lastSuccessSlot===policy.slot)return json({studyId:study.studyId,status:'skipped',reason:'Current sync interval already completed',lastSuccessAt:state.lastSuccessAt});
 const lease=crypto.randomUUID();
 await db.prepare("DELETE FROM sync_state WHERE id='source-lock' AND json_extract(payload,'$.expiresAt')<?").bind(now).run();
 const got=await db.prepare("INSERT OR IGNORE INTO sync_state(id,payload) VALUES('source-lock',?)").bind(JSON.stringify({lease,expiresAt:now+15*60000})).run();if(!got.meta.changes)return json({error:'Sync already running'},409);
 const report:any={studyId:study.studyId,startedAt:new Date(now).toISOString(),status:'failed',updated:0,discovered:0,metadataRefreshed:false,intervalHours:policy.intervalHours};
 try{
  const current:any[]=await getBirds(),old=new Map(current.map(b=>[b.id,b]));
  const metaRow=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind('metadata:'+study.studyId).first();let metadata=metaRow?JSON.parse(metaRow.payload):null;
  const discovery=input.reconcile===true||metadata?.importerVersion!==2||metadata?.day!==policy.discoveryDay;
  if(discovery){
   const info=await readMovebank(secrets.MOVEBANK_API_TOKEN,study.studyId,'study');const expected=study.license==='CC BY-NC 4.0'?'CC_BY_NC':'CC_BY';
   if(info.length!==1||info[0].i_have_download_access!=='true'||info[0].license_type!==expected)throw Error('Study access or license changed; review required');
   const individuals=await readMovebank(secrets.MOVEBANK_API_TOKEN,study.studyId,'individual');
   const deployments=await readMovebank(secrets.MOVEBANK_API_TOKEN,study.studyId,'deployment',{attributes:'id,individual_id,tag_id,deploy_on_timestamp,deploy_off_timestamp'});
   if(!individuals.length||!('taxon_canonical_name' in individuals[0]||'individual_taxon_canonical_name' in individuals[0]))throw Error('Individual metadata schema changed');
   metadata={importerVersion:2,day:policy.discoveryDay,individuals,deployments};report.metadataRefreshed=true;
  }
  const {individuals,deployments}=metadata;
  const latest=new Map<string,any>(),hourly=new Map<string,Map<number,any>>();let valid=0;
  const query:any={sensor_type:'gps',timestamp_start:stamp(now-30*DAY),attributes:'individual_local_identifier,tag_local_identifier,timestamp,location_long,location_lat,visible,individual_taxon_canonical_name'};
  // Daily full reconciliation discovers new eligible birds and catches corrected records.
  // Other runs use the documented update timestamp, with overlap for late telemetry.
  if(!discovery&&state?.lastSuccessAt)query.update_ts_start=stamp(Date.parse(state.lastSuccessAt)-DAY);
  report.eventRows=await readMovebankEvents(secrets.MOVEBANK_API_TOKEN,study.studyId,query,(e:any)=>{
   if(!validEvent(e,now))return;valid++;const name=e.individual_local_identifier,t=timestamp(e.timestamp);
   if(!latest.has(name)||t>timestamp(latest.get(name).timestamp))latest.set(name,e);
   if(!hourly.has(name))hourly.set(name,new Map());const bucket=Math.floor(t/3600000),slots=hourly.get(name)!;
   if(!slots.has(bucket)||t>timestamp(slots.get(bucket).timestamp))slots.set(bucket,e);
  });report.validEventRows=valid; if(discovery&&report.eventRows===0&&current.some(b=>b.studyId===study.studyId&&Date.parse(b.latestValidFixUtc)>=now-30*DAY))throw Error('Movebank unexpectedly returned an empty event export; existing data retained');
  const statements=[];
  for(const animal of individuals){
   if(speciesOf(animal)!=='Ciconia ciconia')continue;
   const name=animal.local_identifier,id=study.studyId+':'+name,e=latest.get(name),previous:any=old.get(id);
   if(!previous&&(!discovery||!e))continue;
   const b:any=previous?{...previous}:{id,name,studyId:study.studyId,study:study.study,sourceUrl:study.sourceUrl,history:[],ageYears:null,minimumAgeYears:null,distanceObservedKm:null};
   b.ringId=animal.ring_id||previous?.ringId||null;b.sex=animal.sex||null;b.recordedDead=Boolean(animal.mortality_date);
   b.minimumAgeYears=animal.latest_date_born?Math.round((now-timestamp(animal.latest_date_born))/(365.2425*DAY)*100)/100:null;
   b.ageYears=animal.exact_date_of_birth?Math.round((now-timestamp(animal.exact_date_of_birth))/(365.2425*DAY)*100)/100:null;
   const own=deployments.filter((d:any)=>d.individual_id===animal.id);b.currentDeployment=own.some((d:any)=>d.deploy_on_timestamp&&timestamp(d.deploy_on_timestamp)<=now&&(!d.deploy_off_timestamp||timestamp(d.deploy_off_timestamp)>now));
   if(e&&(!previous?.syncedAt||timestamp(e.timestamp)>=Date.parse(previous.latestValidFixUtc))){
    const lat=Number(e.location_lat),lon=Number(e.location_long),moved=lat!==b.latitude||lon!==b.longitude;
    b.latitude=lat;b.longitude=lon;b.latestValidFixUtc=new Date(timestamp(e.timestamp)).toISOString();b.latestTagId=e.tag_local_identifier;
    if(moved||!previous?.syncedAt)b.distanceToGermanyMiles=distanceMiles(lon,lat);
    if(moved||!previous?.syncedAt){const country=countryLabel(lon,lat);b.countryCode=country.code;b.country=country.name;}
   }
   // A full reconciliation is authoritative when the previous fix has been withdrawn.
   if(discovery&&!e)b.reviewRequired=true;
   else b.reviewRequired=Boolean(Math.abs(b.distanceToGermanyMiles-450)<5||!own.length);
   b.duplicateRingReview=Boolean(b.ringId&&current.some(other=>other.id!==id&&sameRing(other.ringId,b.ringId)));b.reviewRequired=b.reviewRequired||b.duplicateRingReview;
   if(hourly.has(name)){
    const h=new Map((discovery?[]:(b.history||[])).map((p:any)=>[p[2],p]));
    for(const event of hourly.get(name)!.values()){const t=new Date(timestamp(event.timestamp)).toISOString();h.set(t,[Number(event.location_long),Number(event.location_lat),t]);}
    const track:any[]=[...h.values()].filter((p:any)=>Date.parse(p[2])>=now-30*DAY).sort((a:any,c:any)=>Date.parse(a[2])-Date.parse(c[2]));
    b.history=track.filter((_:any,i:number)=>i%Math.max(1,Math.ceil(track.length/240))===0);if(track.length&&b.history.at(-1)!==track.at(-1))b.history.push(track.at(-1));
    // Do not carry the old audit's distance into a new reporting window.
    b.distanceObservedKm=null;b.historyDescription='Hourly samples of valid observations from the past 30 days';
   }
   b.syncedAt=new Date().toISOString();statements.push(db.prepare('INSERT INTO birds(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind(id,JSON.stringify(b)));report.updated++;if(!previous)report.discovered++;
  }
  // D1 batches are atomic; source/schema errors cannot publish a half-written study.
  statements.push(db.prepare('INSERT INTO sync_state(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind('metadata:'+study.studyId,JSON.stringify(metadata)));
  const lastSuccessAt=new Date().toISOString();statements.push(db.prepare('INSERT INTO sync_state(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind('study:'+study.studyId,JSON.stringify({importerVersion:2,lastSuccessAt,lastSuccessSlot:policy.slot,discoveryDay:metadata.day})));
  await db.batch(statements);
  // Hold both entries if a newly discovered ring duplicates an existing bird.
  const all:any[]=await getBirds();for(const b of all){if(b.ringId&&all.some(other=>other.id!==b.id&&sameRing(other.ringId,b.ringId))&&!b.duplicateRingReview){b.duplicateRingReview=true;b.reviewRequired=true;await db.prepare('INSERT INTO birds(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind(b.id,JSON.stringify(b)).run();}}
  report.status='succeeded';report.lastSuccessAt=lastSuccessAt;
 }catch(e:any){report.error=String(e.message).includes('Movebank')||String(e.message).includes('Study')||String(e.message).includes('metadata')||String(e.message).includes('event')?String(e.message).replace(/api-token=[^&\s]+/g,'api-token=[redacted]'):'Sync processing failed; existing data retained';}
 finally{await db.prepare("DELETE FROM sync_state WHERE id='source-lock' AND json_extract(payload,'$.lease')=?").bind(lease).run();}
 report.finishedAt=new Date().toISOString();await db.prepare('INSERT INTO sync_runs(id,payload) VALUES(?,?)').bind(report.finishedAt+':'+study.studyId,JSON.stringify(report)).run();
 await db.prepare('DELETE FROM sync_runs WHERE id<?').bind(new Date(now-90*DAY).toISOString()).run();
 return json(report,report.status==='succeeded'?200:502);
}
