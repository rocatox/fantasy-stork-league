export const EMAIL_CRON='* * * * *';
export const SYNC_CRON='11,26,41,56 * * * *';
export async function scheduledJobs(event,env,jobs){
 if(event.cron===EMAIL_CRON)return jobs.email(env);
 if(event.cron!==SYNC_CRON)throw Error('Unknown scheduled job');
 const results=await Promise.allSettled([jobs.sync(env),jobs.notifications(env,true,12)]);
 if(results.some(r=>r.status==='rejected'))throw Error('Scheduled task failed; pending notification work remains queued');
}
