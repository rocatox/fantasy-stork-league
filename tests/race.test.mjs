import test from 'node:test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
await build({entryPoints:['lib/geo.ts'],outfile:'.runner/race-simulation-geo.mjs',bundle:true,platform:'node',format:'esm'});
const {germanyPosition}=await import('../.runner/race-simulation-geo.mjs');
const boundaryPoint=JSON.parse(readFileSync('data/germany-vg25.json')).coordinates[0][0][0];
import assert from 'node:assert/strict';
import {standings,reconcileResult,seasonWindow,PROVISIONAL_MS} from '../lib/race.mjs';
import {arrivalCollector} from '../lib/race-observations.mjs';
const year=2027,iso=s=>Date.parse(s),start=seasonWindow(year).start,end=seasonWindow(year).end;
const animal={id:'123',local_identifier:'Bird'};
const deployments=[{individual_id:'123',tag_local_identifier:'tag',deploy_on_timestamp:'2026-01-01T00:00:00Z',deploy_off_timestamp:null}];
const event=(id,time,extra={})=>({event_id:id,timestamp:time,individual_local_identifier:'Bird',individual_taxon_canonical_name:'Ciconia ciconia',tag_local_identifier:'tag',location_long:'10',location_lat:'51',visible:'true',...extra});
const collect=(events,now=end+10*86400000,individual=animal)=>{const c=arrivalCollector({year,individual,deployments,now,classify:germanyPosition});events.forEach(e=>c.add(e));return c.result();};
const league={year,status:'ready',size:2,members:[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'},{id:'cara',name:'Cara'}],picks:[['a','alice'],['b','bob'],['c','cara'],['d','alice'],['e','bob'],['f','cara']].map(([birdId,userId])=>({birdId,userId}))};
const corroborate=events=>events.flatMap(e=>[e,{...e,event_id:e.event_id+'-confirmation',timestamp:new Date(Date.parse(e.timestamp)+10*60000).toISOString()}]);
const result=(birdId,events,at,previous)=>reconcileResult(previous,{birdId,year,boundaryVersion:'fixture',...collect(corroborate(events),at)},at);
export function simulate(){
 const feb=iso('2027-02-02T12:00:00Z'),tie='2027-02-01T10:00:00Z';
 let states=league.picks.map(p=>result(p.birdId,[],feb));
 const update=(id,events,at)=>{states=states.map(s=>s.birdId===id?result(id,events,at,s):s);};
 update('a',[event('a',tie)],feb);update('b',[event('b',tie)],feb);
 let board=standings(league,states,feb);assert.equal(board.birds.find(b=>b.birdId==='a').points,5.5);assert.equal(board.birds.find(b=>b.birdId==='b').rank,1);assert.equal(board.provisional,true);
 const steps=[{stage:'Equal-time arrivals',board}];
 // An earlier observation is uploaded later: use observation time, not receipt time.
 const late=iso('2027-02-05T12:00:00Z');update('c',[event('c','2027-01-28T08:00:00Z')],late);
 board=standings(league,states,late);assert.equal(board.birds[0].birdId,'c');assert.equal(board.birds[0].points,6);assert.equal(board.birds.find(b=>b.birdId==='a').points,4.5);assert.equal(board.provisional,true);steps.push({stage:'Delayed upload takes first place',board});
 // Same source event corrected outside Germany removes that finish, promoting the tie.
 update('c',[event('c','2027-01-28T08:00:00Z',{location_long:'2'})],late+1000);
 board=standings(league,states,late+1000);assert.equal(board.birds.find(b=>b.birdId==='c').points,0);assert.equal(board.birds[0].points,5.5);steps.push({stage:'Source correction retracts arrival',board});
 // Latest legal fix arrives after season closes. Outside/future/hidden fixes do not score.
 const july=iso('2027-07-02T12:00:00Z');
 update('f',[event('last',new Date(end-1).toISOString()),event('late',new Date(end).toISOString())],july);
 update('e',[event('hidden',tie,{visible:'false'}),event('boundary',tie,{location_long:String(boundaryPoint[0]),location_lat:String(boundaryPoint[1])})],july);
 update('d',[event('outside',tie,{location_long:'2'})],july);
 states=states.map(s=>reconcileResult(s,{...s},july));
 board=standings(league,states,july);assert.equal(board.birds.find(b=>b.birdId==='f').points,4);assert.equal(board.birds.find(b=>b.birdId==='d').status,'nonfinisher');assert.equal(board.status,'reconciling');steps.push({stage:'Late June 30 fix; nonfinishers score zero',board});
 const final=iso('2027-07-06T12:00:00Z');board=standings(league,states,final);assert.equal(board.status,'complete');assert.equal(board.provisional,false);assert.deepEqual(board.teams.map(t=>[t.name,t.points,t.rank]),[['Alice',5.5,1],['Bob',5.5,1],['Cara',4,3]]);steps.push({stage:'Settled season',board});
 // Later correction still reopens results rather than silently retaining wrong scores.
 update('a',[event('a',tie,{visible:'false'})],final+1000);board=standings(league,states,final+1000);assert.equal(board.status,'reconciling');assert.equal(board.provisional,true);steps.push({stage:'Post-review correction reopens standings',board});
 return steps;
}

test('simulated season: arrivals, ties, delayed data, corrections, nonfinishers and review window',()=>simulate());
test('season uses Eastern winter/summer offsets and strict end',()=>{assert.equal(start,iso('2027-01-16T05:00:00Z'));assert.equal(end,iso('2027-07-01T04:00:00Z'));assert.equal(collect([event('early',new Date(start-1).toISOString()),event('end',new Date(end).toISOString())]).arrival,null);assert.equal(collect(corroborate([event('start',new Date(start).toISOString())])).arrival.eventId,'start');});
test('invalid, hidden, wrong-tag, dead and future observations do not arrive',()=>{for(const change of [{visible:'false'},{location_lat:''},{location_long:'181'},{tag_local_identifier:'other'},{individual_taxon_canonical_name:'Other'},{timestamp:'2030-01-01'}])assert.equal(collect([event('x','2027-02-01',change)]).arrival,null);assert.equal(collect([event('x','2027-02-01')],end,{...animal,mortality_date:'2027-01-25'}).arrival,null);});
test('duplicate IDs, unordered observations and corrected visibility reconcile deterministically',()=>{const c=collect(corroborate([event('2','2027-03-01'),event('1','2027-02-01'),event('1','2027-02-01',{visible:'false'})]));assert.equal(c.arrival.eventId,'2');});
test('no score for incomplete or disbanded leagues, or before race begins',()=>{for(const status of ['draft','lobby','disbanded'])assert.deepEqual(standings({...league,status},[],end).teams,[]);assert.equal(standings(league,[],start-1).status,'not-started');assert.equal(standings(league,[],end+PROVISIONAL_MS).status,'reconciling');});
test('same bird scores differently in leagues with different drafted pools',()=>{const at=iso('2027-02-02'),states=[result('a',[event('x','2027-02-01')],at)];assert.equal(standings(league,states,at).birds.find(b=>b.birdId==='a').points,6);const small={...league,size:1,members:league.members.slice(0,2),picks:league.picks.slice(0,2)};assert.equal(standings(small,states,at).birds[0].points,2);});

test('a line crossing Germany between two outside fixes is not a recorded arrival',()=>assert.equal(collect([event('west','2027-03-01',{location_long:'2'}),event('east','2027-03-02',{location_long:'20'})]).arrival,null));

test('a scan begun before season end cannot finalize missing arrivals',()=>{
 const states=league.picks.map(p=>({...result(p.birdId,[],end+1),startedAt:new Date(end-1).toISOString()}));
 const board=standings(league,states,end+5*86400000);assert.equal(board.status,'reconciling');assert.equal(board.provisional,true);assert.equal(board.dataPending,true);
});

test('isolated German outlier never scores; fresh arrival waits for independent corroboration',()=>{
 const outside=event('outside','2027-03-01T11:00:00Z',{location_long:'2'}),bad=event('bad','2027-03-01T12:00:00Z'),back=event('back','2027-03-01T13:00:00Z',{location_long:'2'});
 assert.equal(collect([outside,bad,back]).arrival,null);
 const good=event('good','2027-03-10T12:00:00Z');assert.equal(collect([good]).arrival,null);
 const confirmed=collect(corroborate([good]));assert.equal(confirmed.arrival.eventId,'good');assert.equal(confirmed.arrival.confirmation.eventId,'good-confirmation');
 assert.equal(collect([...corroborate([good]),event('good-confirmation','2027-03-10T12:10:00Z',{visible:'false'})]).arrival,null);
});

test('a plausible brief crossing counts, while a near-border jitter stays unsupported',()=>{
 const classifier=(x,y)=>x>=9?'inside':'outside';
 const scan=(margin)=>{const c=arrivalCollector({year,individual:animal,deployments,classify:classifier,interior:()=>margin,now:end});
 c.add(event('before','2027-03-01T12:00:00Z',{location_long:'8.99',location_lat:'50.99'}));c.add(event('inside','2027-03-01T12:05:00Z',{location_long:'9.01',location_lat:'51'}));c.add(event('after','2027-03-01T12:10:00Z',{location_long:'8.99',location_lat:'51.02'}));return c.result();};
 assert.equal(scan(true).arrival.eventId,'inside');assert.equal(scan(true).arrival.support,'surrounding');assert.equal(scan(false).arrival,null);
});
test('late corroboration can support the first season fix after a tracking gap',()=>{
 const c=collect([event('first','2027-03-28T12:00:00Z'),event('later','2027-04-08T12:00:00Z')]);assert.equal(c.arrival.eventId,'first');
});
