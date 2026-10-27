import test from 'node:test';import assert from 'node:assert/strict';
import {consumeCsv} from '../lib/feed.mjs';
import {syncPolicy,shouldDisband,speciesOf,sameRing} from '../lib/sync-policy.mjs';
test('six-hour slots outside race, hourly Jan 16 through June 30 Eastern',()=>{
 assert.equal(syncPolicy(Date.parse('2027-01-16T04:59:59Z')).intervalHours,6);
 assert.equal(syncPolicy(Date.parse('2027-01-16T05:00:00Z')).intervalHours,1);
 assert.equal(syncPolicy(Date.parse('2027-07-01T03:59:59Z')).intervalHours,1);
 assert.equal(syncPolicy(Date.parse('2027-07-01T04:00:00Z')).intervalHours,6);
 assert.equal(syncPolicy(Date.parse('2026-10-27T10:15:00Z')).slot,syncPolicy(Date.parse('2026-10-27T15:59:00Z')).slot);
 assert.notEqual(syncPolicy(Date.parse('2026-10-27T09:59:59Z')).slot,syncPolicy(Date.parse('2026-10-27T10:00:00Z')).slot);
});
test('unfinished leagues disband exactly at cutoff, completed leagues survive',()=>{const l={year:2027,status:'draft'};assert(!shouldDisband(l,Date.parse('2027-01-16T04:59:59.999Z')));assert(shouldDisband(l,Date.parse('2027-01-16T05:00:00Z')));assert(shouldDisband({...l,status:'lobby'},Date.parse('2027-01-16T05:00:00Z')));assert(!shouldDisband({...l,status:'ready'},Date.parse('2027-01-17T05:00:00Z')));});
test('actual Movebank metadata species column and normalized duplicate rings',()=>{assert.equal(speciesOf({taxon_canonical_name:'Ciconia ciconia'}),'Ciconia ciconia');assert(sameRing('DER ABR25','der abr25'));assert(!sameRing('',''));});
test('streamed CSV handles byte-sized chunks, CRLF, blank lines and embedded quotes/newlines',async()=>{
 const fixture='timestamp,name\r\n\r\n2026,"Bird, ""one"""\r\n2027,"Bird\ntwo"\r\n';const bytes=new TextEncoder().encode(fixture);let i=0;const stream=new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,++i));}});const rows=[];assert.equal(await consumeCsv(stream,r=>rows.push(r)),2);assert.deepEqual(rows,[{timestamp:'2026',name:'Bird, "one"'},{timestamp:'2027',name:'Bird\ntwo'}]);
});
test('HTML and truncated event responses rejected',async()=>{for(const data of ['<html>Permission</html>','timestamp,name\n2026,"bad']){const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(data));c.close();}});await assert.rejects(()=>consumeCsv(stream,()=>{}));}});
test('missing-ring placeholders do not identify duplicate birds',()=>{for(const x of ['no band','NO BAND','no ring','unknown','N/A','none','-',''])assert(!sameRing(x,x));assert(sameRing('DER ABR25','der abr25'));});
