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
test('single inside fix, duplicates, tag changes, large gaps, and inside outlier do not confirm',()=>{
 const a=p(10,51,'2027-03-01T12:00:00Z');
 for(const ps of [[a],[a,a],[a,p(10,51,'2027-03-01T12:02:00Z')],[a,p(10,51,'2027-03-01T12:10:00Z','other')],[a,p(10,51,'2027-03-04T12:00:00Z')],[p(2,51,'2027-03-01T11:00:00Z'),a,p(2,51,'2027-03-01T13:00:00Z')]])assert.equal(confirmedInside(ps,inside),null);
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
