import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRecord,mergeRecords,summarizeRecords} from '../lib/history.mjs';
const event={event_id:'1',timestamp:'2014-06-01 12:00:00',location_long:'10',location_lat:'40',visible:'true',tag_local_identifier:'a',individual_taxon_canonical_name:'Ciconia ciconia'};
test('history accepts old fixes without changing freshness eligibility',()=>{
 const row=historyRecord(event);assert.equal(row[0],'2014-06-01T12:00:00.000Z');assert.equal(row[6],true);
 assert.equal(historyRecord({...event,timestamp:'2099-01-01'}),null);
});
test('overlapping imports are idempotent and source corrections replace by event ID',()=>{
 const original=historyRecord(event),corrected=historyRecord({...event,visible:'false'});
 assert.equal(mergeRecords([original],[original]).length,1);
 const result=mergeRecords([original],[corrected]);assert.equal(result.length,1);assert.equal(summarizeRecords(result).valid,0);
});
test('new fixes accumulate without dropping old history or same-time different events',()=>{
 const a=historyRecord(event),b=historyRecord({...event,event_id:'2'}),c=historyRecord({...event,event_id:'3',timestamp:'2026-01-01'});
 assert.equal(mergeRecords([a],[b,c]).length,3);
});
test('previews are bounded but archived records are not downsampled',()=>{
 const rows=Array.from({length:10000},(_,i)=>historyRecord({...event,event_id:String(i),timestamp:new Date(Date.UTC(2014,5,1,0,0,i)).toISOString()}));
 const summary=summarizeRecords(rows);assert.equal(summary.records,10000);assert.ok(summary.preview.length<=121);assert.equal(summary.last,rows.at(-1)[0]);
});
