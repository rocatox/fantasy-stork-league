import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteCode} from '../lib/invite.mjs';
const code='0123456789abcdef0123456789abcdef';
test('accepts trimmed invitation codes and app invite links',()=>{
 assert.equal(inviteCode(' '+code+' '),code);
 assert.equal(inviteCode('https://storkleague.fans/?invite='+code),code);
 assert.equal(inviteCode('https://preview.test/?invite='+code,'https://preview.test'),code);
});
test('rejects malformed or unrelated links without extracting arbitrary input',()=>{
 for(const value of ['', 'hello', 'https://example.com/?invite='+code,'https://storkleague.fans/?invite=no','javascript:alert(1)'])assert.equal(inviteCode(value),null);
});
