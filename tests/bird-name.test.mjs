import test from 'node:test';
import assert from 'node:assert/strict';
import {birdName} from '../lib/bird-name.mjs';
import {explorerBirds,compareBirds} from '../lib/map-birds.mjs';
test('display names remove tag metadata but preserve distinguishing place numbers',()=>{
 for(const [raw,expected] of [
 ['Alex 10195 ACW90','Alex'],['Mose XA122 (3994)','Mose'],['Kiki 9696 E0717','Kiki'],
 ['WHST-noband03-Hamburg','Hamburg 3'],['WHST-noband14-Hamburg','Hamburg 14'],
 ['Frensdorf I -3 (AHH07, 14057)','Frensdorf I-3'],['Frensdorf I -2 (AHH06, 14056)','Frensdorf I-2'],
 ['Frensdorf II -1 (AHH08, 14058)','Frensdorf II-1'],['Wingersdorf3 (AEH99, 12176)','Wingersdorf 3'],
 ['Schweizerried 2 / DER AU831 (eobs3984)','Schweizerried 2'],['Walsdorf1-2024 (AHH10, 12182)','Walsdorf 1-2024'],
 ['  Place   003  ','Place 3'],['Mary-Jane','Mary-Jane']]) assert.equal(birdName(raw),expected);
});
test('clean names and original identifiers remain searchable and numbers sort naturally',()=>{
 const a={id:'a',name:'WHST-noband03-Hamburg'},b={id:'b',name:'WHST-noband14-Hamburg'};
 assert.deepEqual(explorerBirds([a,b],{only:false,query:'Hamburg 3'}),[a]);
 assert.deepEqual(explorerBirds([a,b],{only:false,query:'noband03'}),[a]);
 assert.ok(compareBirds(a,b,'name')<0);
 assert.equal(a.name,'WHST-noband03-Hamburg');
});
