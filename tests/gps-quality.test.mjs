import test from 'node:test';import assert from 'node:assert/strict';
import {trackPoints} from '../lib/map-geometry.mjs';
import {confirmedInside} from '../lib/gps-quality.mjs';
import {migrationMonth} from '../lib/migration-stats.mjs';
const p=(lon,lat,at,tag='tag')=>[lon,lat,at,{tagId:tag}];
const inside=x=>x>=9&&x<=11?'inside':'outside';
test('sparse Frensdorf return spikes below the speed ceiling are excluded',()=>{
 const cases=[[[13.2630668,52.3209183,'2025-07-04T14:45:10Z'],[5.4538239,51.8570083,'2025-07-04T19:30:14Z'],[13.1923673,52.2984511,'2025-07-05T06:15:31Z']],
 [[-3.615322,40.3145639,'2026-02-09T19:45:08Z'],[-10.4998226,40.0213167,'2026-02-10T06:00:13Z'],[-3.5964893,40.3094194,'2026-02-10T10:15:10Z']],
 [[-5.3266483,35.5674186,'2025-02-01T02:15:31Z'],[-9.2311471,37.2187215,'2025-02-01T06:30:13Z'],[-5.4820058,35.614215,'2025-02-01T10:45:31Z']]];
 for(const ps of cases)assert.deepEqual(trackPoints(ps),[ps[0],ps[2]]);
});
test('single inside fix, duplicates, tag changes, and inside outlier do not confirm',()=>{
 const a=p(10,51,'2027-03-01T12:00:00Z');
 for(const ps of [[a],[a,a],[a,p(10,51,'2027-03-01T12:10:00Z','other')],[p(2,51,'2027-03-01T11:00:00Z'),a,p(2,51,'2027-03-01T13:00:00Z')]])assert.equal(confirmedInside(ps,inside),null);
});
test('corroboration preserves original arrival time, requires continuous inside evidence',()=>{
 const a=p(10,51,'2027-03-01T12:00:00Z'),b=p(10.01,51,'2027-03-01T12:10:00Z');
 assert.equal(confirmedInside([b,a],inside).point,a);
 assert.equal(confirmedInside([p(10.999,51,'2027-03-01T12:00:00Z'),p(11.001,51,'2027-03-01T12:05:00Z'),p(10.999,51,'2027-03-01T12:10:00Z')],inside),null);
});
test('migration statistics screen source fixes and support confirmation across month boundaries',()=>{
 const row=(lon,at)=>[at,at,lon,51,'tag','true',true];
 const bad=[row(2,'2027-03-01T11:00:00Z'),row(10,'2027-03-01T12:00:00Z'),row(2,'2027-03-01T13:00:00Z')];
 assert.equal(migrationMonth(bad,inside,'test').inside,null);
 const a=row(10,'2027-03-31T23:59:00Z'),b=row(10.01,'2027-04-01T00:09:00Z');
 assert.equal(migrationMonth([a],inside,'test',[b]).inside.at,a[0]);
 assert.equal(migrationMonth([a],inside,'test').inside,null);
});

test('a burst of repeated bad inside coordinates cannot corroborate itself',()=>{
 const points=[p(2,51,'2027-03-01T11:00:00Z'),p(10,51,'2027-03-01T12:00:00Z'),p(10,51,'2027-03-01T12:10:00Z'),p(10,51,'2027-03-01T12:20:00Z'),p(10,51,'2027-03-01T12:30:00Z'),p(2,51,'2027-03-01T13:00:00Z')];
 assert.equal(confirmedInside(points,inside),null);assert.deepEqual(trackPoints(points),[points[0],points[5]]);
});

test('sparse repeat observations preserve the original date across long gaps',()=>{
 for(const date of ['2027-03-30T12:00:01Z','2027-04-08T12:00:00Z']){
  const a=p(10,51,'2027-03-28T12:00:00Z'),b=p(10.01,51,date),e=confirmedInside([a,b],inside);
  assert.equal(e.point,a);assert.equal(e.support,'repeat-inside');
 }
});
test('brief crossing needs plausible bracketing observations and sufficient border clearance',()=>{
 const points=[p(8.99,50.99,'2027-03-01T12:00:00Z'),p(9.01,51,'2027-03-01T12:05:00Z'),p(8.99,51.02,'2027-03-01T12:10:00Z')];
 const e=confirmedInside(points,inside,undefined,undefined,()=>true);assert.equal(e.point,points[1]);assert.equal(e.before,points[0]);assert.equal(e.support,'surrounding');
 assert.equal(confirmedInside(points,inside,undefined,undefined,()=>false),null);
 assert.equal(confirmedInside([points[1],points[2]],inside,undefined,undefined,()=>true),null);
 assert.equal(confirmedInside([points[0],points[1],p(8.99,51.02,'2027-03-02T12:00:00Z')],inside,undefined,undefined,()=>true),null);
});
test('historical confirmation spans month boundaries without a 48-hour cutoff',()=>{
 const row=(at,lon)=>[at,at,lon,51,'tag','true',true];
 const a=row('2027-03-24T12:00:00Z',10),b=row('2027-04-04T12:00:00Z',10.01);
 assert.equal(migrationMonth([a],inside,'test',[b]).inside.at,a[0]);
});
