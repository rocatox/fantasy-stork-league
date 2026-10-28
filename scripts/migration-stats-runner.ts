import {readArchive} from '../lib/history-transfer.mjs';
import {migrationMonth,MIGRATION_STATS_VERSION} from '../lib/migration-stats.mjs';
import {germanyPosition,BOUNDARY_VERSION} from '../lib/geo';
const origin=process.env.APP_ORIGIN||'https://storkleague.fans',secret=process.env.SYNC_SECRET;
if(!secret)throw Error('Missing sync credential');
async function api(body:any){const r=await fetch(origin+'/api/history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error('Statistics API HTTP '+r.status);return r.json() as Promise<any>;}
const queue=await api({action:'queue'}),started=Date.now();let failed=false;
for(const bird of queue.birds){
 if(Date.now()-started>22*60000){console.log('Remaining statistics will resume next run');break;}
 let lease:string|undefined;
 try{
  const context=await api({action:'claim',birdId:bird.id});lease=context.lease;
  const pending=context.months.filter((m:string)=>Number(m.slice(5,7))<=6&&(context.summaries[m].migration?.version!==MIGRATION_STATS_VERSION||context.summaries[m].migration?.boundaryVersion!==BOUNDARY_VERSION));
  let index=0;
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,pending.length)},async()=>{while(index<pending.length){const month=pending[index++],rows=await readArchive(api,bird.id,lease,month);const migration=migrationMonth(rows,germanyPosition,BOUNDARY_VERSION);await api({action:'migrationSummary',birdId:bird.id,lease,month,expectedSummary:JSON.stringify(context.summaries[month]),migration});}}));
  if(outcomes.some(r=>r.status==='rejected'))throw Error('Some historical months could not be analyzed; will retry');
  console.log(JSON.stringify({birdId:bird.id,analyzedMonths:pending.length,status:'statistics-complete'}));
 }catch(e:any){failed=true;console.error(JSON.stringify({birdId:bird.id,status:'statistics-deferred',reason:String(e.message).replaceAll(secret,'[redacted]')}));}
 finally{if(lease)await api({action:'release',birdId:bird.id,lease}).catch(()=>{});}
}
if(failed)process.exitCode=1;
