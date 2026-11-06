import {Resend} from 'resend';
import {env} from 'cloudflare:workers';
import {database,json} from './store';
import {addStandings} from './standings';
import {emailNotificationEnabled,notificationPreferences,reconcileNotifications,NOTIFICATION_CATEGORIES} from './notifications.mjs';
const HOUR=3600000,DAY=24*HOUR;
export const EMAIL_DAILY_CAP=90,EMAIL_MONTHLY_CAP=2700;
export function emailConfigured(config:any=env){return config.EMAIL_ENABLED==='true'&&!!config.RESEND_API_KEY&&!!config.CLERK_SECRET_KEY&&/^[a-z0-9._+-]+@notify\.storkleague\.fans$/i.test(config.EMAIL_FROM||'')&&config.APP_ORIGIN==='https://storkleague.fans';}
const esc=(s:any)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function emailMessage(origin:string,to:string,from:string,token:string,events:any[]){
 const settings=origin+'/?view=settings',unsubscribe=origin+'/api/email-unsubscribe?token='+encodeURIComponent(token);
 const sections=events.map(e=>({heading:`${e.leagueName}: ${e.title}`,body:e.body,date:new Date(e.createdAt).toISOString().replace('T',' ').slice(0,16)+' UTC',url:origin+'/?view=leagues&league='+encodeURIComponent(e.leagueId)}));
 return {from:`Fantasy Stork League <${from}>`,to:[to],subject:`Fantasy Stork League — ${events.length===1?events[0].title:events.length+' updates'}`.replace(/[\r\n]/g,' ').slice(0,180),text:sections.map(s=>`${s.heading}\n${s.date}\n${s.body}\n${s.url}`).join('\n\n')+`\n\nNotification settings: ${settings}\nStop all email notifications: ${unsubscribe}`,
 html:`<div style="font:15px/1.6 Arial,sans-serif;color:#202b4d;max-width:600px;margin:auto"><h1 style="font-size:20px;border-bottom:3px solid #c29a34;padding-bottom:12px">Fantasy Stork League</h1>${sections.map(s=>`<section style="padding:12px 0;border-bottom:1px solid #dde1ea"><h2 style="font-size:16px;margin:0">${esc(s.heading)}</h2><small>${esc(s.date)}</small><p>${esc(s.body)}</p><a href="${esc(s.url)}">View league</a></section>`).join('')}<p style="font-size:12px"><a href="${settings}">Notification settings</a> · <a href="${esc(unsubscribe)}">Stop email notifications</a></p></div>`,headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
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
  // Retain deduplication tombstones as long as their account events can still exist.
  await db.prepare('DELETE FROM notification_email_queue WHERE created_at<?').bind(now-91*DAY).run();
  await db.prepare('DELETE FROM notification_email_batches WHERE created_at<?').bind(now-91*DAY).run();
  await db.prepare("UPDATE notification_email_queue SET status='expired' WHERE status='pending' AND created_at<?").bind(now-2*DAY).run();
  let batch:any=await db.prepare("SELECT * FROM notification_email_batches WHERE status='pending' AND retry_at<=? ORDER BY created_at LIMIT 1").bind(now).first();
  let rows:any[]=[],userId:string;
  if(batch)userId=batch.user_id;
  else{const first=await db.prepare("SELECT user_id FROM notification_email_queue WHERE status='pending' AND batch_id IS NULL ORDER BY created_at LIMIT 1").first();if(!first)return await finish('empty');userId=first.user_id;rows=(await db.prepare("SELECT * FROM notification_email_queue WHERE status='pending' AND batch_id IS NULL AND user_id=? ORDER BY created_at LIMIT 20").bind(userId).all()).results;}
  const record=await db.prepare('SELECT payload FROM notification_accounts WHERE user_id=?').bind(userId).first(),account=record?JSON.parse(record.payload):null;
  const leagueRows=await db.prepare("SELECT state FROM leagues WHERE EXISTS(SELECT 1 FROM json_each(state,'$.members') WHERE json_extract(value,'$.id')=?)").bind(userId).all();
  const leagues=await addStandings(leagueRows.results.map((r:any)=>JSON.parse(r.state)));
  const current=account?reconcileNotifications(account,leagues,userId,now):null,existing=new Map((account?.events||[]).map((e:any)=>[e.id,e])),active=new Map((current?.events||[]).map((e:any)=>[e.id,e.active]));
  const allowed=(e:any)=>{const stored:any=existing.get(e.id);return !!account?.emailUnsubscribeToken&&stored?.emailSuppressed===false&&e.createdAt>=now-2*DAY&&emailNotificationEnabled(account.preferences,e,account.emailEnabledSince)&&leagues.some((l:any)=>l.id===e.leagueId&&!['disbanded','abandoned'].includes(l.status))&&(!e.actionable||active.get(e.id));};
  const closeBatch=async(status:string)=>{await db.batch([db.prepare('UPDATE notification_email_batches SET status=?,payload=? WHERE id=?').bind(status,'{}',batch.id),db.prepare('UPDATE notification_email_queue SET status=? WHERE batch_id=?').bind(status,batch.id)]);return await finish(status);};
  if(batch){const payload=JSON.parse(batch.payload);if(!payload.events.every(allowed)||!account?.emailUnsubscribeToken)return await closeBatch('cancelled');if(batch.first_attempt_at&&now-batch.first_attempt_at>=23*HOUR)return await closeBatch('uncertain-expired');}
  else{
   const rejected=rows.filter(r=>!allowed(JSON.parse(r.payload))).map(r=>r.event_id);
   if(rejected.length)await db.prepare("UPDATE notification_email_queue SET status='cancelled' WHERE user_id=? AND event_id IN (SELECT value FROM json_each(?))").bind(userId,JSON.stringify(rejected)).run();
   rows=rows.filter(r=>!rejected.includes(r.event_id));if(!rows.length||!account?.emailUnsubscribeToken)return await finish('skipped');
  }
  const to=await recipient(userId,config);
  if(!to){if(batch)return await closeBatch('no-verified-email');await db.prepare("UPDATE notification_email_queue SET status='no-verified-email' WHERE user_id=? AND batch_id IS NULL AND status='pending'").bind(userId).run();return await finish('no-verified-email');}
  if(batch&&JSON.parse(batch.payload).message.to[0]!==to)return await closeBatch('recipient-changed');
  if(!batch){const id=crypto.randomUUID(),events=rows.map(r=>JSON.parse(r.payload)),payload=JSON.stringify({events,message:emailMessage(config.APP_ORIGIN,to,config.EMAIL_FROM,account.emailUnsubscribeToken,events)});
   await db.batch([db.prepare('INSERT INTO notification_email_batches(id,user_id,payload,created_at) VALUES(?,?,?,?)').bind(id,userId,payload,now),db.prepare('UPDATE notification_email_queue SET batch_id=? WHERE user_id=? AND event_id IN (SELECT value FROM json_each(?)) AND batch_id IS NULL').bind(id,userId,JSON.stringify(rows.map(r=>r.event_id)))]);batch={id,user_id:userId,payload,created_at:now,attempts:0,first_attempt_at:null};
  }
  const date=new Date(now).toISOString(),day='day:'+date.slice(0,10),month='month:'+date.slice(0,7);
  const quota=await db.prepare('SELECT period,attempts FROM notification_email_budget WHERE period IN (?,?)').bind(day,month).all();const used=new Map(quota.results.map((r:any)=>[r.period,r.attempts]));
  if(Number(used.get(day)||0)>=EMAIL_DAILY_CAP||Number(used.get(month)||0)>=EMAIL_MONTHLY_CAP)return await finish('free-limit');
  if(batch.attempts>=6)return await closeBatch('retry-exhausted');
  // Charge attempts before the external request, including ambiguous failures; never overspend.
  await db.batch([...[day,month].map(period=>db.prepare('INSERT INTO notification_email_budget(period,attempts) VALUES(?,1) ON CONFLICT(period) DO UPDATE SET attempts=attempts+1').bind(period)),db.prepare('UPDATE notification_email_batches SET first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1,retry_at=? WHERE id=?').bind(now,now+15*60000,batch.id)]);
  const {data,error,headers}=await new Resend(config.RESEND_API_KEY).emails.send(JSON.parse(batch.payload).message,{idempotencyKey:'stork-email/'+batch.id,signal:AbortSignal.timeout(12000)});
  if(!error&&data?.id){await db.prepare('UPDATE notification_email_batches SET provider_id=? WHERE id=?').bind(data.id,batch.id).run();return await closeBatch('accepted');}
  const status=error?.statusCode;
  if(!status||status===429||status>=500||(status===409&&error?.name==='concurrent_idempotent_requests')){
   const retryAfter=headers?.['retry-after'];const wait=Number(retryAfter)*1000||Date.parse(retryAfter||'')-now;
   if(wait>15*60000)await db.prepare('UPDATE notification_email_batches SET retry_at=? WHERE id=?').bind(now+wait,batch.id).run();
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
 for(let i=0;i<2;i++){
  const r=await fetch(config.APP_ORIGIN+'/api/notification-jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.SYNC_SECRET}`},body:JSON.stringify({action:'email'}),redirect:'manual',signal:AbortSignal.timeout(35000)});
  if(!r.ok)throw Error('Email processor temporarily unavailable');
  const result:any=await r.json();if(!['accepted','cancelled','skipped','no-verified-email','recipient-changed','expired','retry-exhausted','uncertain-expired'].includes(result.status))return result;
 }
 return {status:'more'};
}
