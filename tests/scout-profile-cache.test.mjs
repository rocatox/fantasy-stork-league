import test from 'node:test';
import assert from 'node:assert/strict';
import {createScoutProfileCache,stableScoutOrder} from '../lib/scout-profile-cache.mjs';
const data={years:[],migration:{seasons:[]}};
test('profile cache limits requests, deduplicates and preserves stale data on failure',async()=>{
 let active=0,max=0,calls=0,fail=false;const releases=[];
 const cache=createScoutProfileCache(async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return {ok:!fail,json:async()=>data};});
 const first=cache.load('a','v1');assert.equal(cache.load('a','v1'),first);
 const jobs=[first,...['b','c','d','e'].map(id=>cache.load(id,'v1'))];assert.equal(calls,3);
 while(releases.length){releases.shift()();await new Promise(r=>setImmediate(r));}
 await Promise.all(jobs);assert.equal(max,3);assert.equal(cache.peek('a'),data);await cache.load('a','v1');assert.equal(calls,5);
 fail=true;const refresh=cache.load('a','v2');const rejected=assert.rejects(refresh);releases.shift()();await rejected;assert.equal(cache.peek('a'),data);
 fail=false;const retry=cache.load('a','v2');releases.shift()();await retry;assert.equal(calls,7);
});
test('background rankings preserve order; deliberate sorting resets it; removals and additions are safe',()=>{
 const birds=ids=>ids.map(id=>({id}));let order=stableScoutOrder(null,'name',birds(['a','b']));
 order=stableScoutOrder(order,'name',birds(['b','a','c']));assert.deepEqual(order.ids,['a','b','c']);
 order=stableScoutOrder(order,'arrival',birds(['c','b','a']));assert.deepEqual(order.ids,['c','b','a']);
 order=stableScoutOrder(order,'arrival',birds(['a','d','b']));assert.deepEqual(order.ids,['b','a','d']);
});
