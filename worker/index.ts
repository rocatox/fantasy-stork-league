import {capacity} from '../lib/capacity';
import {publicCached} from '../lib/public-cache.mjs';
import {POST as bugReport} from '../app/api/bug-reports/route';
import {deliverEmail,emailConfigured,pumpEmails,unsubscribeEmail} from '../lib/notification-email';
import {deliverNotificationEvent,notificationTick,pumpNotifications} from '../lib/notification-delivery';
import {GET as notifications,POST as notificationWrite} from '../app/api/notifications/route';
import {runSyncTimer} from '../lib/sync-timer.mjs';
import {GET as lists,POST as listWrite} from '../app/api/lists/route';
import {POST as race} from '../lib/race-endpoint';
import {GET as birds} from '../app/api/birds/route';
import {GET as leagues,POST as leagueWrite} from '../app/api/leagues/route';
import {POST as sync} from '../lib/snapshot-endpoint';
import {GET as historyRead,POST as historyWrite} from '../lib/history-endpoint';


import {SessionError} from '../lib/auth-error';
import {json} from '../lib/store';

export default {
 async scheduled(_event:any,env:any){const results=await Promise.allSettled([runSyncTimer(env),pumpNotifications(env,true,12).finally(()=>pumpEmails(env))]);if(results.some(r=>r.status==='rejected'))throw Error('Scheduled task failed; pending notification work remains queued');},
 async fetch(req:Request,env:any,ctx:any){try{const path=new URL(req.url).pathname;
  if(path==='/api/capacity')return await capacity(req);
  if(path==='/api/notification-jobs'){if(req.method!=='POST'||!env.SYNC_SECRET||req.headers.get('authorization')!==`Bearer ${env.SYNC_SECRET}`)return json({error:'Unauthorized'},401);const body:any=await req.json();if(body.action==='tick')return json(await notificationTick());if(body.action==='email')return json(await deliverEmail());if(body.action==='deliver')return json(await deliverNotificationEvent());return json({error:'Unknown job'},400);}
  if((path==='/api/leagues'||path==='/api/sync'||path==='/api/race')&&req.method==='POST'){const response=await (path==='/api/leagues'?leagueWrite(req):path==='/api/sync'?sync(req):race(req));if(response.ok)ctx.waitUntil(pumpNotifications(env,false,4).catch(()=>console.error('Notification delivery deferred; durable queue will retry')));return response;}
  if(path==='/api/email-unsubscribe')return await unsubscribeEmail(req);
  if(path==='/api/config'&&req.method==='GET')return json({clerkPublishableKey:env.CLERK_PUBLISHABLE_KEY||null});
  if(path==='/api/health'&&req.method==='GET'){await env.DB.prepare('SELECT 1').first();return json({ok:true,emailConfigured:emailConfigured(env),email:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='email-processor'").first())?.payload||'null'),notifications:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='notification-processor'").first())?.payload||'null'),notificationQueue:(await env.DB.prepare('SELECT COUNT(*) pending FROM notification_outbox').first())?.pending,authenticationConfigured:!!(env.CLERK_SECRET_KEY&&env.CLERK_PUBLISHABLE_KEY),schedulerEnabled:env.SYNC_ENABLED==='true',timerConfigured:!!env.GITHUB_SYNC_TOKEN,timer:JSON.parse((await env.DB.prepare("SELECT payload FROM sync_state WHERE id='cloudflare-sync-timer'").first())?.payload||'null')});}
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

