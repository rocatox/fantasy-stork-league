import {deletionMaintenance} from './account-deletion-state';
import {deliverOperationalEmail} from './operational-email';
import {EMAIL_URGENT_SQL} from './email-priority.mjs';
import {nextEmailRetry,recordEmailCooldown} from './email-retry.mjs';
import {deliverBugReportEmail} from './bug-report-email';
import {emailBudgetAvailable,emailBudgetCharges} from './email-budget';
export {EMAIL_DAILY_CAP,EMAIL_MONTHLY_CAP} from './email-budget';
import {sendEmail, emailProvider, retryWindow} from './email-provider';
import {env} from 'cloudflare:workers';
import {database,json} from './store';
import {addStandings} from './standings';
import {emailNotificationEnabled,notificationPreferences,reconcileNotifications,NOTIFICATION_CATEGORIES} from './notifications.mjs';
const HOUR=3600000,DAY=24*HOUR;
import {emailConfigured} from './email-config';
export {emailConfigured} from './email-config';
const esc=(s:any)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function emailMessage(origin:string,to:string,from:string,token:string,events:any[]){
 const settings=origin+'/?view=settings',unsubscribe=origin+'/api/email-unsubscribe?token='+encodeURIComponent(token);
 return {from:`Fantasy Stork League <${from}>`,to:[to],subject:('Fantasy Stork League — '+events[0].title).replace(/[\r\n]/g,' ').slice(0,180),text:events.map(e=>`${e.leagueName}: ${e.title} — ${e.body}`).join('\n\n')+`\n\nView your leagues: ${origin}/?view=leagues\nNotification settings: ${settings}\nStop email notifications: ${unsubscribe}`,html:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div style="max-width:600px;margin:auto;padding:16px;font-family:Arial,sans-serif;color:#202b4d;line-height:1.6"><h1 style="font-size:24px;border-bottom:3px solid #c29a34;padding-bottom:12px">Fantasy Stork League</h1>${events.map(e=>`<p>${esc(e.leagueName)}</p><h2 style="font-size:20px">${esc(e.title)}</h2><p>${esc(e.body)}</p>`).join('')}<p><a href="${origin}/?view=leagues">View your leagues</a></p><p><a href="${settings}">Notification settings</a> · <a href="${unsubscribe}">Stop email notifications</a></p></div></body></html>`,headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};

}
async function recipient(userId:string,config:any){
 const r=await fetch('https://api.clerk.com/v1/users/'+encodeURIComponent(userId),{headers:{Authorization:`Bearer ${config.CLERK_SECRET_KEY}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(r.status===404)return null;if(!r.ok)throw Error('Verified recipient lookup unavailable');
 const u:any=await r.json(),address=u.email_addresses?.find((a:any)=>a.id===u.primary_email_address_id&&a.verification?.status==='verified');
 return typeof address?.email_address==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email_address)?address.email_address:null;
}
export async function deliverEmail(now=Date.now()){
 const config:any=env,db=database();if(!emailConfigured(config))return {status:'not-configured'};
 const token=crypto.randomUUID();const lock=await db.prepare('INSERT INTO notification_email_lock(id,token,expires_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at<?').bind(token,now+180000,now).run();if(!lock.meta.changes)return {status:'busy'};
 const finish=async(status:string)=>{await db.prepare("INSERT INTO sync_state(id,payload) VALUES('email-processor',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify({lastCheckedAt:new Date(now).toISOString(),status})).run();return {status};};
 try{
  const cooldown=await db.prepare("SELECT payload FROM sync_state WHERE id='email-provider-cooldown'").first();
  if(cooldown&&Number(JSON.parse(cooldown.payload).until)>now)return await finish('cooldown');
  const operational=await deliverOperationalEmail(db,config,now);if(operational.status!=='empty')return await finish(operational.status);
  if(await deletionMaintenance(config))return await finish('account-cleanup');
  // Retain deduplication tombstones as long as their account events can still exist.
  await db.prepare('DELETE FROM notification_email_queue WHERE created_at<?').bind(now-91*DAY).run();
  await db.prepare('DELETE FROM notification_email_batches WHERE created_at<?').bind(now-91*DAY).run();
  await db.prepare("UPDATE notification_email_queue SET status='expired' WHERE status='pending' AND created_at<?").bind(now-2*DAY).run();
  let batch:any=await db.prepare("SELECT * FROM notification_email_batches WHERE status='pending' AND retry_at<=? ORDER BY created_at LIMIT 1").bind(now).first();
  let rows:any[]=[],userId:string;
  if(batch)userId=batch.user_id;
  else{const first=await db.prepare(`SELECT user_id FROM notification_email_queue WHERE status='pending' AND batch_id IS NULL AND queued_at<=? ORDER BY ${EMAIL_URGENT_SQL} DESC,queued_at LIMIT 1`).bind(now).first();
   if(!first){const report=await deliverBugReportEmail(db,config,now);if(report.status!=='empty')return await finish(report.status);return await finish('empty');}
   userId=first.user_id;rows=(await db.prepare(`SELECT * FROM notification_email_queue WHERE status='pending' AND batch_id IS NULL AND user_id=? ORDER BY ${EMAIL_URGENT_SQL} DESC,created_at LIMIT 1`).bind(userId).all()).results;}
  const record=await db.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').bind(userId).first(),account=record?JSON.parse(record.payload):null;
  const leagueRows=await db.prepare("SELECT state FROM leagues WHERE EXISTS(SELECT 1 FROM json_each(state,'$.members') WHERE json_extract(value,'$.id')=?)").bind(userId).all();
  const leagues=await addStandings(leagueRows.results.map((r:any)=>JSON.parse(r.state)));
  const current=account?reconcileNotifications(account,leagues,userId,now):null,existing=new Map((account?.events||[]).map((e:any)=>[e.id,e])),active=new Map((current?.events||[]).map((e:any)=>[e.id,e.active]));
  const allowed=(e:any)=>{const stored:any=existing.get(e.id);return !!account?.emailUnsubscribeToken&&stored?.emailSuppressed===false&&e.createdAt>=now-2*DAY&&(e.category==='emailTest'||emailNotificationEnabled(account.preferences,e,account.emailEnabledSince))&&(e.category==='emailTest'||leagues.some((l:any)=>l.id===e.leagueId&&!['disbanded','abandoned'].includes(l.status)))&&(!e.actionable||active.get(e.id));};
  const closeBatch=async(status:string)=>{await db.batch([db.prepare('UPDATE notification_email_batches SET status=?,payload=? WHERE id=?').bind(status,'{}',batch.id),db.prepare('UPDATE notification_email_queue SET status=? WHERE batch_id=?').bind(status,batch.id)]);return await finish(status);};
  if(batch){const payload=JSON.parse(batch.payload);if(payload.provider!=='brevo')return await closeBatch('retired-provider');if(!payload.events.every(allowed)||!account?.emailUnsubscribeToken)return await closeBatch('cancelled');if(batch.first_attempt_at&&now-batch.first_attempt_at>=retryWindow())return await closeBatch('uncertain-expired');}
  else{
   const rejected=rows.filter(r=>!allowed(JSON.parse(r.payload))).map(r=>r.event_id);
   if(rejected.length)await db.prepare("UPDATE notification_email_queue SET status='cancelled' WHERE user_id=? AND event_id IN (SELECT value FROM json_each(?))").bind(userId,JSON.stringify(rejected)).run();
   rows=rows.filter(r=>!rejected.includes(r.event_id));if(!rows.length||!account?.emailUnsubscribeToken)return await finish('skipped');
  }
  const to=await recipient(userId,config);
  if(!to){if(batch)return await closeBatch('no-verified-email');await db.prepare("UPDATE notification_email_queue SET status='no-verified-email' WHERE user_id=? AND batch_id IS NULL AND status='pending'").bind(userId).run();return await finish('no-verified-email');}
  if(batch&&JSON.parse(batch.payload).message.to[0]!==to)return await closeBatch('recipient-changed');
  if(!batch){const id=crypto.randomUUID(),events=rows.map(r=>JSON.parse(r.payload)),payload=JSON.stringify({provider:emailProvider(config),events,message:emailMessage(config.APP_ORIGIN,to,config.EMAIL_FROM,account.emailUnsubscribeToken,events)});
   await db.batch([db.prepare('INSERT INTO notification_email_batches(id,user_id,payload,created_at) VALUES(?,?,?,?)').bind(id,userId,payload,now),db.prepare('UPDATE notification_email_queue SET batch_id=? WHERE user_id=? AND event_id IN (SELECT value FROM json_each(?)) AND batch_id IS NULL').bind(id,userId,JSON.stringify(rows.map(r=>r.event_id)))]);batch={id,user_id:userId,payload,created_at:now,attempts:0,first_attempt_at:null};
  }
  const provider=JSON.parse(batch.payload).provider;
  if(!await emailBudgetAvailable(db,now,provider))return await finish('free-limit');
  if(batch.attempts>=6)return await closeBatch('retry-exhausted');
  // Charge attempts before the external request, including ambiguous failures; never overspend.
  await db.batch([...emailBudgetCharges(db,now),db.prepare('UPDATE notification_email_batches SET first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1,retry_at=? WHERE id=?').bind(now,nextEmailRetry(now,batch.attempts+1),batch.id)]);
  const {data,error,headers}=await sendEmail(config,provider,JSON.parse(batch.payload).message,'stork-email/'+batch.id);
  if(!error&&data?.id){await db.prepare('UPDATE notification_email_batches SET provider_id=? WHERE id=?').bind(data.id,batch.id).run();return await closeBatch('accepted');}
  const status=error?.statusCode;
  if(!status||status===429||status>=500||(status===409&&error?.name==='concurrent_idempotent_requests')){
   const retryAt=nextEmailRetry(now,batch.attempts+1,headers?.['retry-after']);
   await db.prepare('UPDATE notification_email_batches SET retry_at=? WHERE id=?').bind(retryAt,batch.id).run();
   if(status===429)await recordEmailCooldown(db,retryAt);
   return await finish('retry-needed');
  }
  return await closeBatch(status===401||status===403?'provider-configuration-error':'provider-rejected');
 }finally{await db.prepare('DELETE FROM notification_email_lock WHERE id=1 AND token=?').bind(token).run();}
}
export async function unsubscribeEmail(req:Request){
 const token=new URL(req.url).searchParams.get('token')||'';if(!/^[a-f0-9-]{72}$/.test(token))return new Response('Invalid email link',{status:400});
 if(req.method==='GET')return new Response(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email notifications</title><body style="font:16px Arial;color:#202b4d;max-width:480px;margin:40px auto;padding:16px"><h1>Stop email notifications?</h1><p>Your in-app notifications will stay unchanged.</p><form method="post"><button style="padding:14px;background:#c29a34;border:0;border-radius:6px;font-weight:bold">Stop email notifications</button></form></body></html>`,{headers:{'Content-Type':'text/html;charset=utf-8','Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const db=database();for(let i=0;i<4;i++){const row=await db.prepare("SELECT user_id,revision,payload FROM notification_accounts WHERE json_extract(payload,'$.emailUnsubscribeToken')=?").bind(token).first();if(!row)return new Response('Email notifications are off.');const state=JSON.parse(row.payload);state.preferences=notificationPreferences(state.preferences);for(const [key] of NOTIFICATION_CATEGORIES)state.preferences['email_'+key]=false;state.events=state.events.map((e:any)=>({...e,emailSuppressed:true}));const changed=await db.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(JSON.stringify(state),row.user_id,row.revision).run();if(changed.meta.changes)return new Response('Email notifications are off. Your in-app settings are unchanged.',{headers:{'Cache-Control':'no-store'}});}return new Response('Please try again.',{status:409});
}

export async function pumpEmails(config:any){
 if(!emailConfigured(config))return {status:'not-configured'};
 const db=config.DB,now=Date.now();let jobs=0;
 const finish=async(status:string)=>{await db.prepare("INSERT INTO sync_state(id,payload) VALUES('email-timer',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify({lastCheckedAt:new Date(now).toISOString(),status,jobs})).run();return {status};};
 try{
 // Idle minute ticks stay local: no self-fetch, Clerk lookup, or provider request.
 const state=await db.prepare("SELECT (SELECT payload FROM sync_state WHERE id='email-provider-cooldown') AS cooldown, EXISTS(SELECT 1 FROM notification_email_queue WHERE status='pending' AND batch_id IS NULL AND queued_at<=?) OR EXISTS(SELECT 1 FROM notification_email_batches WHERE status='pending' AND retry_at<=?) OR EXISTS(SELECT 1 FROM bug_report_email WHERE status='pending' AND retry_at<=?) AS due").bind(now,now,now).first();
 if(state?.cooldown&&Number(JSON.parse(state.cooldown).until)>now)return await finish('cooldown');
 const operationalDue=config.OPERATIONS_ENABLED==='true'&&await db.prepare("SELECT 1 FROM operational_email WHERE status='pending' AND retry_at<=? LIMIT 1").bind(now).first();
 if(!state?.due&&!operationalDue)return await finish('idle');
 if(!await emailBudgetAvailable(db,now))return await finish('free-limit');
 for(let i=0;i<6;i++){
  jobs++;
  const r=await fetch(config.APP_ORIGIN+'/api/notification-jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.SYNC_SECRET}`},body:JSON.stringify({action:'email'}),redirect:'manual',signal:AbortSignal.timeout(35000)});
  if(!r.ok)throw Error('Email processor temporarily unavailable');
  const result:any=await r.json();if(!['accepted','cancelled','skipped','no-verified-email','recipient-changed','expired','retry-exhausted','uncertain-expired','retired-provider','provider-rejected'].includes(result.status))return await finish(result.status);
 }
 return await finish('more');
 }catch(error){await finish('error');throw error;}
}
