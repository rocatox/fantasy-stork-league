import {readArchive} from '../lib/history-transfer.mjs';
import {migrationMonths,MIGRATION_STATS_VERSION} from '../lib/migration-stats.mjs';
import {germanyPosition,germanyInteriorMargin,BOUNDARY_VERSION} from '../lib/geo';
const origin=process.env.APP_ORIGIN||'https://storkleague.fans',secret=process.env.SYNC_SECRET;
if(!secret)throw Error('Missing sync credential');
async function api(body:any){const r=await fetch(origin+'/api/history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error('Statistics API HTTP '+r.status);return r.json() as Promise<any>;}
const queue=await api({action:'queue'}),started=Date.now();let failed=false;
for(const bird of queue.birds){
 if(Date.now()-started>22*60000){console.log('Remaining statistics will resume next run');break;}
 let lease:string|undefined;
 try{
  const context=await api({action:'claim',birdId:bird.id});lease=context.lease;
  const outdated=context.months.filter((m:string)=>Number(m.slice(5,7))<=6&&(context.summaries[m].migration?.version!==MIGRATION_STATS_VERSION||context.summaries[m].migration?.boundaryVersion!==BOUNDARY_VERSION));
  const years=[...new Set(outdated.map((m:string)=>m.slice(0,4)))];let analyzed=0;
  for(const year of years){
   const targets=context.months.filter((m:string)=>m.startsWith(year+'-')&&m.slice(5,7)<='06');
   const needed=context.months.filter((m:string)=>m===String(Number(year)-1)+'-12'||m.startsWith(year+'-')&&m.slice(5,7)<='07');
   const byMonth:any={};let index=0;
   await Promise.all(Array.from({length:Math.min(3,needed.length)},async()=>{while(index<needed.length){const month=needed[index++];byMonth[month]=await readArchive(api,bird.id,lease,month);}}));
   const monthRows=Object.fromEntries(targets.map((m:string)=>[m,byMonth[m]]));
   const adjacent=needed.filter((m:string)=>!targets.includes(m)).flatMap((m:string)=>byMonth[m]);
   const summaries=migrationMonths(monthRows,germanyPosition,BOUNDARY_VERSION,adjacent,germanyInteriorMargin);
   for(const month of targets){await api({action:'migrationSummary',birdId:bird.id,lease,month,expectedSummary:JSON.stringify(context.summaries[month]),migration:summaries[month]});analyzed++;}
  }
  console.log(JSON.stringify({birdId:bird.id,analyzedMonths:analyzed,status:'statistics-complete'}));
 }catch(e:any){failed=true;console.error(JSON.stringify({birdId:bird.id,status:'statistics-deferred',reason:String(e.message).replaceAll(secret,'[redacted]')}));}
 finally{if(lease)await api({action:'release',birdId:bird.id,lease}).catch(()=>{});}
}
if(failed)process.exitCode=1;
