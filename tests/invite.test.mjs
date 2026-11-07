import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteCode,newInviteCode} from '../lib/invite.mjs';
test('six digits preserve leading zeros and trim surrounding whitespace',()=>{assert.equal(inviteCode(' 012345 '),'012345');for(const v of ['12345','1234567','abcdef','https://storkleague.fans/?invite=123456','0123456789abcdef0123456789abcdef'])assert.equal(inviteCode(v),null);});
test('generated codes always have six decimal digits',()=>{for(let i=0;i<1000;i++)assert.match(newInviteCode(),/^\d{6}$/);});
