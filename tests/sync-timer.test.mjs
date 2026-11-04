import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timerDecision} from '../lib/sync-timer.mjs';
import {syncPolicy} from '../lib/sync-policy.mjs';
const now=Date.parse('2026-11-04T17:10:00Z'),slot=syncPolicy(now).slot;
const sources=['10449318','212096177','173641633','864730855','4809963363','21231406','24442409','76367850'].map(studyId=>({studyId,lastSuccessSlot:slot}));
const base={now,slot,sources,state:{lastAcceptedAt:'2026-11-04T16:00:00Z'},runs:[]};
test('skip current sources; bootstrap a new timer once',()=>{assert.equal(timerDecision(base),'current');assert.equal(timerDecision({...base,state:{}}),'dispatch');});
test('one overdue study is enough to dispatch',()=>assert.equal(timerDecision({...base,sources:sources.slice(1)}),'dispatch'));
test('queued and active workflows prevent duplicate dispatches',()=>{for(const status of ['queued','in_progress','waiting','requested'])assert.equal(timerDecision({...base,runs:[{status}]}),'running');});
test('ambiguous dispatch is rate limited and capped per slot',()=>{assert.equal(timerDecision({...base,state:{lastDispatchAt:new Date(now-1000).toISOString()}}),'cooldown');assert.equal(timerDecision({...base,sources:[],state:{slot,attempts:3}}),'retry-limit');assert.equal(timerDecision({...base,sources:[],state:{slot:'older',attempts:3}}),'dispatch');});
test('retry history failure even when position imports succeeded, but not an older failure',()=>{const failed={status:'completed',conclusion:'failure',created_at:new Date(now-60000).toISOString()};assert.equal(timerDecision({...base,runs:[failed]}),'dispatch');assert.equal(timerDecision({...base,runs:[{...failed,created_at:'2026-11-03T12:00:00Z'}]}),'current');});
test('seasonal slots remain hourly in season and six-hourly outside it',()=>{assert.equal(syncPolicy(Date.parse('2027-01-16T14:00:00Z')).intervalHours,1);assert.equal(syncPolicy(now).intervalHours,6);});

import {DatabaseSync} from 'node:sqlite';
import {runSyncTimer} from '../lib/sync-timer.mjs';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');const db={prepare(q){return {bind(...args){return {run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),first:async()=>sql.prepare(q).get(...args)}},all:async()=>({results:sql.prepare(q).all()})}}};return {sql,env:{DB:db,SYNC_ENABLED:'true',GITHUB_SYNC_TOKEN:'github_pat_test_only'}};}
test('timer persists accepted dispatch, safely skips overlapping invocation and cooldown',async()=>{const {sql,env}=fixture();let sends=0;const fetcher=async(url,options)=>{if(options.method==='POST'){sends++;assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{timer_triggered:true}});return new Response(null,{status:204});}return Response.json({workflow_runs:[]});};const results=await Promise.all([runSyncTimer(env,{now,fetcher}),runSyncTimer(env,{now,fetcher})]);assert.equal(sends,1);assert.ok(results.some(r=>r.status==='locked'));assert.equal((await runSyncTimer(env,{now:now+60000,fetcher})).status,'cooldown');sql.close();});
test('missing token leaves a diagnostic without dispatching',async()=>{const {sql,env}=fixture();delete env.GITHUB_SYNC_TOKEN;assert.equal((await runSyncTimer(env,{now,fetcher:()=>{throw Error('must not fetch')}})).status,'token-required');sql.close();});
test('GitHub rejection is recorded and the lease released without retaining token',async()=>{const {sql,env}=fixture();await assert.rejects(runSyncTimer(env,{now,fetcher:async()=>new Response(null,{status:401})}),/github-http-401/);const payload=sql.prepare('SELECT payload FROM sync_state').get().payload;assert.equal(JSON.parse(payload).leaseUntil,0);assert.ok(!payload.includes(env.GITHUB_SYNC_TOKEN));sql.close();});

test('trim terminal newline from secret before building Authorization header',async()=>{const {sql,env}=fixture();env.GITHUB_SYNC_TOKEN+='\r\n';let header;await runSyncTimer(env,{now,fetcher:async(_url,options)=>{header=options.headers.Authorization;return options.method==='POST'?new Response(null,{status:204}):Response.json({workflow_runs:[]});}});assert.equal(header,'Bearer github_pat_test_only');sql.close();});

test('redirects are not followed and are recorded as failures',async()=>{const {sql,env}=fixture();await assert.rejects(runSyncTimer(env,{now,fetcher:async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://different.example/'}});}}),/github-http-302/);assert.equal(JSON.parse(sql.prepare('SELECT payload FROM sync_state').get().payload).failureStage,'list-runs');sql.close();});
