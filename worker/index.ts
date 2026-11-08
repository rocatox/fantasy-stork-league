const pumpDeletions=(env:any)=>env.ACCOUNT_DELETION_ENABLED==='true'?import('../lib/account-deletion').then(m=>m.pumpDeletions(env)):Promise.resolve({status:'disabled'});
const pumpOperations=(env:any)=>import('../lib/operational-monitor').then(m=>m.pumpOperations(env));
import {scheduledJobs} from '../lib/scheduled-jobs.mjs';
import {publicCached} from '../lib/public-cache.mjs';
import {emailConfigured} from '../lib/email-config';

// Dynamic imports stay behind routing/cache lookup. Module initialization is
// deferred and cached by the runtime; no per-user response/session is cached.
const capacity=(req:Request)=>import('../lib/capacity').then(m=>m.capacity(req));
const bugReport=(req:Request)=>import('../app/api/bug-reports/route').then(m=>m.POST(req));
const deliverEmail=()=>import('../lib/notification-email').then(m=>m.deliverEmail());
const pumpEmails=(env:any)=>import('../lib/notification-email').then(m=>m.pumpEmails(env));
const unsubscribeEmail=(req:Request)=>import('../lib/notification-email').then(m=>m.unsubscribeEmail(req));
const deliverNotificationEvent=()=>import('../lib/notification-delivery').then(m=>m.deliverNotificationEvent());
const notificationTick=()=>import('../lib/notification-delivery').then(m=>m.notificationTick());
const pumpNotifications=(env:any,maintenance:boolean,limit:number)=>import('../lib/notification-delivery').then(m=>m.pumpNotifications(env,maintenance,limit));
const runSyncTimer=(env:any)=>import('../lib/sync-timer.mjs').then(m=>m.runSyncTimer(env));
const notifications=(req:Request)=>import('../app/api/notifications/route').then(m=>m.GET(req));
const notificationWrite=(req:Request)=>import('../app/api/notifications/route').then(m=>m.POST(req));
const lists=(req:Request)=>import('../app/api/lists/route').then(m=>m.GET(req));
const listWrite=(req:Request)=>import('../app/api/lists/route').then(m=>m.POST(req));
const race=(req:Request)=>import('../lib/race-endpoint').then(m=>m.POST(req));
const birds=()=>import('../app/api/birds/route').then(m=>m.GET());
const leagues=(req:Request)=>import('../app/api/leagues/route').then(m=>m.GET(req));
const leagueWrite=(req:Request)=>import('../app/api/leagues/route').then(m=>m.POST(req));
const sync=(req:Request)=>import('../lib/snapshot-endpoint').then(m=>m.POST(req));
const historyRead=(req:Request)=>import('../lib/history-read').then(m=>m.GET(req));
const historyWrite=(req:Request)=>import('../lib/history-endpoint').then(m=>m.POST(req));


import {SessionError} from '../lib/auth-error';
import {json} from '../lib/store';

