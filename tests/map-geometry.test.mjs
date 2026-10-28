import test from 'node:test';import assert from 'node:assert/strict';
import {mercator,fitCamera,trackPoints,observationIndex,trailPath,replayPosition,trailSegments} from '../lib/map-geometry.mjs';
test('standard Mercator has equal axes at equator, expected latitude distortion, and finite pole clamps',()=>{
 assert.deepEqual(mercator([0,0]),[512,512]);assert.equal(mercator([180,0])[0],1024);
 const east=mercator([.001,0])[0]-512,north=512-mercator([0,.001])[1];assert(Math.abs(east-north)<1e-9);
 assert(Math.abs(mercator([0,60])[1]-297.369232)<.001);
 for(const lat of [-90,90])assert(mercator([0,lat]).every(Number.isFinite));
});
test('camera fits wide and narrow viewports without changing projection aspect',()=>{
 for(const [w,h] of [[800,610],[360,440]]){const pts=[[-25,-35],[60,72]],c=fitCamera(pts,w,h);for(const p of pts){const [x,y]=mercator(p);assert(Math.abs(x-c.x)<w*c.units/2);assert(Math.abs(y-c.y)<h*c.units/2);}}
});
test('timeline sorts full history, rejects invalid points and holds actual observations across gaps',()=>{
 const a=[10,50,'2014-01-01T00:00:00Z'],b=[20,40,'2026-10-27T00:00:00Z'];const pts=trackPoints([b,a,a,[NaN,4,'bad'],[0,100,a[2]]]);assert.deepEqual(pts,[a,b]);
 assert.equal(observationIndex(pts,Date.parse('2020-01-01')),0);assert.equal(observationIndex(pts,Date.parse(b[2])),1);assert.equal(observationIndex([],Date.now()),-1);
 assert.equal((trailPath(pts).match(/M/g)||[]).length,2);assert(!trailPath(pts).includes('L'));
 assert(trailPath([a,[11,51,'2014-01-02T00:00:00Z']]).includes('L'));
});

test('continuous replay interpolates in map space without mutating recorded fixes',()=>{
 const points=[[0,0,'2026-01-01T00:00:00Z'],[10,10,'2026-01-02T00:00:00Z']],original=JSON.stringify(points);
 const t=Date.parse(points[0][2]),mid=replayPosition(points,t+43200000),early=replayPosition(points,t+21600000);
 assert(mid.estimated);assert.equal(mid.gap,false);assert(Math.abs(mid.longitude-5)<1e-9);assert(early.longitude<mid.longitude);
 const end=replayPosition(points,Date.parse(points[1][2]));assert(!end.estimated);assert(Math.abs(end.longitude-10)<1e-9);
 assert.equal(JSON.stringify(points),original);
});
test('replay holds through tracking gaps and never crosses the antimeridian synthetically',()=>{
 const pts=[[0,0,'2026-01-01T00:00:00Z'],[10,10,'2026-02-01T00:00:00Z']];
 const p=replayPosition(pts,Date.parse('2026-01-20'));assert(p.gap);assert(!p.estimated);assert(!p.canInterpolate);assert.equal(p.longitude,0);
 const dateline=replayPosition([[179,0,'2026-01-01T00:00:00Z'],[-179,0,'2026-01-02T00:00:00Z']],Date.parse('2026-01-01T12:00:00Z'));assert(dateline.gap);assert.equal(dateline.longitude,179);
 assert.equal(replayPosition([],Date.now()),null);
});

test('independent trail legs retain repeat routes but omit tracking gaps',()=>{
 const points=[[0,0,'2026-01-01'],[1,1,'2026-01-02'],[0,0,'2026-01-03'],[1,1,'2026-01-04'],[2,2,'2026-02-01']];
 const segments=trailSegments(points);
 assert.deepEqual(segments.map(s=>s.index),[0,1,2]);
 assert.equal(segments[0].path,segments[2].path);
 assert.deepEqual(trailSegments([[179,0,'2026-01-01'],[-179,0,'2026-01-02']]),[]);
});
