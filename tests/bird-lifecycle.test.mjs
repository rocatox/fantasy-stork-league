import test from 'node:test';
import assert from 'node:assert/strict';
import {birdStatus,keepBird,seasonProtected} from '../lib/bird-lifecycle.mjs';
import {eligible,DAY} from '../lib/rules.mjs';
import {explorerColor,explorerBirds,RESEARCH_COLOR} from '../lib/map-birds.mjs';
const now=Date.parse('2027-04-01T12:00:00Z');
const bird={id:'test',name:'Test',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:400,countryCode:'FR',currentDeployment:true};
test('eligibility transitions update drafting, map color, and toggle in both directions',()=>{
 const far={...bird,distanceToGermanyMiles:500};
 assert(!eligible(bird,now));assert.equal(explorerColor(bird,now),RESEARCH_COLOR);
 assert(eligible(far,now));assert.notEqual(explorerColor(far,now),RESEARCH_COLOR);
 assert.equal(explorerBirds([far],{now}).length,1);assert.equal(explorerBirds([bird],{now}).length,0);
 for(const b of [{...far,recordedDead:true},{...far,latestValidFixUtc:new Date(now-31*DAY).toISOString()}]){assert(!eligible(b,now));assert.equal(explorerColor(b,now),RESEARCH_COLOR);}
});
test('deceased takes precedence; inactivity is strictly older than 30 observation days',()=>{
 assert.equal(birdStatus({...bird,latestValidFixUtc:new Date(now-30*DAY).toISOString()},now),'active');
 const stale={...bird,latestValidFixUtc:new Date(now-30*DAY-1).toISOString()};
 assert.equal(birdStatus(stale,now),'inactive');assert.equal(birdStatus({...stale,recordedDead:true},now),'deceased');
 assert.equal(birdStatus({...stale,latestValidFixUtc:bird.latestValidFixUtc},now),'active');
});
test('season and grace use exact Eastern boundaries, with offseason deletion',()=>{
 const dead={...bird,recordedDead:true};
 for(const t of ['2027-01-16T04:59:59.999Z','2027-07-31T04:00:00Z','2027-12-31T23:00:00Z']){assert(!seasonProtected(Date.parse(t)));assert(!keepBird(dead,Date.parse(t)));}
 for(const t of ['2027-01-16T05:00:00Z','2027-07-01T04:00:00Z','2027-07-31T03:59:59.999Z']){assert(seasonProtected(Date.parse(t)));assert(keepBird(dead,Date.parse(t)));}
});
