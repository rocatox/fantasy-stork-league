// Prepare only an isolated copy; never alter the production Wrangler config.
import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
const root=path.resolve('.wrangler/private-backups/app-failover-2026-11-07'),app=path.join(root,'app');
const state=JSON.parse(fs.readFileSync(path.join(root,'cloud-restore.json')));
const production=new Set(JSON.parse(fs.readFileSync('wrangler.jsonc')).d1_databases.map(d=>d.database_id));
const report=JSON.parse(fs.readFileSync(path.join(root,'report.json'))),names=Object.keys(report.capture);
const binding=n=>report.bindings?.[n]||(n==='main'?'DB':n==='archive'?'HISTORY_ARCHIVE':'HISTORY_ARCHIVE_'+n.slice(7));
for(const name of names)if(!state.targets[name]?.id||production.has(state.targets[name].id))throw Error('Isolated targets required');
const origin='https://recovery-drill.storkleague.fans',name='fantasy-stork-league-recovery-drill';
const token=fs.readFileSync(path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'),'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
const response=await fetch('https://api.cloudflare.com/client/v4/zones?name=storkleague.fans',{headers:{Authorization:'Bearer '+token}}),zones=await response.json();
if(!zones.success||zones.result.length!==1)throw Error('Cannot verify isolated hostname');
const domains=await (await fetch('https://api.cloudflare.com/client/v4/accounts/447b544d13b82f790d35ee40cf9374fd/workers/domains',{headers:{Authorization:'Bearer '+token}})).json();
if(!domains.success||domains.result.some(d=>d.hostname==='recovery-drill.storkleague.fans'))throw Error('Hostname already assigned or inventory unavailable');
const dns=await (await fetch('https://cloudflare-dns.com/dns-query?name=recovery-drill.storkleague.fans&type=A',{headers:{Accept:'application/dns-json'}})).json();
if(dns.Status!==3)throw Error('Test hostname is not NXDOMAIN; do not overwrite');
// Wrangler also performs its normal DNS/origin conflict checks; never override them.
const key=(await (await fetch('https://storkleague.fans/api/config')).json()).clerkPublishableKey;
if(!key?.startsWith('pk_live_'))throw Error('Production publishable key unavailable');
const config={name,main:'worker/recovery.ts',workers_dev:false,preview_urls:false,routes:[{pattern:new URL(origin).hostname,custom_domain:true}],account_id:'447b544d13b82f790d35ee40cf9374fd',compatibility_date:'2026-10-26',compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],assets:{binding:'ASSETS',directory:'./dist/client',not_found_handling:'single-page-application',run_worker_first:true},vars:{HISTORY_SHARD_COUNT:String(names.length-1),APP_ORIGIN:origin,CLERK_PUBLISHABLE_KEY:key,EMAIL_ENABLED:'false',SYNC_ENABLED:'false',OPERATIONS_ENABLED:'false',DRILL_EXPIRES:String(Date.now()+86400000)},triggers:{crons:[]},observability:{enabled:false},d1_databases:names.map(n=>({binding:binding(n),database_id:state.targets[n].id,database_name:state.targets[n].name}))};
fs.writeFileSync(path.join(app,'wrangler.jsonc'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(app,'worker/recovery.ts'),"import app from './index';\nimport {failoverGate} from '../scripts/failover-gate.mjs';\nexport default failoverGate(app);\n");
const gate=randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'gate-secret.txt'),gate);
fs.writeFileSync(path.join(root,'open-private-drill.html'),`<!doctype html><meta name="referrer" content="no-referrer"><title>Open private recovery drill</title><form method="post" action="${origin}/__drill/unlock"><input type="hidden" name="token" value="${gate}"><button>Open private recovery app</button></form>`);
fs.writeFileSync(path.join(root,'app-environment.json'),JSON.stringify({name,origin,config:path.join(app,'wrangler.jsonc'),createdAt:new Date().toISOString()},null,2));
console.log('Private test config prepared. Hostname unused; no production config modified.');
