import test from 'node:test';
import assert from 'node:assert/strict';
import {trackPoints,trailSegments,replayPosition} from '../lib/map-geometry.mjs';
const cases=[
 [[35.5935827,33.0703397,'2026-09-10T17:00:04Z'],[-51.4738931,29.7324978,'2026-09-11T03:27:31Z'],[35.4105168,32.8271142,'2026-09-11T07:55:08Z']],
 [[10.969397,50.6765561,'2026-04-17T12:15:29Z'],[37.084047,45.4518792,'2026-04-17T16:45:10Z'],[10.9694535,50.6765688,'2026-04-18T03:15:09Z']]
];
test('reported Hamburg and Frensdorf outliers do not enter visual trails; source remains intact',()=>{
 for(const points of cases){const original=JSON.stringify(points);assert.deepEqual(trackPoints(points),[points[0],points[2]]);assert.equal(JSON.stringify(points),original);}
});
test('uncertain endpoint jumps break drawing and playback, instead of inventing a route',()=>{
 const points=cases[0].slice(0,2);assert.equal(trackPoints(points).length,2);assert.equal(trailSegments(points).length,0);const replay=replayPosition(points,Date.parse(points[0][2])+3600000);assert.equal(replay.gap,true);assert.equal(replay.canInterpolate,false);
});
test('ordinary migration detours, small GPS jitter and long gaps remain represented',()=>{
 const points=[[10,50,'2026-04-01T00:00:00Z'],[11,49,'2026-04-01T06:00:00Z'],[10,50,'2026-04-01T12:00:00Z']];assert.deepEqual(trackPoints(points),points);
 const jitter=[[10,50,'2026-04-01T00:00:00Z'],[10.0001,50,'2026-04-01T00:00:00Z']];assert.equal(trackPoints(jitter).length,2);
 const gap=[points[0],[37,45,'2026-05-01T00:00:00Z']];assert.equal(trackPoints(gap).length,2);assert.equal(trailSegments(gap).length,0);
});

test('newly synced history is screened after cache refresh, including newly discovered birds',async()=>{
 const {createTimelineCache}=await import('../lib/timeline-cache.mjs');
 let now=0,revision=0;
 const source=cases[0];
 const load=createTimelineCache(async()=>({ok:true,json:async()=>({points:revision?source:[source[0],source[2]]})}),()=>now);
 assert.equal(trackPoints((await load('existing')).points).length,2);
 revision=1;now=600001;
 const updated=await load('existing');assert.equal(updated.points.length,3);assert.deepEqual(trackPoints(updated.points),[source[0],source[2]]);
 const discovered=await load('new-bird');assert.deepEqual(trackPoints(discovered.points),[source[0],source[2]]);
});
