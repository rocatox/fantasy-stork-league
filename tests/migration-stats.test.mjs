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
