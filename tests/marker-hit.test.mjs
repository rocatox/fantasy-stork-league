import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestMarker,nearbyMarkers} from '../lib/marker-hit.mjs';
const markers=[{x:10,y:10,bird:{id:'a'}},{x:20,y:10,bird:{id:'b'}}];
test('overlapping tap targets select nearest bird independent of paint order',()=>{
 assert.equal(nearestMarker(markers,11,10,22).id,'a');
 assert.equal(nearestMarker(markers.toReversed(),11,10,22).id,'a');
 assert.equal(nearestMarker(markers,19,10,22).id,'b');
});
test('empty map taps do not select distant birds; exact ties are stable',()=>{
 assert.equal(nearestMarker(markers,100,100,22),null);
 assert.equal(nearestMarker([],0,0,22),null);
 assert.equal(nearestMarker(markers,15,10,22).id,'a');
 assert.equal(nearestMarker(markers.toReversed(),15,10,22).id,'a');
});

test('picker retains every overlapping bird but excludes distant markers',()=>{
 const cluster=[...markers,{x:10,y:10,bird:{id:'c'}},{x:100,y:100,bird:{id:'far'}}];
 assert.deepEqual(nearbyMarkers(cluster,10,10,22).map(b=>b.id),['a','c','b']);
});

 test('smaller mouse targets select separated dots without unnecessary cluster zoom',()=>{
 const dots=[{x:0,y:0,bird:{id:'a'}},{x:15,y:0,bird:{id:'b'}}];
 assert.deepEqual(nearbyMarkers(dots,0,0,10).map(b=>b.id),['a']);
 assert.deepEqual(nearbyMarkers(dots,0,0,22).map(b=>b.id),['a','b']);
 assert.deepEqual(nearbyMarkers(dots,7,0,10).map(b=>b.id),['a','b']);
 });
