import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueWindow,windowPoints,trailOpacity} from '../lib/league-trails.mjs';
const day=86400000;
test('league window is thirty days off season and expands from Eastern season start',()=>{
 for(const stamp of ['2026-10-29T12:00:00Z','2026-01-16T05:00:00Z','2026-02-01T12:00:00Z','2026-07-01T04:00:00Z']){const now=Date.parse(stamp);assert.equal(leagueWindow(now).start,now-30*day);}
 const now=Date.parse('2026-06-30T22:00:00Z');assert.deepEqual(leagueWindow(now),{start:Date.parse('2026-01-16T05:00:00Z'),end:now});
});
test('window clips crossing legs, excludes old history, and does not interpolate tracking gaps',()=>{
 const start=Date.parse('2026-10-01T00:00:00Z'),end=start+2*day;
 const history=[[1,45,new Date(start-day).toISOString()],[2,46,new Date(start+day).toISOString()],[3,47,new Date(end+day).toISOString()]];
 const result=windowPoints(history,start,end);assert.equal(result.length,3);assert.equal(Date.parse(result[0][2]),start);assert.equal(Date.parse(result.at(-1)[2]),end);assert.ok(result.every(p=>Date.parse(p[2])>=start&&Date.parse(p[2])<=end));
 assert.deepEqual(windowPoints([[1,45,new Date(start-10*day).toISOString()],[2,46,new Date(end+10*day).toISOString()]],start,end),[]);
});
test('fading goes from transparent oldest to opaque latest and clamps',()=>{assert.equal(trailOpacity(100,100,200),0);assert.equal(trailOpacity(150,100,200),.5);assert.equal(trailOpacity(200,100,200),1);assert.equal(trailOpacity(250,100,200),1);});
