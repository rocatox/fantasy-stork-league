import {readMovebank,readMovebankEvents,timestamp,validEvent} from '../lib/feed.mjs';
import {distanceMiles,countryLabel,BOUNDARY_VERSION} from '../lib/geo';
import {syncPolicy,speciesOf,sameRing} from '../lib/sync-policy.mjs';
const DAY=86400000;
const stamp=(v:number)=>new Date(v).toISOString().replace(/[-:TZ.]/g,'');
export async function buildStudy({study,current,metadata,state,token,force=false,now=Date.now()}:any){
 const policy=syncPolicy(now);const report:any={studyId:study.studyId,startedAt:new Date(now).toISOString(),status:'running',updated:0,discovered:0,metadataRefreshed:false,intervalHours:policy.intervalHours};
  const old=new Map(current.map((b:any)=>[b.id,b]));
  const discovery=force||metadata?.importerVersion!==2||metadata?.day!==policy.discoveryDay;
  if(discovery){
   const info=await readMovebank(token,study.studyId,'study');const expected=study.license==='CC BY-NC 4.0'?'CC_BY_NC':'CC_BY';
   if(info.length!==1||info[0].i_have_download_access!=='true'||info[0].license_type!==expected)throw Error('Study access or license changed; review required');
   const individuals=await readMovebank(token,study.studyId,'individual');
   const deployments=await readMovebank(token,study.studyId,'deployment',{attributes:'id,individual_id,tag_id,deploy_on_timestamp,deploy_off_timestamp'});
   if(!individuals.length||!('taxon_canonical_name' in individuals[0]||'individual_taxon_canonical_name' in individuals[0]))throw Error('Individual metadata schema changed');
   metadata={importerVersion:2,day:policy.discoveryDay,individuals,deployments};report.metadataRefreshed=true;
  }
  const {individuals,deployments}=metadata;
  const latest=new Map<string,any>(),hourly=new Map<string,Map<number,any>>();let valid=0;
  const query:any={sensor_type:'gps',timestamp_start:stamp(now-30*DAY),attributes:'individual_local_identifier,tag_local_identifier,timestamp,location_long,location_lat,visible,individual_taxon_canonical_name'};
  // Daily full reconciliation discovers new eligible birds and catches corrected records.
  // Other runs use the documented update timestamp, with overlap for late telemetry.
  if(!discovery&&state?.lastSuccessAt)query.update_ts_start=stamp(Date.parse(state.lastSuccessAt)-DAY);
  report.eventRows=await readMovebankEvents(token,study.studyId,query,(e:any)=>{
   if(!validEvent(e,now))return;valid++;const name=e.individual_local_identifier,t=timestamp(e.timestamp);
   if(!latest.has(name)||t>timestamp(latest.get(name).timestamp))latest.set(name,e);
   if(!hourly.has(name))hourly.set(name,new Map());const bucket=Math.floor(t/3600000),slots=hourly.get(name)!;
   if(!slots.has(bucket)||t>timestamp(slots.get(bucket).timestamp))slots.set(bucket,e);
  });report.validEventRows=valid; if(discovery&&report.eventRows===0&&current.some(b=>b.studyId===study.studyId&&Date.parse(b.latestValidFixUtc)>=now-30*DAY))throw Error('Movebank unexpectedly returned an empty event export; existing data retained');
  const birds:any[]=[];
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
    if(moved||!previous?.syncedAt||previous?.boundaryVersion!==BOUNDARY_VERSION)b.distanceToGermanyMiles=distanceMiles(lon,lat);
    if(moved||!previous?.syncedAt||previous?.boundaryVersion!==BOUNDARY_VERSION){const country=countryLabel(lon,lat);b.countryCode=country.code;b.country=country.name;b.boundaryVersion=BOUNDARY_VERSION;}
   }
   if(b.boundaryVersion!==BOUNDARY_VERSION){b.distanceToGermanyMiles=distanceMiles(b.longitude,b.latitude);const c=countryLabel(b.longitude,b.latitude);b.countryCode=c.code;b.country=c.name;b.boundaryVersion=BOUNDARY_VERSION;}
   // A full reconciliation is authoritative when the previous fix has been withdrawn.
   if(discovery&&!e)b.reviewRequired=true;
   else b.reviewRequired=Boolean(Math.abs(b.distanceToGermanyMiles-450)<50/1609.344||!own.length);
   b.duplicateRingReview=Boolean(b.ringId&&current.some(other=>other.id!==id&&sameRing(other.ringId,b.ringId)));b.reviewRequired=b.reviewRequired||b.duplicateRingReview;
   if(hourly.has(name)){
    const h=new Map((discovery?[]:(b.history||[])).map((p:any)=>[p[2],p]));
    for(const event of hourly.get(name)!.values()){const t=new Date(timestamp(event.timestamp)).toISOString();h.set(t,[Number(event.location_long),Number(event.location_lat),t]);}
    const track:any[]=[...h.values()].filter((p:any)=>Date.parse(p[2])>=now-30*DAY).sort((a:any,c:any)=>Date.parse(a[2])-Date.parse(c[2]));
    b.history=track.filter((_:any,i:number)=>i%Math.max(1,Math.ceil(track.length/240))===0);if(track.length&&b.history.at(-1)!==track.at(-1))b.history.push(track.at(-1));
    // Do not carry the old audit's distance into a new reporting window.
    b.distanceObservedKm=null;b.historyDescription='Hourly samples of valid observations from the past 30 days';
   }
   b.syncedAt=new Date().toISOString();birds.push(b);report.updated++;if(!previous)report.discovered++;
  }
 const lastSuccessAt=new Date().toISOString();report.status='succeeded';report.lastSuccessAt=lastSuccessAt;report.finishedAt=lastSuccessAt;
 return {studyId:study.studyId,birds,metadata,state:{importerVersion:2,lastSuccessAt,lastSuccessSlot:policy.slot,discoveryDay:metadata.day},report};
}
