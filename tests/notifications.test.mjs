import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newNotificationAccount,reconcileNotifications,notificationResponse} from '../lib/notifications.mjs';
const now=Date.parse('2027-01-10T12:00:00Z');
const league=()=>({id:'l',name:'Flock',year:2027,status:'draft',members:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],picks:[],trades:[],draftStartedAt:new Date(now).toISOString()});
const run=(state,l,time=now)=>reconcileNotifications(state,[l],'a',time);
const items=s=>{const response=notificationResponse(s);return {...response,items:response.items.filter(e=>e.active)};};
test('draft uses actual snake order, deduplicates, and expires old turn prompts',()=>{
 const l=league();let s=run(newNotificationAccount(now),l);assert.equal(items(s).items.length,2);
 s=run(s,l,now+1000);assert.equal(items(s).items.length,2);
 l.picks=[{}];s=run(s,l);assert.equal(items(s).items.filter(x=>x.title==='Your pick').length,0);
 l.picks=[{},{},{}];s=run(s,l);assert.equal(items(s).items.filter(x=>x.title==='Your pick').length,1);
});
test('replacement prompts only during trading, disappear on swap/cutoff, do not flood historical events',()=>{
 const l=league();l.picks=[{userId:'a',birdId:'m',bird:{name:'Mogli'},pickedAt:'today',replacementRequired:{reason:'inactive'}}];
 let s=run(newNotificationAccount(now+1),l);assert.equal(items(s).items.length,0);
 l.status='ready';s=run(s,l);assert.equal(items(s).items[0].title,'Replacement available');
 l.picks=[];s=run(s,l);assert.equal(items(s).items.length,0);
 l.picks=[{userId:'a',birdId:'d',replacementRequired:{reason:'deceased'}}];s=run(s,l);assert.equal(items(s).items.length,1);
 s=run(s,l,Date.parse('2027-01-16T05:00:00Z'));assert.equal(items(s).items.length,0);
});
test('trade resolution retires pending alert, honors ownership and ignores pre-enrollment outcomes',()=>{
 const l=league();l.status='ready';l.trades=[{id:'t',from:'b',to:'a',status:'pending',createdAt:new Date(now-1000).toISOString()}];
 let s=run(newNotificationAccount(now),l);assert.equal(items(s).items[0].title,'Trade proposal');
 l.trades[0].status='accepted';l.trades[0].resolvedAt=new Date(now+1000).toISOString();s=run(s,l,now+1000);assert.deepEqual(items(s).items.map(e=>e.title),['Trade accepted']);
 assert.equal(reconcileNotifications(newNotificationAccount(now),[l],'outsider',now).events.length,0);
 assert.equal(run(newNotificationAccount(now+2000),l,now+2000).events.length,0);
});
test('disabled events stay suppressed when enabled, deadlines deduplicate and expire',()=>{
 const l=league();let s=newNotificationAccount(now);s.preferences.draft=false;s=run(s,l);assert.equal(items(s).unread,0);s.preferences.draft=true;s=run(s,l);assert.equal(items(s).unread,0);
 s=run(s,l,Date.parse('2027-01-16T04:30:00Z'));assert.equal(items(s).items.filter(e=>e.category==='deadlines').length,1);
 s=run(s,l,Date.parse('2027-01-16T05:00:00Z'));assert.equal(items(s).items.filter(e=>e.category==='deadlines').length,0);
});
test('validated standings drive arrivals, corrections, repeated reversals and final results; stale data does not retract arrivals',()=>{
 const l=league();l.status='ready';const time=Date.parse('2027-03-01T00:00:00Z');l.standings={status:'racing',birds:[{userId:'a',birdId:'m',bird:{name:'Mogli'},points:0,arrival:null}],teams:[{userId:'a',rank:1,points:2}]};
 let s=run(newNotificationAccount(now),l,time);assert.equal(items(s).unread,0);
 l.standings.birds[0].arrival={observedAt:'2027-03-01T01:00:00Z'};l.standings.birds[0].points=2;s=run(s,l,time+3600000);assert.equal(items(s).items[0].title,'Arrival confirmed');
 const length=s.events.length;s=run(s,l,time+3601000);assert.equal(s.events.length,length);
 l.standings.dataStale=true;l.standings.birds[0].status='awaiting-data';l.standings.birds[0].arrival=null;s=run(s,l,time+3602000);assert.equal(s.events.length,length);
 l.standings.dataStale=false;l.standings.birds[0].status='racing';l.standings.birds[0].points=0;s=run(s,l,time+3603000);assert.equal(s.events.length,length+1);
 l.standings.birds[0].arrival={observedAt:'2027-03-01T01:00:00Z'};l.standings.birds[0].points=2;s=run(s,l,time+3604000);assert.equal(s.events.length,length+2);
 l.standings.status='complete';s=run(s,l,time+3605000);assert.equal(items(s).items[0].title,'Final results');
 l.status='disbanded';s=run(s,l,time+3606000);assert.equal(items(s).items.length,0);
});
