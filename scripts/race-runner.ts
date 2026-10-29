import {readMovebank,readMovebankEvents} from '../lib/feed.mjs';
import {arrivalCollector} from '../lib/race-observations.mjs';
import {germanyPosition,germanyInteriorMargin,BOUNDARY_VERSION} from '../lib/geo';
import {seasonWindow,RACE_VERSION} from '../lib/race.mjs';
import {syncPolicy} from '../lib/sync-policy.mjs';
const origin=process.env.APP_ORIGIN||'https://storkleague.fans',secret=process.env.SYNC_SECRET,token=process.env.MOVEBANK_API_TOKEN;
if(!secret||!token||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('Invalid race configuration');
async function api(body:any){const r=await fetch(origin+'/api/race',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Race API HTTP ${r.status}`);return r.json() as Promise<any>;}
const queue=await api({action:'queue'});if(queue.boundaryVersion!==BOUNDARY_VERSION||queue.version!==RACE_VERSION)throw Error('Race rules mismatch');
const metadata=new Map();let failed=false;const begun=Date.now();
queue.targets.sort((a:any,b:any)=>String(a.state?.checkedAt||'').localeCompare(String(b.state?.checkedAt||'')));
for(const target of queue.targets){
 if(Date.now()-begun>20*60000){console.log(JSON.stringify({status:'race-work-remaining'}));break;}
 if(target.state?.version===RACE_VERSION&&target.state?.slot===syncPolicy().slot&&target.state?.boundaryVersion===BOUNDARY_VERSION&&process.env.FORCE_RECONCILE!=='true')continue;
 let lease;
 try{
  const study=target.study;
  if(!metadata.has(study.studyId)){
   const info=await readMovebank(token,study.studyId,'study');
   if(info.length!==1||info[0].i_have_download_access!=='true'||info[0].license_type!==(study.license==='CC BY-NC 4.0'?'CC_BY_NC':'CC_BY'))throw Error('Study access or license changed');
   const individuals=await readMovebank(token,study.studyId,'individual');
   const tags=await readMovebank(token,study.studyId,'tag',{attributes:'id,local_identifier'});
   const deployments=await readMovebank(token,study.studyId,'deployment',{attributes:'id,individual_id,tag_id,deploy_on_timestamp,deploy_off_timestamp'});
   const tagNames=new Map(tags.map(t=>[String(t.id),t.local_identifier]));
   metadata.set(study.studyId,{individuals,deployments:deployments.map(d=>({...d,tag_local_identifier:tagNames.get(String(d.tag_id))}))});
  }
  const context=await api({action:'claim',birdId:target.birdId,year:target.year});lease=context.lease;
  const info=metadata.get(study.studyId),individualId=context.state?.individualId||target.individualId;
  const animal=info.individuals.find((a:any)=>individualId?String(a.id)===String(individualId):a.local_identifier===target.name);
  if(!animal||animal.taxon_canonical_name&&animal.taxon_canonical_name!=='Ciconia ciconia')throw Error('Race identity missing or changed');
  const deployments=info.deployments.filter((d:any)=>String(d.individual_id)===String(animal.id));
  if(!deployments.length||deployments.some((d:any)=>!d.tag_local_identifier))throw Error('Race deployment identity missing');
  const now=Date.now(),window=seasonWindow(target.year),collector=arrivalCollector({year:target.year,individual:animal,deployments,classify:germanyPosition,interior:germanyInteriorMargin,now});
  const stamp=(n:number)=>new Date(n).toISOString().replace(/[-:TZ.]/g,'');
  await readMovebankEvents(token,study.studyId,{sensor_type:'gps',individual_id:animal.id,timestamp_start:stamp(window.start-31*86400000),timestamp_end:stamp(Math.min(now,window.end+31*86400000)),attributes:'event_id,individual_local_identifier,tag_local_identifier,timestamp,location_long,location_lat,visible,individual_taxon_canonical_name'},(e:any)=>collector.add(e));
  const result=await api({action:'commit',birdId:target.birdId,year:target.year,lease,result:{...collector.result(),individualId:String(animal.id),startedAt:new Date(now).toISOString(),boundaryVersion:BOUNDARY_VERSION}});lease=null;
  console.log(JSON.stringify({birdId:target.birdId,year:target.year,status:result.status,revision:result.revision,arrival:result.arrival?.observedAt||null}));
 }catch{failed=true;console.error(JSON.stringify({birdId:target.birdId,year:target.year,status:'race-failed',message:'Previous committed result retained; inspect source access and deployment metadata'}));}
 finally{if(lease)await api({action:'release',birdId:target.birdId,year:target.year,lease}).catch(()=>{});}
}
console.log(JSON.stringify({raceTargets:queue.targets.length,status:failed?'failed':'succeeded'}));if(failed)process.exitCode=1;
