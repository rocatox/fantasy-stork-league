import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueMapBirds} from '../lib/map-birds.mjs';
const now=Date.parse('2026-11-06T12:00:00Z');
const bird=(id,extra={})=>({id,latestValidFixUtc:'2026-11-05T12:00:00Z',distanceToGermanyMiles:600,countryCode:'ES',currentDeployment:true,...extra});
test('undrafted map pool excludes claimed and ineligible birds, and tracks swaps',()=>{
 const birds=[bird('owned',{distanceToGermanyMiles:100}),bird('free'),bird('near',{distanceToGermanyMiles:400}),bird('dead',{recordedDead:true}),bird('stale',{latestValidFixUtc:'2026-09-01T00:00:00Z'}),bird('review',{reviewRequired:true})];
 const league={picks:[{birdId:'owned',userId:'manager'}]};
 const ids=team=>leagueMapBirds(birds,league,team,now).map(b=>b.id);
 assert.deepEqual(ids('undrafted'),['free']);assert.deepEqual(ids('all'),['owned']);assert.deepEqual(ids('manager'),['owned']);assert.deepEqual(ids('other'),[]);
 league.picks=[{birdId:'free',userId:'manager'}];assert.deepEqual(ids('undrafted'),[]);assert.deepEqual(ids('all'),['free']);
 birds[0].distanceToGermanyMiles=600;assert.deepEqual(ids('undrafted'),['owned']);
});
