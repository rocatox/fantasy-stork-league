import {anonymizeLeague,anonymizeSnapshot,anonymizeNotifications} from './account-deletion-policy.mjs';
import {deletionEnabled} from './account-deletion-state';

const stages=['leagues','race_notification_cycle_leagues','notification_outbox','notification_accounts','notification_email_queue','notification_email_batches'];
const ownStatements=(db:any,id:string)=>[
 db.prepare('DELETE FROM account_registry WHERE user_id=?').bind(id),
 db.prepare('DELETE FROM scout_list_birds WHERE list_id IN (SELECT id FROM scout_lists WHERE user_id=?)').bind(id),
 ...['scout_lists','notification_email_queue','notification_email_batches','notification_accounts'].map(t=>db.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(id)),
 db.prepare('DELETE FROM bug_report_email WHERE report_id IN (SELECT id FROM bug_reports WHERE user_id=?)').bind(id),
 db.prepare('DELETE FROM bug_reports WHERE user_id=?').bind(id),
 db.prepare('DELETE FROM sync_state WHERE id=?').bind('league-join-rate:'+id)
];
async function lock(db:any,table:string,token:string,now:number){
 return !!(await db.prepare(`INSERT INTO ${table}(id,token,expires_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at<?`).bind(token,now+120000,now).run()).meta.changes;
}
async function release(db:any,table:string,token:string){await db.prepare(`DELETE FROM ${table} WHERE id=1 AND token=?`).bind(token).run();}
// A request is accepted only after any in-flight sender/delivery has finished.
// Provider-accepted emails cannot be recalled; no new app mail starts afterward.
export async function beginDeletion(config:any,userId:string,now=Date.now(),restore?:{alias:string,requestedAt:number}){
 const db=config.DB,existing=await db.prepare('SELECT status,alias FROM account_deletions WHERE user_id=?').bind(userId).first();
 if(existing&&(!restore||existing.status!=='complete'))return {status:existing.status,accepted:true};
 if(restore&&existing&&existing.alias!==restore.alias)throw Error('Deletion receipt identity mismatch');
 const token=crypto.randomUUID(),held:string[]=[];
 try{
  for(const table of ['account_deletion_lock','notification_email_lock','notification_delivery_lock']){
   if(!await lock(db,table,token,now))return {status:'busy',accepted:false};held.push(table);
  }
  if(await db.prepare("SELECT 1 FROM account_deletions WHERE status='cleanup' LIMIT 1").first())return {status:'busy',accepted:false};
  await db.batch([
   db.prepare("INSERT INTO account_deletions(user_id,alias,requested_at,payload) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status='cleanup',stage=0,cursor=0,payload=excluded.payload,retry_at=0,attempts=0,last_error=NULL,completed_at=NULL").bind(userId,restore?.alias||'deleted_'+crypto.randomUUID(),restore?.requestedAt??now,JSON.stringify({leagues:[]})),
   ...ownStatements(db,userId)
  ]);
  return {status:'cleanup',accepted:true};
 }finally{for(const table of held.reverse())await release(db,table,token);}
}
function capture(meta:any,value:any,job:any){
 const l=value.league||value;
 if(l.members?.some((m:any)=>m.id===job.user_id)){
  if(!meta.leagues.includes(l.id))meta.leagues.push(l.id);
 }
}
export async function processDeletion(config:any,{now=Date.now(),deleteIdentity=async(id:string)=>{
 const r=await fetch('https://api.clerk.com/v1/users/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:`Bearer ${config.CLERK_SECRET_KEY}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!r.ok&&r.status!==404)throw Error('Identity deletion must retry');
 }}={}){
 if(!deletionEnabled(config))return {status:'disabled'};
 const db=config.DB,token=crypto.randomUUID();if(!await lock(db,'account_deletion_lock',token,now))return {status:'busy'};
 let job:any;
 try{
  job=await db.prepare("SELECT * FROM account_deletions WHERE status!='complete' AND retry_at<=? ORDER BY requested_at LIMIT 1").bind(now).first();
  if(!job)return {status:'empty'};
  if(job.status==='clerk'){
   await deleteIdentity(job.user_id);
   await db.prepare("UPDATE account_deletions SET status='complete',payload='{}',completed_at=?,last_error=NULL,retry_at=0 WHERE user_id=?").bind(now,job.user_id).run();
   return {status:'complete'};
  }
  const meta=JSON.parse(job.payload);
  const table=stages[job.stage];
  if(!table){
   await db.batch([...ownStatements(db,job.user_id),db.prepare("UPDATE account_deletions SET status='clerk',payload='{}',retry_at=0,last_error=NULL WHERE user_id=?").bind(job.user_id)]);
   return {status:'identity-pending'};
  }
  // One bounded row per invocation. Pumping separate requests keeps each Worker
  // below Free query/CPU budgets even for an account with many old leagues.
  const column=table==='leagues'?'state':'payload';
  const shared=['notification_accounts','notification_email_queue','notification_email_batches'].includes(table);
  const extra=table==='notification_email_queue'?' OR instr(event_id,?)>0':'';
  const relevance=`instr(${column},?)>0${extra}`+(shared?` OR EXISTS(SELECT 1 FROM json_each(?) AS token WHERE instr(${column},token.value)>0)`:'');
  const parameters:any[]=[job.cursor,job.user_id,...(extra?[job.user_id]:[]),...(shared?[JSON.stringify(meta.leagues)]:[])];
  const row=await db.prepare(`SELECT rowid AS _row,* FROM ${table} WHERE rowid>? AND (${relevance}) ORDER BY rowid LIMIT 1`).bind(...parameters).first();
  if(!row){await db.prepare('UPDATE account_deletions SET stage=stage+1,cursor=0,retry_at=0,last_error=NULL WHERE user_id=?').bind(job.user_id).run();return {status:'progress'};}
  let statements:any[]=[];
  if(table==='leagues'){
   const value=JSON.parse(row.state);capture(meta,value,job);const next=anonymizeLeague(value,job),serialized=JSON.stringify(next);
   if(serialized!==row.state)statements.push(db.prepare('UPDATE leagues SET state=?,invite=?,revision=revision+1 WHERE id=? AND revision=?').bind(serialized,next.invite||row.invite,row.id,row.revision));
  }else if(table==='notification_outbox'||table==='race_notification_cycle_leagues'){
   const value=JSON.parse(row.payload);capture(meta,value,job);const serialized=JSON.stringify(anonymizeSnapshot(value,job));
   if(serialized!==row.payload)statements.push(db.prepare(`UPDATE ${table} SET payload=? WHERE rowid=?`).bind(serialized,row._row));
  }else if(table==='notification_accounts'){
   const value=JSON.parse(row.payload),next=anonymizeNotifications(value,job);
   // Older notification text has no structured actor field. Avoid retaining an
   // obsolete username that is no longer present in the league/Clerk snapshots.
   for(const e of next.events)if(meta.leagues.includes(e.leagueId)&&e.createdAt<=job.requested_at){e.body='Earlier league update. View the league for current details.';e.emailSuppressed=true;}
   const serialized=JSON.stringify(next);
   if(serialized!==row.payload)statements.push(db.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(serialized,row.user_id,row.revision));
  }else{
   const value=JSON.parse(row.payload||'{}');
   const affected=row.event_id?.includes(job.user_id)||meta.leagues.includes(value.leagueId)||meta.leagues.some((id:string)=>row.payload.includes(id))||row.payload.includes(job.user_id);
   if(affected){
    // Never rewrite a provider retry with an existing idempotency key. Clear and
    // cancel the old envelope; the in-app event remains with privacy-safe text.
    if(table==='notification_email_queue'){
     const eventId=row.event_id.split(job.user_id).join(job.alias);
     const duplicate=eventId!==row.event_id&&await db.prepare('SELECT 1 FROM notification_email_queue WHERE user_id=? AND event_id=?').bind(row.user_id,eventId).first();
     statements.push(duplicate?db.prepare('DELETE FROM notification_email_queue WHERE rowid=?').bind(row._row):db.prepare("UPDATE notification_email_queue SET event_id=?,payload='{}',status=CASE WHEN status='pending' THEN 'privacy-cancelled' ELSE status END WHERE rowid=?").bind(eventId,row._row));
    }else statements.push(db.prepare(`UPDATE ${table} SET payload='{}',status=CASE WHEN status='pending' THEN 'privacy-cancelled' ELSE status END WHERE rowid=?`).bind(row._row));
   }
  }
  // Persist discovered league references before redacting their last source, so
  // a crash between the data write and cursor checkpoint is safe to replay.
  if(JSON.stringify(meta)!==job.payload)await db.prepare('UPDATE account_deletions SET payload=? WHERE user_id=?').bind(JSON.stringify(meta),job.user_id).run();
  // Hold the row cursor if a concurrent league/inbox update won the revision.
  if(statements.length){const result=await db.batch(statements);if(!result[0].meta.changes)return {status:'retry-row'};}
  await db.prepare('UPDATE account_deletions SET cursor=?,payload=?,retry_at=0,last_error=NULL WHERE user_id=?').bind(row._row,JSON.stringify(meta),job.user_id).run();
  return {status:'progress'};
 }catch{
  if(job)await db.prepare('UPDATE account_deletions SET attempts=attempts+1,retry_at=?,last_error=? WHERE user_id=?').bind(now+Math.min(3600000,60000*2**Math.min(job.attempts,6)),job.status==='clerk'?'identity-retry':'cleanup-retry',job.user_id).run();
  return {status:'retry-needed'};
 }finally{await release(db,'account_deletion_lock',token);}
}
export async function pumpDeletions(config:any){
 if(!deletionEnabled(config))return {status:'disabled'};
 if(!await config.DB.prepare("SELECT 1 FROM account_deletions WHERE status!='complete' AND retry_at<=? LIMIT 1").bind(Date.now()).first()){
  const check=await config.DB.prepare("SELECT payload FROM sync_state WHERE id='account-deletion-discovery'").first();
  if(check&&JSON.parse(check.payload).checkedAt>Date.now()-900000)return {status:'empty'};
  const r=await fetch(config.APP_ORIGIN+'/api/account-deletion-jobs?discover=1',{method:'POST',headers:{Authorization:`Bearer ${config.SYNC_SECRET}`},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Identity reconciliation deferred');return r.json();
 }
 for(let i=0;i<20;i++){
  const r=await fetch(config.APP_ORIGIN+'/api/account-deletion-jobs',{method:'POST',headers:{Authorization:`Bearer ${config.SYNC_SECRET}`},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Account cleanup deferred');const result:any=await r.json();
  if(['empty','busy','retry-needed'].includes(result.status))return result;
 }
 return {status:'progress'};
}

// Only a successful, complete filtered Clerk response proves an identity absent.
// Network/provider failures never cause deletion.
export async function discoverDeletedAccounts(config:any,{now=Date.now(),lookup=async(ids:string[])=>(await import('./clerk-client')).clerkClient().users.getUserList({userId:ids,limit:100})}={}){
 if(!deletionEnabled(config))return {status:'disabled'};
 const db=config.DB;
 const lease=await db.prepare("INSERT INTO sync_state(id,payload) VALUES('account-deletion-discovery',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE COALESCE(json_extract(sync_state.payload,'$.checkedAt'),0)<=?").bind(JSON.stringify({checkedAt:now,status:'checking'}),now-900000).run();
 if(!lease.meta.changes)return {status:'current'};
 try{
  const rows=await db.prepare('SELECT user_id FROM account_registry WHERE checked_at<=? ORDER BY checked_at,user_id LIMIT 20').bind(now-86400000).all();
  const ids:string[]=rows.results.map((r:any)=>r.user_id);
  if(!ids.length)return {status:'empty'};
  const result=await lookup(ids);
  if(!Array.isArray(result.data)||result.totalCount!==result.data.length||result.data.length>ids.length||new Set(result.data.map((u:any)=>u.id)).size!==result.data.length||result.data.some((u:any)=>!ids.includes(u.id)))throw Error('Incomplete identity response');
  const alive=new Set(result.data.map((u:any)=>u.id));if(!alive.size)throw Error('No live identity anchor; fail closed');let queued=0;
  if(alive.size)await db.prepare(`UPDATE account_registry SET checked_at=? WHERE user_id IN (${[...alive].map(()=>'?').join(',')})`).bind(now,...alive).run();
  for(const id of ids)if(!alive.has(id)){
   const result=await beginDeletion(config,id,now);if(result.accepted)queued++;else break;
  }
  await db.prepare("UPDATE sync_state SET payload=? WHERE id='account-deletion-discovery'").bind(JSON.stringify({checkedAt:now,status:'checked',checked:ids.length,queued})).run();
  return {status:'checked',queued};
 }catch{
  await db.prepare("UPDATE sync_state SET payload=? WHERE id='account-deletion-discovery'").bind(JSON.stringify({checkedAt:now,status:'retry-needed'})).run();
  return {status:'retry-needed'};
 }
}

// Operator-only recovery primitive: call against an isolated restored database,
// one verified private receipt at a time, and finish cleanup before serving users.
// There is deliberately no public HTTP route accepting these records.
export async function reapplyDeletionReceipt(config:any,receipt:any){
 if(typeof receipt?.user_id!=='string'||!receipt.user_id||receipt.user_id.length>200||typeof receipt.alias!=='string'||!/^deleted_[0-9a-f-]{36}$/.test(receipt.alias)||!Number.isSafeInteger(receipt.requested_at)||receipt.requested_at<0||receipt.requested_at>Date.now()+300000)throw Error('Invalid deletion receipt');
 return beginDeletion(config,receipt.user_id,Date.now(),{alias:receipt.alias,requestedAt:receipt.requested_at});
}
