import {readArchive} from '../lib/history-transfer.mjs';
import {retryHistory} from '../lib/history-retry.mjs';
import {retryStatisticsBird} from '../lib/statistics-retry.mjs';
import {migrationMonths,MIGRATION_STATS_VERSION} from '../lib/migration-stats.mjs';
import {germanyPosition,germanyInteriorMargin,BOUNDARY_VERSION} from '../lib/geo';
const origin=process.env.APP_ORIGIN||'https://storkleague.fans',secret=process.env.SYNC_SECRET;
if(!secret)throw Error('Missing sync credential');
async function api(body:any){const r=await fetch(origin+'/api/history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error('Statistics API HTTP '+r.status);return r.json() as Promise<any>;}
const started=Date.now(),deadline=started+22*60000;
const queue=await retryHistory(()=>api({action:'queue'}),{deadline,onRetry:r=>console.log(JSON.stringify({status:'statistics-queue-retry',...r}))});let failed=false;
for(const bird of queue.birds.filter((b:any)=>!process.env.MIGRATION_BIRD_ID||b.id===process.env.MIGRATION_BIRD_ID)){
 if(Date.now()-started>22*60000){console.log('Remaining statistics will resume next run');break;}
 try{
  await retryStatisticsBird(api,bird.id,async(context:any,lease:string)=>{
  const outdated=context.months.filter((m:string)=>(context.summaries[m].migration?.version!==MIGRATION_STATS_VERSION||context.summaries[m].migration?.boundaryVersion!==BOUNDARY_VERSION));
  const years=[...new Set(outdated.map((m:string)=>m.slice(0,4)))];let analyzed=0;
  for(const year of years){
   const targets=context.months.filter((m:string)=>m.startsWith(year+'-'));
   const needed=context.months.filter((m:string)=>m===String(Number(year)-1)+'-12'||m.startsWith(year+'-')||m===String(Number(year)+1)+'-01');
   const byMonth:any={};let index=0;
   const reads=await Promise.allSettled(Array.from({length:Math.min(3,needed.length)},async()=>{while(index<needed.length){const month=needed[index++];byMonth[month]=await readArchive(api,bird.id,lease,month);}}));
   const failure=reads.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
   const monthRows=Object.fromEntries(targets.map((m:string)=>[m,byMonth[m]]));
   const adjacent=needed.filter((m:string)=>!targets.includes(m)).flatMap((m:string)=>byMonth[m]);
   const summaries=migrationMonths(monthRows,germanyPosition,BOUNDARY_VERSION,adjacent,germanyInteriorMargin);
   for(const month of targets){await api({action:'migrationSummary',birdId:bird.id,lease,month,expectedSummary:JSON.stringify(context.summaries[month]),migration:summaries[month]});analyzed++;}
  }
  await api({action:'rankings',birdId:bird.id,lease});
  console.log(JSON.stringify({birdId:bird.id,analyzedMonths:analyzed,status:'statistics-complete',rankingPublished:true}));
  },{deadline,onRetry:r=>console.log(JSON.stringify({birdId:bird.id,status:'statistics-retry',...r}))});
 }catch(e:any){failed=true;console.error(JSON.stringify({birdId:bird.id,status:'statistics-deferred',reason:String(e.message).replaceAll(secret,'[redacted]')}));}
}
if(failed)process.exitCode=1;
