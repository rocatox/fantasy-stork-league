import test from 'node:test';
import assert from 'node:assert/strict';
import {publicCached,publicCacheKey} from '../lib/public-cache.mjs';
import {reviewDuplicateRings} from '../lib/roster-review.mjs';
import {sameRing} from '../lib/sync-policy.mjs';
import {visiblePoll} from '../lib/visible-poll.mjs';

test('shared cache admits only public GETs, strips request identity and never stores failures',async()=>{
 const values=new Map(),jobs=[];let loads=0;
 const cache={async match(k){return values.get(k.url)?.clone();},async put(k,r){values.set(k.url,r);}};
 const ctx={waitUntil(p){jobs.push(p);}};
 const req=new Request('https://example.test/api/birds',{headers:{Cookie:'private',Authorization:'Bearer private'}});
 const load=async()=>{loads++;return Response.json({birds:[]},{headers:{'Cache-Control':'no-store'}});};
 assert.equal(publicCacheKey(req).headers.has('Authorization'),false);
 assert.equal((await publicCached(req,load,cache,ctx)).headers.get('X-Public-Cache'),'MISS');await Promise.all(jobs);
 assert.equal((await publicCached(req,load,cache,ctx)).headers.get('X-Public-Cache'),'HIT');assert.equal(loads,1);
 assert.equal(values.values().next().value.headers.get('Cache-Control'),'public, max-age=60');
 for(const route of ['/api/leagues','/api/lists','/api/notifications','/api/history?bird=one'])assert.equal(publicCacheKey(new Request('https://example.test'+route)),null);
 assert.equal(publicCacheKey(new Request(req,{method:'POST'})),null);
 const ranks=new Request('https://example.test/api/history?rankings=1');
 await publicCached(ranks,async()=>Response.json({error:'unavailable'},{status:503}),cache,ctx);
 assert.equal(values.size,1);
 await publicCached(ranks,async()=>Response.json({},{headers:{'Set-Cookie':'private'}}),cache,ctx);assert.equal(values.size,1);
 const broken={match:async()=>{throw Error('cache offline');}};
 assert.equal((await publicCached(ranks,async()=>new Response('',{status:503}),broken,ctx)).status,503);
});

test('linear ring review matches existing normalization and ignores unknown tags',()=>{
 const birds=['aa-12','AA 12','unknown','UNKNOWN','none',null,'001','1','other'].map((ringId,i)=>({id:String(i),ringId}));
 const expected=birds.map(b=>birds.some(o=>o.id!==b.id&&sameRing(o.ringId,b.ringId))?{...b,duplicateRingReview:true,reviewRequired:true}:b);
 assert.deepEqual(reviewDuplicateRings(birds),expected);
});

test('polling pauses hidden tabs, refreshes on return, coalesces focus and avoids overlap',async()=>{
 const doc=new EventTarget(),win=new EventTarget();doc.visibilityState='hidden';let time=0,calls=0,next=0;const timers=new Map();let release;
 const stop=visiblePoll(()=>{calls++;return new Promise(r=>release=r);},{document:doc,window:win,now:()=>time,interval:()=>300000,setTimer:(f,ms)=>{timers.set(++next,{f,ms});return next;},clearTimer:id=>timers.delete(id)});
 assert.equal(calls,0);assert.equal(timers.size,0);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'));assert.equal(calls,1);
 release();await new Promise(r=>setImmediate(r));assert.equal([...timers.values()][0].ms,300000);
 win.dispatchEvent(new Event('focus'));assert.equal(calls,1);
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,0);
 time=5000;doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,2);
 stop();release();await new Promise(r=>setImmediate(r));assert.equal(timers.size,0);
 win.dispatchEvent(new Event('focus'));assert.equal(calls,2);
});
