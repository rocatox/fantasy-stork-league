import {archiveEntries} from './history-shards';
import {env} from 'cloudflare:workers';
import {database,json} from './store';
import {capacityWarnings,capacityHistory} from './capacity-policy.mjs';
import {emailLimits} from './email-budget';
export async function capacity(req:Request){
 const config:any=env;if(req.method!=='POST'||!config.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${config.SYNC_SECRET}`)return json({error:'Unauthorized'},401);
 const db=database(),now=Date.now(),databases:any={};
 for(const {key:name,store} of archiveEntries()){
  const result=await (store as any).prepare('SELECT 1').run();const size=Number(result.meta?.size_after);databases[name]=size>0?size:null;
 }
 const day='day:'+new Date(now).toISOString().slice(0,10),budget=(await db.prepare('SELECT period,attempts FROM notification_email_budget WHERE period>=? AND period<=?').bind('day:'+new Date(now-31*86400000).toISOString().slice(0,10),day).all()).results;
 const queue=await db.prepare("SELECT count(*) AS pending,min(created_at) AS oldest FROM notification_email_queue WHERE status='pending'").first();
 const limits=emailLimits();
 const sample={checkedAt:now,databases,email:{dailyUsed:Number(budget.find((r:any)=>r.period===day)?.attempts||0),dailyCap:limits.daily,rollingUsed:budget.reduce((n:number,r:any)=>n+Number(r.attempts),0),rollingCap:limits.rolling,pending:Number(queue.pending),oldestPendingAt:queue.oldest||null}};
 const old=await db.prepare("SELECT payload FROM sync_state WHERE id='capacity'").first();const report={...sample,warnings:capacityWarnings(sample),history:capacityHistory(old?JSON.parse(old.payload).history:[],sample)};
 await db.prepare("INSERT INTO sync_state(id,payload) VALUES('capacity',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify(report)).run();return json(report);
}
