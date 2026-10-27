import {GET as birds} from '../app/api/birds/route';
import {GET as leagues,POST as leagueWrite} from '../app/api/leagues/route';
import {POST as sync} from '../app/api/sync/route';
import {syncPolicy} from '../lib/sync-policy.mjs';
import {disbandExpired} from '../lib/disband';
import {json} from '../lib/store';
const studies=['10449318','212096177','173641633','864730855','4809963363','21231406','24442409','76367850'];
export default {
 async fetch(req:Request,env:any){try{const path=new URL(req.url).pathname;
  if(path==='/api/config'&&req.method==='GET')return json({clerkPublishableKey:env.CLERK_PUBLISHABLE_KEY||null});
  if(path==='/api/health'&&req.method==='GET'){await env.DB.prepare('SELECT 1').first();return json({ok:true,authenticationConfigured:!!(env.CLERK_SECRET_KEY&&env.CLERK_PUBLISHABLE_KEY),schedulerEnabled:env.SYNC_ENABLED==='true'});}
  if(path==='/api/birds'&&req.method==='GET')return birds();
  if(path==='/api/leagues'){if(req.method==='GET')return leagues(req);if(req.method==='POST')return leagueWrite(req);return json({error:'Method not allowed'},405);}
  if(path==='/api/sync'&&req.method==='POST')return sync(req);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  return env.ASSETS.fetch(req);
 }catch{console.error('Request failed; details suppressed to protect credentials');return json({error:'Service temporarily unavailable'},503);}},
 async scheduled(controller:ScheduledController,env:any){if(env.SYNC_ENABLED!=='true')return;const now=controller.scheduledTime;await disbandExpired(now);const policy=syncPolicy(now);
  // Hourly UTC trigger; Eastern-time policy accounts for daylight saving.
  const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(now));if(!policy.racing&&Number(p)%6!==0)return;
  for(const studyId of studies){let ok=false;for(let attempt=0;attempt<2;attempt++){const result=await sync(new Request('https://internal/api/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.SYNC_SECRET}`},body:JSON.stringify({studyId})}));if(result.ok){ok=true;break;}if(result.status===401||result.status===403)break;if(attempt===0)await new Promise(resolve=>setTimeout(resolve,30000));}if(!ok)console.error('Scheduled study sync failed',studyId);}
 }
};
