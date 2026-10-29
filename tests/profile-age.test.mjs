import test from 'node:test';
import assert from 'node:assert/strict';
import {profileAge} from '../lib/profile-age.mjs';
test('recorded age takes precedence; tracking duration supplies a conservative lower bound',()=>{
 const now=Date.parse('2026-10-29');
 assert.equal(profileAge({ageYears:8.25},'2020-01-01',now),'8.3 years');
 assert.equal(profileAge({},'2020-01-01',now),'At least 6.8 years');
 assert.equal(profileAge({minimumAgeYears:9},'2020-01-01',now),'At least 9.0 years');
 assert.equal(profileAge({},'2027-01-01',now),'Not recorded');
 assert.equal(profileAge({},'invalid',now),'Not recorded');
 assert.equal(profileAge({},null,now),'Not recorded');
});
