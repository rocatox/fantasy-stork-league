import test from 'node:test';import assert from 'node:assert/strict';
import {capacityWarnings,capacityHistory} from '../lib/capacity-policy.mjs';
const sample=(bytes,email={})=>({checkedAt:100*86400000,databases:{history:bytes},email:{dailyUsed:0,rollingUsed:0,...email}});
test('capacity warns before free storage exhaustion, without silently treating missing telemetry as zero',()=>{
 assert.deepEqual(capacityWarnings(sample(138854400)),[]);
 for(const [n,code] of [[350000000,'storage-warning'],[400000000,'storage-expand'],[450000000,'storage-critical'],[null,'size-unavailable']])assert.equal(capacityWarnings(sample(n))[0].code,code);
 assert.equal(capacityWarnings(sample(1,{dailyUsed:72}))[0].code,'email-budget');
 assert.equal(capacityWarnings(sample(1,{oldestPendingAt:98*86400000}))[0].code,'email-backlog');
});
test('capacity retains one sample per UTC day and at most thirty days',()=>{
 let h=[];for(let d=0;d<40;d++)h=capacityHistory(h,{checkedAt:d*86400000});assert.equal(h.length,30);
 h=capacityHistory(h,{checkedAt:39*86400000+100});assert.equal(h.length,30);assert.equal(h.at(-1).checkedAt,39*86400000+100);
});
