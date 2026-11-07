import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {scheduledJobs,EMAIL_CRON,SYNC_CRON} from '../lib/scheduled-jobs.mjs';
import {nextEmailRetry} from '../lib/email-retry.mjs';
test('minute email schedule never dispatches imports or league maintenance, including shared minutes',async()=>{
 const calls=[],jobs={email:async()=>calls.push('email'),sync:async()=>calls.push('sync'),notifications:async()=>calls.push('notifications')};
 await scheduledJobs({cron:EMAIL_CRON},{},jobs);assert.deepEqual(calls,['email']);calls.length=0;
 await scheduledJobs({cron:SYNC_CRON},{},jobs);assert.deepEqual(calls,['sync','notifications']);
 await assert.rejects(scheduledJobs({cron:'invalid'},{},jobs));
 const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));assert.deepEqual(config.triggers.crons,[SYNC_CRON,EMAIL_CRON]);
});
test('retry backoff fits safe window and honors numeric/date Retry-After',()=>{
 const start=Date.parse('2026-11-07T18:00:00Z');let now=start;
 for(let attempt=1;attempt<6;attempt++)now=nextEmailRetry(now,attempt);
 assert.equal(now-start,11*60000);
 assert.equal(nextEmailRetry(start,1,'120'),start+120000);
 assert.equal(nextEmailRetry(start,1,new Date(start+180000).toUTCString()),start+180000);
 assert.equal(nextEmailRetry(start,1,'nonsense'),start+60000);
 assert.equal(nextEmailRetry(start,1,'1200'),start+1200000);
});
