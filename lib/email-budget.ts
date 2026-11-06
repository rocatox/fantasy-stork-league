export const EMAIL_DAILY_CAP=90,EMAIL_MONTHLY_CAP=2700;
// Both senders call these while holding notification_email_lock.
export async function emailBudgetAvailable(db:any,now:number){
 const day='day:'+new Date(now).toISOString().slice(0,10);
 const rows=(await db.prepare('SELECT period,attempts FROM notification_email_budget WHERE period>=? AND period<=?').bind('day:'+new Date(now-31*86400000).toISOString().slice(0,10),day).all()).results;
 return Number(rows.find((r:any)=>r.period===day)?.attempts||0)<EMAIL_DAILY_CAP&&rows.reduce((n:number,r:any)=>n+Number(r.attempts),0)<EMAIL_MONTHLY_CAP;
}
export function emailBudgetCharges(db:any,now:number){return ['day:'+new Date(now).toISOString().slice(0,10),'month:'+new Date(now).toISOString().slice(0,7)].map(period=>db.prepare('INSERT INTO notification_email_budget(period,attempts) VALUES(?,1) ON CONFLICT(period) DO UPDATE SET attempts=attempts+1').bind(period));}
