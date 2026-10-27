import {GET as birds} from '../app/api/birds/route';
import {GET as leagues,POST as leagueWrite} from '../app/api/leagues/route';
import {POST as sync} from '../lib/snapshot-endpoint';


import {json} from '../lib/store';

export default {
 async fetch(req:Request,env:any){try{const path=new URL(req.url).pathname;
  if(path==='/api/config'&&req.method==='GET')return json({clerkPublishableKey:env.CLERK_PUBLISHABLE_KEY||null});
  if(path==='/api/health'&&req.method==='GET'){await env.DB.prepare('SELECT 1').first();return json({ok:true,authenticationConfigured:!!(env.CLERK_SECRET_KEY&&env.CLERK_PUBLISHABLE_KEY),schedulerEnabled:env.SYNC_ENABLED==='true'});}
  if(path==='/api/birds'&&req.method==='GET')return birds();
  if(path==='/api/leagues'){if(req.method==='GET')return leagues(req);if(req.method==='POST')return leagueWrite(req);return json({error:'Method not allowed'},405);}
  if(path==='/api/sync'&&req.method==='POST')return sync(req);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  return env.ASSETS.fetch(req);
 }catch{console.error('Request failed; details suppressed to protect credentials');return json({error:'Service temporarily unavailable'},503);}}
};
