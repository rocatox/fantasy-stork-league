import test from 'node:test';
import assert from 'node:assert/strict';
import {profileCache} from '../lib/profile-cache.mjs';
test('profile display cache expires, bounds memory, and never invents authorization',async()=>{
 let now=0,calls=[],fail=false,name='First';
 const read=profileCache(async ids=>{calls.push(ids);if(fail)throw Error('temporary');return new Map(ids.filter(id=>id!=='missing').map(id=>[id,{name,imageUrl:null}]));},{now:()=>now,ttl:60,limit:2});
 assert.equal((await read(['a'])).get('a').name,'First');name='Changed';
 assert.equal((await read(['a'])).get('a').name,'First');assert.equal(calls.length,1);
 assert.deepEqual([...(await read(['b'])).keys()],['b']);
 now=61;assert.equal((await read(['a'])).get('a').name,'Changed');
 await read(['c']);const before=calls.length;await read(['b']);assert.equal(calls.length,before+1);
 fail=true;now=130;await assert.rejects(read(['a']),/temporary/);fail=false;
 assert.equal((await read(['a'])).get('a').name,'Changed');
 assert.equal((await read(['missing'])).get('missing').name,'Player (username pending)');
});
