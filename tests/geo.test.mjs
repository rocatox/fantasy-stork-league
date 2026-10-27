import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
await build({entryPoints:['lib/geo.ts'],outfile:'.runner/geo-test.mjs',bundle:true,platform:'node',format:'esm'});
const {germanyPosition,distanceMiles}=await import('../.runner/geo-test.mjs');
const geometry=JSON.parse(readFileSync('data/germany-vg25.json')),source=JSON.parse(readFileSync('data/boundary-source.json'));
test('pinned unsimplified boundary hash and mainland/islands/exclave/sea checks',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),source.sha256);
 for(const [lon,lat] of [[13.4,52.5],[7.889,54.182],[8.69,47.697],[8.31,54.91]])assert.equal(germanyPosition(lon,lat),'inside');
 for(const [lon,lat] of [[2.35,48.85],[9.4,47.6],[7.9,54.2],[16.37,48.2]])assert.equal(germanyPosition(lon,lat),'outside');
 const vertex=geometry.coordinates[0][0][0];assert.equal(germanyPosition(...vertex),'boundary');assert.equal(distanceMiles(...vertex),0);
});
test('WGS84 distance sanity check and invalid coordinates',()=>{assert.equal(distanceMiles(13.4,52.5),0);const distance=distanceMiles(-3.7,40.4);assert.ok(distance>748&&distance<750);assert.throws(()=>distanceMiles(NaN,40));});
