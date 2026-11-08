import {test} from 'node:test';import assert from 'node:assert/strict';import {fetchWithTimeout} from '../lib/request-timeout.mjs';
test('hung mutations time out without replay and warn about ambiguous completion',async()=>{
 let calls=0;const hung=(_u,{signal})=>new Promise((_r,reject)=>{calls++;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});
 await assert.rejects(fetchWithTimeout('/isolated',{method:'POST'},hung,10),/check whether your change was saved/);assert.equal(calls,1);
});
test('caller cancellation and successful responses are preserved',async()=>{
 const c=new AbortController();const req=fetchWithTimeout('/isolated',{signal:c.signal},(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));c.abort();await assert.rejects(req,{name:'AbortError'});
 const r=new Response('ok');assert.equal(await fetchWithTimeout('/isolated',{},async()=>r),r);
});
