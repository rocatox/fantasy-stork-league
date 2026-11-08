import {sendEmail,retryWindow} from './email-provider';
import {emailBudgetAvailable,emailBudgetCharges} from './email-budget';
import {nextEmailRetry,recordEmailCooldown} from './email-retry.mjs';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function operationalMessage(config:any,notices:any[],now:number){
 const text=`Fantasy Stork League operational status\nChecked: ${new Date(now).toISOString()}\n\n`+notices.map(n=>`${n.level.toUpperCase()} — ${n.id}\n${n.message}`).join('\n\n')+'\n\nThese are owner operational alerts, separate from player notification preferences.';
 return {from:`Fantasy Stork League <${config.EMAIL_FROM}>`,to:[config.BUG_REPORT_EMAIL],subject:'Fantasy Stork League — operational '+(notices.every(n=>n.level==='recovered')?'recovery':'alert'),text,html:`<!doctype html><html><body><div style="font:16px/1.5 Arial;max-width:640px;margin:auto;padding:16px"><h1 style="font-size:22px">Operational status</h1><p style="white-space:pre-wrap">${esc(text)}</p></div></body></html>`};
}
// Only called inside the existing shared email sender lease and provider cooldown.
export async function deliverOperationalEmail(db:any,config:any,now:number){
 if(config.OPERATIONS_ENABLED!=='true')return {status:'empty'};
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.BUG_REPORT_EMAIL||''))return {status:'empty'};
 const row=await db.prepare("SELECT * FROM operational_email WHERE status='pending' AND retry_at<=? ORDER BY created_at LIMIT 1").bind(now).first();
 if(!row)return {status:'empty'};
 const finish=async(status:string)=>{await db.prepare('UPDATE operational_email SET status=?,message=NULL WHERE id=?').bind(status,row.id).run();return {status};};
 if(now-row.created_at>2*86400000)return finish('expired');
 if(row.first_attempt_at&&now-row.first_attempt_at>=retryWindow())return finish('uncertain-expired');
 if(row.attempts>=6)return finish('retry-exhausted');
 if(!await emailBudgetAvailable(db,now))return {status:'free-limit'};
 const message=row.message?JSON.parse(row.message):operationalMessage(config,JSON.parse(row.payload),row.created_at);
 if(message.to[0]!==config.BUG_REPORT_EMAIL)return finish('recipient-changed');
 await db.batch([...emailBudgetCharges(db,now),db.prepare('UPDATE operational_email SET message=?,first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1,retry_at=? WHERE id=?').bind(JSON.stringify(message),now,nextEmailRetry(now,row.attempts+1),row.id)]);
 const {data,error,headers}=await sendEmail(config,'brevo',message,'stork-operations/'+row.id);
 if(data?.id&&!error){await db.prepare('UPDATE operational_email SET provider_id=? WHERE id=?').bind(data.id,row.id).run();return finish('accepted');}
 const status=error?.statusCode;
 if(!status||status===429||status>=500){const retryAt=nextEmailRetry(now,row.attempts+1,headers?.['retry-after']);await db.prepare('UPDATE operational_email SET retry_at=? WHERE id=?').bind(retryAt,row.id).run();if(status===429)await recordEmailCooldown(db,retryAt);return {status:'retry-needed'};}
 return finish(status===401||status===403?'provider-configuration-error':'provider-rejected');
}
