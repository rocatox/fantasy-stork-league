import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('.wrangler/private-backups/app-failover-2026-11-07');
const target=JSON.parse(fs.readFileSync(path.join(dir,'app-environment.json')));
assert.equal(target.name,'fantasy-stork-league-recovery-drill');
assert.equal(target.origin,'https://recovery-drill.storkleague.fans');
const token=fs.readFileSync(path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'),'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
assert.ok(token);
const base='https://api.cloudflare.com/client/v4/accounts/447b544d13b82f790d35ee40cf9374fd/workers';
async function api(p,method='GET'){
 const r=await fetch(base+p,{method,headers:{Authorization:`Bearer ${token}`}});
 if(r.status===204&&method==='DELETE')return null;
 const j=await r.json();
 if(!r.ok||!j.success)throw Error(`Cloudflare ${method} ${p}: HTTP ${r.status}`);
 return j.result;
}
const before=await api('/services');
assert.ok(before.some(s=>s.id==='fantasy-stork-league'));
const domains=await api('/domains');
for(const d of domains.filter(d=>d.hostname==='recovery-drill.storkleague.fans')){
 assert.equal(d.service,target.name);
 await api(`/domains/${d.id}`,'DELETE');
}
if(before.some(s=>s.id===target.name))await api(`/services/${target.name}`,'DELETE');
const after=await api('/services');
assert.ok(after.some(s=>s.id==='fantasy-stork-league'));
assert.ok(!after.some(s=>s.id===target.name));
const remaining=await api('/domains');
assert.ok(!remaining.some(d=>d.hostname==='recovery-drill.storkleague.fans'));
assert.ok(remaining.some(d=>d.hostname==='storkleague.fans'&&d.service==='fantasy-stork-league'));
const report={at:new Date().toISOString(),testWorkerRemoved:true,testDomainRemoved:true,productionWorkerPresent:true,productionDomainPresent:true};
fs.writeFileSync(path.join(dir,'app-cleanup.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
