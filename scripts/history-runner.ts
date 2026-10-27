import {gzipSync,gunzipSync} from 'node:zlib';
import {readMovebank,readMovebankEvents} from '../lib/feed.mjs';
import {historyRecord,mergeRecords,summarizeRecords} from '../lib/history.mjs';
import {syncPolicy} from '../lib/sync-policy.mjs';
const origin=process.env.APP_ORIGIN||'https://storkleague.fans';
const token=process.env.MOVEBANK_API_TOKEN,secret=process.env.SYNC_SECRET;
if(!token||!secret||!origin.startsWith('https://'))throw Error('Missing history configuration');
const stamp=(n:number)=>new Date(n).toISOString().replace(/[-:TZ.]/g,'');
async function api(body:any){
 const response=await fetch(origin+'/api/history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`History storage HTTP ${response.status}`);
 return response.json() as Promise<any>;
}
const queue=await api({action:'queue'}),started=Date.now();let failed=false;
// Pending backfills first; the job can resume remaining birds on its next scheduled invocation.
const birds=queue.birds.filter((b:any)=>!process.env.HISTORY_BIRD_ID||b.id===process.env.HISTORY_BIRD_ID).sort((a:any,b:any)=>Number(!!a.archiveState?.complete)-Number(!!b.archiveState?.complete));
const checked=new Set();
for(const bird of birds){
 if(Date.now()-started>22*60000){console.log(JSON.stringify({status:'remaining-history-queued'}));break;}
 if(bird.archiveState?.slot===syncPolicy().slot&&process.env.HISTORY_VERIFY_INCREMENTAL!=='true')continue;
 console.log(JSON.stringify({birdId:bird.id,status:'history-started',mode:bird.archiveState?.complete?'incremental':'backfill'}));
 let lease:string|undefined;
 try{
  if(!checked.has(bird.studyId)){
   const study=queue.studies.find((s:any)=>s.studyId===bird.studyId);
   const info=await readMovebank(token,bird.studyId,'study');
   if(info.length!==1||info[0].i_have_download_access!=='true'||info[0].license_type!==(study.license==='CC BY-NC 4.0'?'CC_BY_NC':'CC_BY'))throw Error('History access or license changed');
   checked.add(bird.studyId);
  }
  const animal=queue.metadata[bird.studyId]?.individuals.find((a:any)=>a.local_identifier===bird.name);
  if(!animal?.id)throw Error('History individual identity missing');
  const context=await api({action:'claim',birdId:bird.id});lease=context.lease;
  const start=Date.now(),months=new Map<string,any[]>();
  const query:any={sensor_type:'gps',individual_id:animal.id,attributes:'event_id,individual_local_identifier,tag_local_identifier,timestamp,location_long,location_lat,visible,individual_taxon_canonical_name'};
  if(context.state?.complete)query.update_ts_start=stamp(Date.parse(context.state.cursor)-86400000);
  const count=await readMovebankEvents(token,bird.studyId,query,(event:any)=>{
   if(event.individual_local_identifier!==bird.name)throw Error('History individual filter mismatch');
   const row=historyRecord(event,start);if(!row)return;
   const month=row[0].slice(0,7);if(!months.has(month))months.set(month,[]);months.get(month)!.push(row);
  });
  if(!context.state?.complete&&!count)throw Error('Unexpected empty history backfill');
  let stored=0,batch:any[]=[],batchBytes=0;
  async function flush(){if(batch.length){await api({action:'chunks',birdId:bird.id,lease,chunks:batch});batch=[];batchBytes=0;}}
  for(const [month,incoming] of months){
   const previous=context.months&&!context.months.includes(month)?{data:null}:await api({action:'read',birdId:bird.id,lease,month});
   const rows=mergeRecords(previous.data?JSON.parse(gunzipSync(Buffer.from(previous.data,'base64')).toString()):[],incoming);
   let data=gzipSync(JSON.stringify(rows)).toString('base64');
   if(data.length>500000){
    const count=Math.ceil(data.length/500000);
    for(let part=0;part<count;part++)await api({action:'part',birdId:bird.id,lease,month,part,data:data.slice(part*500000,(part+1)*500000)});
    data=`parts:${lease}:${count}`;
   }
   const chunk={month,data,summary:summarizeRecords(rows)},bytes=JSON.stringify(chunk).length;
   if(batch.length&&(batch.length>=8||batchBytes+bytes>1000000))await flush();
   batch.push(chunk);batchBytes+=bytes;stored+=rows.length;
  }
  await flush();
  await api({action:'complete',birdId:bird.id,lease,startedAt:new Date(start).toISOString(),slot:syncPolicy(start).slot,individualId:animal.id});lease=undefined;
  console.log(JSON.stringify({birdId:bird.id,status:'history-succeeded',mode:context.state?.complete?'incremental':'backfill',fetched:count,months:months.size,recordsInTouchedMonths:stored}));
 }catch(error:any){
  if(String(error?.message)==='History storage HTTP 409'){
   console.log(JSON.stringify({birdId:bird.id,status:'history-deferred',reason:'Another writer is active; retry next run'}));break;
  }
  failed=true;
  // Deliberately omit request URLs and exception stacks, which may contain a token.
  const rateLimited=String(error?.message).includes('HTTP 429');
  console.error(JSON.stringify({birdId:bird.id,status:rateLimited?'rate-limited':'history-failed',reason:String(error?.message||'Unknown error').split(token).join('[redacted]').replace(/https?:\/\/\S+/g,'[URL redacted]').slice(0,180)}));
  if(rateLimited)break;
 }finally{if(lease)await api({action:'release',birdId:bird.id,lease}).catch(()=>{});}
 await new Promise(resolve=>setTimeout(resolve,3000));
}
if(failed)process.exitCode=1;
