import test from 'node:test';
import assert from 'node:assert/strict';
import {retryHistory,temporaryFailure} from '../lib/history-retry.mjs';

test('timeout then server error recover within the same operation',async()=>{
 let attempts=0;const delays=[],reports=[];
 const value=await retryHistory(async()=>{
  attempts++;
  if(attempts===1)throw new DOMException('Timed out','TimeoutError');
  if(attempts===2)throw Error('History storage HTTP 503');
  return 'stored';
 },{sleep:async ms=>{delays.push(ms);},onRetry:report=>reports.push(report)});
 assert.equal(value,'stored');assert.equal(attempts,3);
 assert.deepEqual(delays,[15000,30000]);assert.deepEqual(reports.map(r=>r.attempt),[2,3]);
});
test('persistent temporary failures stop after three attempts',async()=>{
 let attempts=0;
 await assert.rejects(retryHistory(async()=>{attempts++;throw Error('fetch failed');},{sleep:async()=>{}}),/fetch failed/);
 assert.equal(attempts,3);
});
test('access errors, lease conflicts and invalid data are never retried',async()=>{
 for(const message of ['History storage HTTP 401','History storage HTTP 403','History storage HTTP 409','Movebank returned HTTP 429','History access or license changed','Malformed event row']){
  let attempts=0;
  await assert.rejects(retryHistory(async()=>{attempts++;throw Error(message);},{sleep:async()=>assert.fail('must not wait')}));
  assert.equal(attempts,1);
 }
});
test('retry budget respects runner deadline',async()=>{
 let attempts=0;
 await assert.rejects(retryHistory(async()=>{attempts++;throw Error('timeout');},{now:()=>100,deadline:15000,sleep:async()=>assert.fail('must not wait')}));
 assert.equal(attempts,1);
});
test('recognizes gateway timeouts and stream interruptions',()=>{
 for(const message of ['History storage HTTP 522','History storage HTTP 504','terminated','Movebank connection failed: fetch failed'])assert.equal(temporaryFailure(Error(message)),true);
});
