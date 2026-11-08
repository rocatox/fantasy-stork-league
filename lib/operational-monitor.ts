import {operationalChecks,alertTransition,HOUR} from './operational-policy.mjs';
const ROOT='https://api.github.com/repos/rocatox/fantasy-stork-league/actions';
export async function backupStatus(config:any,fetcher=fetch){
 const request=async(path:string)=>{const r=await fetcher(ROOT+path,{headers:{Authorization:`Bearer ${config.GITHUB_SYNC_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'FSL-Operations','X-GitHub-Api-Version':'2022-11-28'},redirect:'manual',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Backup status unavailable');return r.json() as Promise<any>;};
 if(!config.GITHUB_SYNC_TOKEN)throw Error('Backup status not configured');
 const data=await request('/workflows/backup.yml/runs?branch=main&status=success&per_page=5');
 if(!Array.isArray(data.workflow_runs))throw Error('Invalid backup status');
 for(const run of data.workflow_runs){
  if(run.conclusion!=='success'||run.status!=='completed')continue;
  const jobs=await request(`/runs/${run.id}/jobs?per_page=100`);
  if(!Array.isArray(jobs.jobs))throw Error('Invalid backup jobs');
  const capture=jobs.jobs.flatMap((j:any)=>j.conclusion==='success'?j.steps||[]:[]).find((s:any)=>s.name==='Capture, restore-check, encrypt and upload privately'&&s.conclusion==='success');
  if(capture&&Number.isFinite(Date.parse(capture.completed_at)))return {completedAt:capture.completed_at,runId:run.id};
 }
 return {completedAt:null};
}
export async function collectOperations(config:any,now:number,fetcher=fetch){
 const db=config.DB,sample:any={now,databases:{}};
 try{sample.backup=await backupStatus(config,fetcher);}catch{sample.backup={error:true};}
 try{const rows=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'study:%'").all();sample.sources={values:rows.results.map((r:any)=>({studyId:r.id.slice(6),...JSON.parse(r.payload)}))};}catch{sample.sources={error:true};}
 const stores:[string,any][]=[['main',db],['history',config.HISTORY_ARCHIVE]];
 for(let n=2;n<=Number(config.HISTORY_SHARD_COUNT||1);n++)stores.push(['history'+n,config['HISTORY_ARCHIVE_'+n]]);
 for(const [key,store] of stores){try{const result=await store.prepare('SELECT 1').run();sample.databases[key]=Number(result.meta?.size_after)||null;}catch{sample.databases[key]=null;}}
 try{
  const q=await db.prepare("SELECT count(*) pending,min(created_at) oldest FROM (SELECT created_at FROM notification_email_queue WHERE status='pending' UNION ALL SELECT r.created_at FROM bug_report_email e JOIN bug_reports r ON r.id=e.report_id WHERE e.status='pending')").first();
  const f=await db.prepare("SELECT count(*) failed FROM (SELECT id FROM notification_email_batches WHERE created_at>=? AND status IN ('uncertain-expired','retry-exhausted','provider-configuration-error','provider-rejected','expired') UNION ALL SELECT e.report_id FROM bug_report_email e JOIN bug_reports r ON r.id=e.report_id WHERE r.created_at>=? AND e.status IN ('uncertain-expired','retry-exhausted','provider-configuration-error','provider-rejected'))").bind(now-24*HOUR,now-24*HOUR).first();
  sample.email={pending:Number(q.pending),oldest:q.oldest,failed:Number(f.failed)};
 }catch{sample.email={error:true};}
 return sample;
}
export async function runOperations(config:any,{now=Date.now(),fetcher=fetch,collect=collectOperations}={}){
 if(config.OPERATIONS_ENABLED!=='true')return {status:'disabled'};
 const db=config.DB,lease=crypto.randomUUID(),id='operational-monitor';
 const lock=await db.prepare("INSERT INTO sync_state(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=json_set(sync_state.payload,'$.lease',?,'$.leaseUntil',?) WHERE COALESCE(json_extract(sync_state.payload,'$.leaseUntil'),0)<? AND COALESCE(json_extract(sync_state.payload,'$.checkedAt'),0)<?").bind(id,JSON.stringify({lease,leaseUntil:now+120000}),lease,now+120000,now,now-10*60000).run();
 if(!lock.meta.changes)return {status:'locked-or-current'};
 try{
  const sample=await collect(config,now,fetcher),checks=operationalChecks(sample),notices:any[]=[],updates:any[]=[];
  for(const check of checks){const previous=await db.prepare('SELECT payload FROM operational_alert_state WHERE id=?').bind(check.id).first();const {state,notice}=alertTransition(previous?JSON.parse(previous.payload):null,check,now);if(notice)notices.push(notice);updates.push(db.prepare('INSERT INTO operational_alert_state(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind(check.id,JSON.stringify(state)));}
  if(notices.length)updates.push(db.prepare('INSERT INTO operational_email(id,created_at,payload) VALUES(?,?,?)').bind(crypto.randomUUID(),now,JSON.stringify(notices)));
  updates.push(db.prepare("UPDATE sync_state SET payload=? WHERE id=? AND json_extract(payload,'$.lease')=?").bind(JSON.stringify({checkedAt:now,status:'checked',checks,sample,leaseUntil:0}),id,lease));
  await db.batch(updates);
  // Keep bounded diagnostic history; unattempted stale mail must not arrive days later.
  await db.prepare("UPDATE operational_email SET status='expired',message=NULL WHERE status='pending' AND created_at<?").bind(now-2*24*HOUR).run();
  await db.prepare('DELETE FROM operational_email WHERE created_at<?').bind(now-30*24*HOUR).run();
  return {status:'checked',alerts:notices.length,checks};
 }finally{await db.prepare("UPDATE sync_state SET payload=json_set(payload,'$.leaseUntil',0) WHERE id=? AND json_extract(payload,'$.lease')=?").bind(id,lease).run();}
}
// Separate request gives monitoring its own free Worker CPU budget.
export async function pumpOperations(config:any){
 if(config.OPERATIONS_ENABLED!=='true')return;
 const r=await fetch(config.APP_ORIGIN+'/api/operations',{method:'POST',headers:{Authorization:`Bearer ${config.SYNC_SECRET}`},redirect:'manual',signal:AbortSignal.timeout(100000)});
 if(!r.ok)throw Error('Operational monitor failed');
}
