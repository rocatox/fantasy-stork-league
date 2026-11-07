import {EMAIL_DIGEST_MS} from './email-digest.mjs';
import {Resend} from 'resend';
import {emailBudgetAvailable,emailBudgetCharges} from './email-budget';
const esc=(s:any)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function bugReportMessage(report:any,to:string,from:string){
 const labels:Record<string,string>={map:'Migration map',scouting:'Scout storks',leagues:'My leagues',settings:'Settings',notifications:'Notifications',other:'Other'};
 const area=labels[report.area]||report.area,date=new Date(report.created_at).toISOString();
 const text=`New bug report\n\n${report.title}\nArea: ${area}\nSubmitted: ${date}\nReference: ${report.id}\n\n${report.description}`;
 return {from:`Fantasy Stork League <${from}>`,to:[to],subject:('Bug report — '+report.title).replace(/[\r\n]/g,' ').slice(0,160),text,
 html:`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:auto;font-family:Arial,Helvetica,sans-serif;color:#202b4d"><tr><td><h1 style="font-size:22px;line-height:1.3;border-bottom:3px solid #c29a34;padding-bottom:12px">New bug report</h1><h2 style="font-size:18px;line-height:1.4;overflow-wrap:anywhere">${esc(report.title)}</h2><p style="font-size:13px;line-height:1.6">Area: ${esc(area)}<br>Submitted: ${esc(date)}<br>Reference: ${esc(report.id)}</p><p style="font-size:15px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${esc(report.description)}</p></td></tr></table></td></tr></table></body></html>`};
}
// Called only by deliverEmail while holding the shared sender lease.
export async function deliverBugReportEmail(db:any,config:any,now:number){
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.BUG_REPORT_EMAIL||''))return {status:'empty'};
 const row=await db.prepare("SELECT e.*,r.id,r.title,r.area,r.description,r.created_at FROM bug_report_email e JOIN bug_reports r ON r.id=e.report_id WHERE e.status='pending' AND e.retry_at<=? AND (e.attempts>0 OR r.created_at<=?) ORDER BY r.created_at LIMIT 1").bind(now,now-EMAIL_DIGEST_MS).first();if(!row)return {status:'empty'};
 const finish=async(status:string,terminal=false)=>{if(terminal)await db.prepare('UPDATE bug_report_email SET status=?,message=NULL WHERE report_id=?').bind(status,row.report_id).run();await db.prepare("INSERT INTO sync_state(id,payload) VALUES('bug-report-email',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify({lastCheckedAt:new Date(now).toISOString(),status})).run();return {status};};
 if(row.first_attempt_at&&now-row.first_attempt_at>=23*3600000)return finish('uncertain-expired',true);
 if(row.attempts>=6)return finish('retry-exhausted',true);
 if(!await emailBudgetAvailable(db,now))return finish('free-limit');
 const message=row.message?JSON.parse(row.message):bugReportMessage(row,config.BUG_REPORT_EMAIL,config.EMAIL_FROM);
 if(message.to[0]!==config.BUG_REPORT_EMAIL)return finish('recipient-changed',true);
 await db.batch([...emailBudgetCharges(db,now),db.prepare('UPDATE bug_report_email SET message=?,first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1,retry_at=? WHERE report_id=?').bind(JSON.stringify(message),now,now+15*60000,row.report_id)]);
 const {data,error,headers}=await new Resend(config.RESEND_API_KEY).emails.send(message,{idempotencyKey:'stork-bug/'+row.report_id,signal:AbortSignal.timeout(12000)});
 if(!error&&data?.id){await db.prepare('UPDATE bug_report_email SET provider_id=? WHERE report_id=?').bind(data.id,row.report_id).run();return finish('accepted',true);}
 const status=error?.statusCode;
 if(!status||status===429||status>=500||(status===409&&error?.name==='concurrent_idempotent_requests')){const retry=headers?.['retry-after'];const wait=Number(retry)*1000||Date.parse(retry||'')-now;if(wait>15*60000)await db.prepare('UPDATE bug_report_email SET retry_at=? WHERE report_id=?').bind(now+wait,row.report_id).run();return finish('retry-needed');}
 return finish(status===401||status===403?'provider-configuration-error':'provider-rejected',true);
}
