import test from 'node:test';
import assert from 'node:assert/strict';
import {retryStatisticsBird} from '../lib/statistics-retry.mjs';

test('lost claim and committed summary responses recover with one lease and fresh progress',async()=>{
 let stored=false,claims=0,calculations=0,releases=0;const leases=[],delays=[];
 const api=async body=>{
  leases.push(body.lease);
  if(body.action==='release'){releases++;return {};}
  claims++;if(claims===1)throw Error('fetch failed');
  return {stored};
 };
 const value=await retryStatisticsBird(api,'synthetic-bird',async context=>{
  calculations++;
  if(!context.stored){stored=true;throw Error('terminated');}
  return 'ranking published';
 },{sleep:async ms=>delays.push(ms)});
 assert.equal(value,'ranking published');assert.equal(claims,3);
 assert.equal(calculations,2);assert.equal(releases,1);
 assert.equal(new Set(leases).size,1);assert.deepEqual(delays,[15000,30000]);
});

test('persistent network errors remain failures after three attempts and release the lease',async()=>{
 let claims=0,releases=0;
 const api=async b=>{if(b.action==='release'){releases++;return {};}claims++;return {};};
 await assert.rejects(retryStatisticsBird(api,'synthetic',async()=>{throw Error('fetch failed');},{sleep:async()=>{}}),/fetch failed/);
 assert.equal(claims,3);assert.equal(releases,1);
});

test('authentication, validation and competing leases fail immediately',async()=>{
 for(const status of [400,401,403,409,429]){
  let attempts=0;
  await assert.rejects(retryStatisticsBird(async b=>{if(b.action==='release')return {};attempts++;throw Error('Statistics API HTTP '+status);},'synthetic',()=>assert.fail('must not calculate'),{sleep:()=>assert.fail('must not retry')}));
  assert.equal(attempts,1);
 }
});

test('deadline prevents another retry, without suppressing failure',async()=>{
 let claims=0;
 await assert.rejects(retryStatisticsBird(async b=>{if(b.action==='release')return {};claims++;return {};},'synthetic',()=>{throw Error('fetch failed');},{now:()=>100,deadline:15000,sleep:()=>assert.fail('must not wait')}));
 assert.equal(claims,1);
});