export default {
 async scheduled(event:any,env:any){return scheduledJobs(event,env,{sync:runSyncTimer,notifications:pumpNotifications,email:pumpEmails,operations:pumpOperations,deletions:pumpDeletions});},
 async fetch(req:Request,env:any,ctx:any){try{const path=new URL(req.url).pathname;
  if(path==='/api/account-deletion-jobs'){if(req.method!=='POST'||!env.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${env.SYNC_SECRET}`)return json({error:'Unauthorized'},401);const jobs=await import('../lib/account-deletion');return json(await (new URL(req.url).searchParams.get('discover')==='1'?jobs.discoverDeletedAccounts(env):jobs.processDeletion(env)));}
  if(path==='/api/account'){if(req.method!=='POST')return json({error:'Method not allowed'},405);return await (await import('../app/api/account/route')).POST(req);}
  if(path==='/api/operations'){if(!env.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${env.SYNC_SECRET}`)return json({error:'Unauthorized'},401);if(req.method==='POST')return json(await (await import('../lib/operational-monitor')).runOperations(env));if(req.method==='GET'){const state=await env.DB.prepare("SELECT payload FROM sync_state WHERE id='operational-monitor'").first();const email=await env.DB.prepare('SELECT status,count(*) count FROM operational_email GROUP BY status').all();return json({monitor:state?JSON.parse(state.payload):null,email:email.results});}return json({error:'Method not allowed'},405);}
  if(path==='/api/capacity')return await capacity(req);
  if(path==='/api/notification-jobs'){if(req.method!=='POST'||!env.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${env.SYNC_SECRET}`)return json({error:'Unauthorized'},401);const body:any=await req.json();if(body.action==='tick')return json(await notificationTick());if(body.action==='email')return json(await deliverEmail());if(body.action==='deliver')return json(await deliverNotificationEvent());return json({error:'Unknown job'},400);}
  if((path==='/api/leagues'||path==='/api/sync'||path==='/api/race')&&req.method==='POST'){const response=await (path==='/api/leagues'?leagueWrite(req):path==='/api/sync'?sync(req):race(req));if(response.ok)ctx.waitUntil(pumpNotifications(env,false,4).catch(()=>console.error('Notification delivery deferred; durable queue will retry')));return response;}
  if(path==='/api/email-unsubscribe')return await unsubscribeEmail(req);
  if(path==='/api/config'&&req.method==='GET')return json({clerkPublishableKey:env.CLERK_PUBLISHABLE_KEY||null,accountDeletionEnabled:env.ACCOUNT_DELETION_ENABLED==='true'});
  if(path==='/api/health'&&req.method==='GET'){await env.DB.prepare('SELECT 1').first();return json({ok:true,emailProvider:'brevo',emailConfigured:emailConfigured(env),emailTimer:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='email-timer'").first())?.payload||'null'),email:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='email-processor'").first())?.payload||'null'),notifications:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='notification-processor'").first())?.payload||'null'),notificationQueue:(await env.DB.prepare('SELECT COUNT(*) pending FROM notification_outbox').first())?.pending,authenticationConfigured:!!(env.CLERK_SECRET_KEY&&env.CLERK_PUBLISHABLE_KEY),schedulerEnabled:env.SYNC_ENABLED==='true',timerConfigured:!!env.GITHUB_SYNC_TOKEN,timer:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='cloudflare-sync-timer'").first())?.payload||'null')});}
  if(path==='/api/birds'&&req.method==='GET')return await publicCached(req,()=>birds(),(caches as any).default,ctx);
  if(path==='/api/bug-reports'){if(req.method==='POST'){const response=await bugReport(req);if(response.ok)ctx.waitUntil(pumpEmails(env).catch(()=>console.error('Bug report email deferred; durable queue will retry')));return response;}return json({error:'Method not allowed'},405);}
  if(path==='/api/notifications'){if(req.method==='GET')return await notifications(req);if(req.method==='POST')return await notificationWrite(req);return json({error:'Method not allowed'},405);}
  if(path==='/api/lists'){if(req.method==='GET')return await lists(req);if(req.method==='POST')return await listWrite(req);return json({error:'Method not allowed'},405);}
  if(path==='/api/leagues'){if(req.method==='GET')return await leagues(req);if(req.method==='POST')return await leagueWrite(req);return json({error:'Method not allowed'},405);}
  if(path==='/api/sync'&&req.method==='POST')return await sync(req);
  if(path==='/api/race'&&req.method==='POST')return await race(req);
  if(path==='/api/history'&&req.method==='GET')return await publicCached(req,()=>historyRead(req),(caches as any).default,ctx);
  if(path==='/api/history'&&req.method==='POST')return await historyWrite(req);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  return await env.ASSETS.fetch(req);
 }catch(error){if(error instanceof SessionError)return json({error:error.message+' ('+error.code+')',code:error.code},401);console.error('Request failed; details suppressed to protect credentials');return json({error:'Service temporarily unavailable'},503);}}
};

