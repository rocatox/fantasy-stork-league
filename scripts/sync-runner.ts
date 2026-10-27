import {buildStudy} from './build-study';
import {syncPolicy} from '../lib/sync-policy.mjs';
const origin=process.env.APP_ORIGIN||'https://fantasy-stork-league.rocatox.workers.dev';
const secret=process.env.SYNC_SECRET,token=process.env.MOVEBANK_API_TOKEN;
if(!secret||!token)throw Error('Required sync credentials are missing');
if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('Invalid app origin');
const ids=['10449318','212096177','173641633','864730855','4809963363','21231406','24442409','76367850'];
async function api(body:any){const r=await fetch(origin+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error(`Snapshot API returned HTTP ${r.status}`);return r.json() as Promise<any>;}
let failed=false;
for(const studyId of ids){let done=false;for(let attempt=0;attempt<2&&!done;attempt++){let lease;try{
 const context=await api({action:'context',studyId});lease=context.lease;
 if(context.state?.lastSuccessSlot===syncPolicy().slot&&process.env.FORCE_RECONCILE!=='true'){console.log(JSON.stringify({studyId,status:'skipped'}));done=true;continue;}
 const snapshot=await buildStudy({...context,token,force:process.env.FORCE_RECONCILE==='true'});
 const result=await api({...snapshot,action:'commit',lease});lease=null;
 console.log(JSON.stringify({...result,discovered:snapshot.report.discovered,eventRows:snapshot.report.eventRows}));done=true;
 }catch{console.error(JSON.stringify({studyId,attempt:attempt+1,error:'Sync failed; previous committed snapshot retained'}));if(attempt===0)await new Promise(r=>setTimeout(r,30000));}
 finally{if(lease)await api({action:'release',studyId,lease}).catch(()=>{});}}
 if(!done)failed=true;
}
const readback=await fetch(origin+'/api/birds').then(r=>r.json()) as any;
console.log(JSON.stringify({verifiedSources:readback.sources?.length,birds:readback.birds?.length}));
if(failed)process.exitCode=1;
