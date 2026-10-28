import test from 'node:test';import assert from 'node:assert/strict';
import {mercator,fitCamera,trackPoints,observationIndex,trailPath} from '../lib/map-geometry.mjs';
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
