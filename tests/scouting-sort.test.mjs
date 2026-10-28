import test from 'node:test';import assert from 'node:assert/strict';import {compareBirds} from '../lib/map-birds.mjs';
const birds=['a','b','c','d','e'].map(id=>({id,name:id}));
const ranks={a:{successes:1,attempts:1,pendingYears:0,typicalArrival:null},b:{successes:7,attempts:7,pendingYears:0,typicalArrival:'03-09'},c:{successes:11,attempts:12,pendingYears:0,typicalArrival:'02-26'},d:{successes:0,attempts:0,pendingYears:0},e:{successes:2,attempts:2,pendingYears:1,typicalArrival:'02-01'}};
test('success ranks ratios descending, evidence breaks ties, unknowns last',()=>{assert.deepEqual([...birds].sort((a,b)=>compareBirds(a,b,'success',ranks)).map(b=>b.id),['b','a','c','d','e']);});
test('typical arrival ranks calendar dates earliest first and missing/partial data last',()=>{assert.deepEqual([...birds].sort((a,b)=>compareBirds(a,b,'arrival',ranks)).map(b=>b.id),['c','b','a','d','e']);});
test('no history yields a stable name order',()=>{assert.deepEqual([...birds].reverse().sort((a,b)=>compareBirds(a,b,'success')).map(b=>b.id),['a','b','c','d','e']);});
