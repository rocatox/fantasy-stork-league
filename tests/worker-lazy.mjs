import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.lazyLoads=[];globalThis.lazyCalls=[];globalThis.fetch=async()=>{throw Error('External HTTP forbidden');};
const routeNames=['capacity','notification-email','notification-delivery','sync-timer.mjs','race-endpoint','snapshot-endpoint','history-endpoint','history-read'];
await build({entryPoints:['worker/index.ts'],outdir:'.runner/lazy-worker',entryNames:'index',outExtension:{'.js':'.mjs'},bundle:true,splitting:true,format:'esm',platform:'node',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 b.onResolve({filter:/app\/api\/|lib\//},a=>{const name=a.path.split('/').at(-1);return a.path.includes('app/api/')||routeNames.includes(name)?{path:a.path,namespace:'fixture'}:null;});
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env={};':`
 globalThis.lazyLoads.push(${JSON.stringify(a.path)});
 const record=(name,args)=>{globalThis.lazyCalls.push({module:${JSON.stringify(a.path)},name,args});return {ok:true};};
 export const GET=async req=>Response.json(record('GET',[req.method]));
 export const POST=async req=>{if(req.headers.has('x-fixture-error'))throw Error('fixture');return Response.json(record('POST',[req.method]));};
 export const capacity=POST;
 export const runSyncTimer=async(...args)=>record('sync',args);
 export const pumpNotifications=async(...args)=>record('notifications',args);
 export const pumpEmails=async(...args)=>record('email',args);
 export const deliverEmail=async()=>record('deliverEmail',[]);
 export const notificationTick=async()=>record('tick',[]);
 export const deliverNotificationEvent=async()=>record('deliver',[]);
 export const unsubscribeEmail=GET;
 `}));
}}]});
const worker=(await import('../.runner/lazy-worker/index.mjs')).default;
const pending=[],ctx={waitUntil:p=>pending.push(p)},env={SYNC_SECRET:'fixture',CLERK_PUBLISHABLE_KEY:'pk-fixture',ASSETS:{fetch:async()=>new Response('asset')}};
let hit=true;globalThis.caches={default:{match:async()=>hit?Response.json({cached:true}):null,put:async()=>{}}};
const request=async(path,method='GET',headers={},body)=>worker.fetch(new Request('https://test'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,ctx);
assert.equal(lazyLoads.length,0);
assert.equal((await request('/api/config')).status,200);assert.equal((await request('/')).status,200);
assert.equal((await request('/api/notification-jobs','POST')).status,401);
assert.equal((await request('/api/operations','POST')).status,401);
assert.equal((await request('/api/operations','GET')).status,401);
assert.equal((await request('/api/account-deletion-jobs','POST')).status,401);
assert.equal((await request('/api/account-deletion-jobs?discover=1','POST')).status,401);
assert.equal((await request('/api/account','PUT')).status,405);
assert.equal((await request('/api/birds')).status,200);assert.equal((await request('/api/history?rankings=1')).status,200);assert.equal(lazyLoads.length,0,'Cache hits/config/assets must not evaluate unrelated handlers');
hit=false;
assert.equal((await request('/api/history?bird=fixture')).status,200);assert.ok(lazyLoads.every(x=>x.endsWith('history-read')));
await request('/api/history?bird=fixture');assert.equal(lazyLoads.length,1,'Modules initialize once');
await worker.scheduled({cron:'* * * * *'},env);assert.equal(lazyCalls.at(-1).name,'email');assert.ok(!lazyLoads.some(x=>x.endsWith('race-endpoint')));
await worker.scheduled({cron:'11,26,41,56 * * * *'},env);assert.ok(lazyCalls.some(c=>c.name==='notifications'&&c.args[1]===true&&c.args[2]===12));
for(const path of ['/api/leagues','/api/sync','/api/race']){await request(path,'POST');await Promise.all(pending);assert.equal(lazyCalls.at(-1).name,'notifications');assert.deepEqual(lazyCalls.at(-1).args.slice(1),[false,4]);}
const pumps=lazyCalls.filter(c=>c.name==='notifications').length;assert.equal((await request('/api/race','POST',{'x-fixture-error':'1'})).status,503);assert.equal(lazyCalls.filter(c=>c.name==='notifications').length,pumps);
for(const action of ['tick','email','deliver'])assert.equal((await request('/api/notification-jobs','POST',{authorization:'Bearer fixture'},{action})).status,200);
for(const path of ['/api/notifications','/api/lists','/api/leagues']){assert.equal((await request(path)).status,200);assert.equal((await request(path,'PUT')).status,405);}
assert.equal((await request('/api/no-such-route')).status,404);
await request('/api/bug-reports','POST');await Promise.all(pending);assert.equal(lazyCalls.at(-1).name,'email');
console.log('Lazy Worker: cache/config bypass, single module evaluation, auth job gate, route errors, unchanged successful-write pumps and both scheduled job policies passed without external requests.');
