import test from 'node:test';import assert from 'node:assert/strict';import {failoverGate} from '../scripts/failover-gate.mjs';
const key='a'.repeat(64),env={EMAIL_ENABLED:'false',SYNC_ENABLED:'false',DRILL_EXPIRES:String(Date.now()+3600000),DRILL_GATE_KEY:key};
test('recovery gate protects assets and API, blocks jobs and fails closed',async()=>{
 let calls=0;const handler=failoverGate({fetch:async()=>{calls++;return new Response('isolated app');}});
 const req=(p,opts={})=>new Request('https://recovery.example'+p,opts);
 for(const p of ['/','/api/birds','/api/history','/api/leagues'])assert.equal((await handler.fetch(req(p),env,{})).status,404);
 assert.equal(calls,0);
 const unlock=await handler.fetch(req('/__drill/unlock',{method:'POST',body:new URLSearchParams({token:key})}),env,{});assert.equal(unlock.status,303);assert.match(unlock.headers.get('set-cookie'),/Secure; HttpOnly/);
 const auth={headers:{cookie:'__Host-fsl-drill='+key}};
 assert.equal((await handler.fetch(req('/api/leagues',auth),env,{})).status,200);assert.equal(calls,1);
 for(const p of ['/api/notification-jobs','/api/sync','/api/bug-reports'])assert.equal((await handler.fetch(req(p,auth),env,{})).status,403);
 for(const overrides of [{EMAIL_ENABLED:'true'},{BREVO_API_KEY:'unexpected'},{SYNC_SECRET:'unexpected'},{DRILL_EXPIRES:'0'}])assert.equal((await handler.fetch(req('/',auth),{...env,...overrides},{})).status,503);
 assert.equal(calls,1);
});
