import {readFile,writeFile} from 'node:fs/promises';
import {readArchive,writeArchive} from '../lib/history-transfer.mjs';
import {retainHistory,RETENTION_VERSION} from '../lib/history-retention.mjs';
import {summarizeRecords} from '../lib/history.mjs';
const origin='https://storkleague.fans',secret=process.env.SYNC_SECRET;
if(!secret)throw Error('Missing credential');
const recovery=JSON.parse(await readFile('../history-recovery-2026-10-27/verification.json','utf8'));
if(recovery.length!==2||recovery.some(r=>r.integrity!=='ok'))throw Error('Verified recovery exports are required');
async function api(body){const r=await fetch(origin+'/api/history',{method:'POST',headers:{'Content-Type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error(`Archive API ${r.status} for ${body.action}`);return r.json();}
const {birds}=await api({action:'queue'}),retention=await api({action:'retention'});const report=[];
for(const bird of birds){
 const context=await api({action:'claim',birdId:bird.id});let before=0,after=0,bytes=0,months=0;
 try{
  const pending=context.months.filter(m=>context.summaries[m].retentionVersion!==RETENTION_VERSION);
  let index=0;
  // Four independent months at a time; one exclusive lease for this bird.
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,pending.length)},async()=>{while(index<pending.length){const month=pending[index++],rows=await readArchive(api,bird.id,context.lease,month);const kept=retainHistory(rows,{now:retention.now,...retention.protections[bird.id]});const summary={...summarizeRecords(kept.rows),retentionVersion:RETENTION_VERSION,resolution:kept.resolution,compactAfter:kept.compactAfter,sampled:kept.rows.length<rows.length};bytes+=await writeArchive(api,bird.id,context.lease,month,kept.rows,summary);before+=rows.length;after+=kept.rows.length;months++;}}));
  const failed=outcomes.find(r=>r.status==="rejected");if(failed)throw failed.reason;
 }finally{await api({action:'release',birdId:bird.id,lease:context.lease});}
 report.push({birdId:bird.id,months,before,after,binaryBytes:bytes});await writeFile('../history-retention-migration.json',JSON.stringify({checkedAt:new Date().toISOString(),birds:report},null,2));console.log(JSON.stringify(report.at(-1)));
}
