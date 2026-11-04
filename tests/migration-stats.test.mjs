import test from 'node:test';import assert from 'node:assert/strict';
import {migrationMonth,migrationSeasons} from '../lib/migration-stats.mjs';
const row=(at,lon,valid=true)=>[at,'id',lon,50,'tag','true',valid];
const classify=lon=>lon===0?'boundary':lon===10?'inside':'outside';
const month=(name,rows)=>({month:name,migration:migrationMonth(rows,classify,'test')});
test('spring attempts cross month boundaries; invalid fixes and boundary points do not arrive',()=>{
 const stats=migrationSeasons([month('2024-01',[row('2024-01-01',2)]),month('2024-03',[row('2024-03-01',10,false),row('2024-03-02',0),row('2024-03-03',10),row('2024-03-04',10)])]);
 assert.equal(stats.attempts,1);assert.equal(stats.successes,1);assert.equal(stats.seasons[0].arrival,'2024-03-03');
});
test('residents and summer fixes are excluded; missing arrivals stay unconfirmed',()=>{
 const stats=migrationSeasons([month('2023-01',[row('2023-01-01',10),row('2023-01-02',2)]),month('2024-02',[row('2024-02-01',2)]),month('2024-07',[row('2024-07-01',10)])]);
 assert.equal(stats.attempts,1);assert.equal(stats.successes,0);assert.equal(stats.seasons[1].status,'not-confirmed');
});
test('unanalyzed months exclude the whole season from the ratio',()=>{const s=migrationSeasons([month('2024-01',[row('2024-01-01',2)]),{month:'2024-03'}]);assert.equal(s.pendingYears,1);assert.equal(s.attempts,0);});
test('unordered rows retain earliest valid inside date',()=>{const s=migrationMonth([row('2024-03-03',10),row('2024-01-01',2),row('2024-03-02',10)],classify,'test');assert.equal(s.first.position,'outside');assert.equal(s.inside.at,'2024-03-02');});

test('arrival spread uses median absolute calendar-day deviation; insufficient arrivals stay unknown',()=>{
 const season=(year,date)=>({month:year+'-01',migration:{version:4,first:{at:year+'-01-01',position:'outside'},inside:date?{at:year+'-'+date}:null}});
 assert.equal(migrationSeasons([]).arrivalSpreadDays,null);
 assert.equal(migrationSeasons([season('2020','03-01')]).arrivalSpreadDays,null);
 const s=migrationSeasons([season('2020','03-01'),season('2021','03-05'),season('2022','03-09'),season('2023',null)]);
 assert.equal(s.typicalArrival,'03-05');assert.equal(s.arrivalSpreadDays,4);
 const even=migrationSeasons([season('2020','03-01'),season('2021','03-10')]);
 assert.equal(even.typicalArrival,'03-01');assert.equal(even.arrivalSpreadDays,4.5);
 assert.equal(migrationSeasons([season('2020','02-28'),season('2021','03-01')]).arrivalSpreadDays,1);
});

test('confirmed late arrivals through December are recorded without changing race statistics',()=>{
 const stats=migrationSeasons([month('2024-01',[row('2024-01-01',2)]),month('2024-12',[row('2024-12-10',10),row('2024-12-11',10)])]);
 assert.equal(stats.seasons[0].status,'late-arrival');assert.equal(stats.seasons[0].lateArrival,'2024-12-10');assert.equal(stats.seasons[0].arrival,null);assert.equal(stats.successes,0);assert.equal(stats.attempts,1);assert.equal(stats.typicalArrival,'12-10');
});
test('race deadline uses Eastern midnight; July 1 before 04:00 UTC remains on time',()=>{
 const spring=month('2024-01',[row('2024-01-01',2)]);
 const ontime=migrationSeasons([spring,month('2024-07',[row('2024-07-01T03:59:59Z',10),row('2024-07-01T05:00:00Z',10)])]);
 assert.equal(ontime.successes,1);assert.equal(ontime.seasons[0].lateArrival,null);
 const late=migrationSeasons([spring,month('2024-07',[row('2024-07-01T04:00:00Z',10),row('2024-07-01T05:00:00Z',10)])]);
 assert.equal(late.successes,0);assert.equal(late.seasons[0].status,'late-arrival');
});
test('unconfirmed summer fixes and next-year arrivals cannot become late arrivals',()=>{
 const stats=migrationSeasons([month('2024-01',[row('2024-01-01',2)]),month('2024-07',[row('2024-07-01',10)]),month('2025-01',[row('2025-01-01',10),row('2025-01-02',10)])]);
 assert.equal(stats.seasons[0].lateArrival,null);assert.equal(stats.seasons[0].status,'not-confirmed');
});

test('typical date includes late arrivals, but race success counts remain on-time only',()=>{
 const season=(year,date)=>({month:year+'-01',migration:{version:4,first:{at:year+'-01-01',position:'outside'},inside:date?{at:year+'-'+date}:null}});
 const single=migrationSeasons([season('2020','03-11')]);
 assert.equal(single.typicalArrival,'03-11');assert.equal(single.arrivalSpreadDays,null);
 const mixed=migrationSeasons([season('2020','03-11'),season('2021','08-10'),season('2022','09-10'),season('2023',null)]);
 assert.equal(mixed.typicalArrival,'08-10');assert.equal(mixed.successes,1);assert.equal(mixed.attempts,4);
 assert.equal(mixed.arrivalSpreadDays,31);
});
