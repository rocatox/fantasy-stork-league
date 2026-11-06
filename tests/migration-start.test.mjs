import {test} from 'node:test';import assert from 'node:assert/strict';
import {migrationStart,validMigrationStart} from '../lib/migration-start.mjs';
const DAY=86400000,start=Date.parse('2027-01-16T05:00:00Z'),end=Date.parse('2027-07-01T04:00:00Z');
function track(latitudes=[35,35,35,35,35,36,37,38,38]){return latitudes.flatMap((lat,i)=>[0,1].map(h=>[-5,lat,new Date(Date.parse('2027-02-01T08:00:00Z')+i*DAY+h*3600000).toISOString(),{tagId:'same',eventId:`${i}-${h}`}]))}
const detect=points=>migrationStart(points,{start,end,now:Date.parse('2027-06-30')});
test('sustained migration requires baseline, three travel days and a further confirmation; no future lookahead',()=>{
 const points=track();for(let n=1;n<points.length;n++)assert.equal(detect(points.slice(0,n)),null);
 const d=detect(points);assert.ok(d);assert.ok(validMigrationStart(d,{start,end},Date.parse('2027-06-30')));assert.equal(d.observedAt,points[10][2]);
 assert.equal(validMigrationStart({...d,confirmedAt:points[10][2]},{start,end}),false);
 assert.equal(migrationStart(points,{start,end:Date.parse(points[10][2])}),null,'No post-arrival start or incomplete confirmation');
 assert.equal(validMigrationStart({...d,evidence:d.evidence.map((x,i)=>i===3?{...x,eventId:d.evidence[0].eventId}:x)},{start,end}),false);
});
test('local roaming, single jump, immediate return, southbound travel and insufficient baseline do not alert',()=>{
 for(const lats of [[35,35,35,35,35,35.3,35.1,35.5,35],[35,35,35,35,35,40,35,35,35],[35,35,35,35,35,36,37,38,35],[35,35,35,35,35,34,33,32,32],[35,36,37,38,38]])assert.equal(detect(track(lats)),null);
});
test('tracking gaps, changed tags, lone daily fixes and future confirmation cannot create migration',()=>{
 const points=track();assert.equal(detect(points.filter((_,i)=>i!==12&&i!==13)),null);
 assert.equal(detect(points.map((p,i)=>i>11?[...p.slice(0,3),{...p[3],tagId:'new'}]:p)),null);
 assert.equal(detect(points.filter((_,i)=>i%2===0)),null);
 assert.equal(migrationStart(points,{start,end,now:Date.parse(points.at(-1)[2])-1}),null);
 const spike=[-5,65,new Date(Date.parse(points[6][2])+1000).toISOString(),{tagId:'same',eventId:'bad'}];assert.ok(detect([...points,spike]));
});
