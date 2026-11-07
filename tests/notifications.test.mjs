import {applyTrade,cleanTrades} from '../lib/trades.mjs';
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
 l.trades[0].status='accepted';l.trades[0].resolvedAt=new Date(now+1000).toISOString();s=run(s,l,now+1000);assert.deepEqual(items(s).items.map(e=>e.title),[]);assert.ok(reconcileNotifications(newNotificationAccount(now),[l],'b',now+1000).events.some(e=>e.title==='Trade accepted'));
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

test('inbox exposes all retained records beyond 50, with unread totals and storage bounds',()=>{
 const time=Date.now(),state=newNotificationAccount(time);
 state.events=Array.from({length:205},(_,i)=>({id:String(i),category:'draft',createdAt:time-i*1000,read:i<10,active:true}));
 let result=notificationResponse(state);assert.equal(result.items.length,200);assert.equal(result.items.at(-1).id,'199');assert.equal(result.unread,190);
 state.events=state.events.slice(0,37);state.events[11].suppressed=true;state.events[12].createdAt=time-91*86400000;
 result=notificationResponse(state);assert.equal(result.items.length,35);assert.equal(result.unread,25);
 state.preferences.draft=false;assert.equal(notificationResponse(state).items.length,0);
});

test('own/league race toggles cover the requested audiences without duplicate own arrivals',()=>{
 const time=Date.now(),l=league();l.status='ready';l.standings={status:'racing',birds:[{userId:'a',birdId:'own',bird:{name:'Own'},points:0,arrival:null},{userId:'b',birdId:'other',bird:{name:'Other'},points:0,arrival:null}],teams:[{userId:'a',rank:2,points:1}]};
 for(const mine of [false,true])for(const leagueRace of [false,true]){
  l.standings.status='racing';for(const b of l.standings.birds){b.arrival=null;b.points=0;}
  let state=newNotificationAccount(time);state.preferences={...state.preferences,race:mine,leagueRace};state=run(state,l,time);
  for(const b of l.standings.birds){b.arrival={observedAt:'2027-03-01T00:00:00Z'};b.points=1;}
  state=run(state,l,time+1000);let visible=notificationResponse(state).items;
  assert.equal(visible.filter(e=>e.title==='Arrival confirmed').length,(mine||leagueRace?1:0)+(leagueRace?1:0));
  assert.equal(state.events.filter(e=>e.id.includes('race:own:')).length,1);
  assert.ok(state.events.find(e=>e.id.includes('race:other:')).body.includes('Bob’s bird'));
  l.standings.birds[1].points=2;state=run(state,l,time+2000);assert.equal(notificationResponse(state).items.filter(e=>e.title==='Race score updated').length,leagueRace?1:0);
  l.standings.status='complete';state=run(state,l,time+3000);assert.equal(notificationResponse(state).items.filter(e=>e.title==='Final results').length,mine?1:0);
 }
});
test('legacy race opt-outs remain off for both new controls',()=>{
 const state=newNotificationAccount(Date.now());delete state.preferences.leagueRace;state.preferences.race=false;
 assert.equal(notificationResponse(state).preferences.leagueRace,false);
 state.preferences.race=true;assert.equal(notificationResponse(state).preferences.leagueRace,true);
});

test('migration alerts route correctly, deduplicate on retries/corrections, and ignore old confirmations',()=>{
 const time=Date.now(),l=league();l.status='ready';
 for(const mine of [false,true])for(const leagueRace of [false,true]){
  l.standings={status:'racing',birds:[{birdId:'own',userId:'a',points:0},{birdId:'other',userId:'b',points:0}]};
  let state=newNotificationAccount(time);state.preferences={...state.preferences,race:mine,leagueRace};state=run(state,l,time);
  for(const b of l.standings.birds)b.migrationStart={observedAt:new Date(time-3*86400000).toISOString(),confirmedAt:new Date(time+1000).toISOString()};
  state=run(state,l,time+1000);assert.equal(notificationResponse(state).items.filter(e=>e.title==='Migration detected').length,(mine||leagueRace?1:0)+(leagueRace?1:0));
  state=run(state,l,time+2000);assert.equal(state.events.filter(e=>e.title==='Migration detected').length,2);
  for(const b of l.standings.birds)b.migrationStart=null;state=run(state,l,time+3000);
  for(const b of l.standings.birds)b.migrationStart={confirmedAt:new Date(time+4000).toISOString()};state=run(state,l,time+4000);assert.equal(state.events.filter(e=>e.title==='Migration detected').length,2);
 }
 let state=run(newNotificationAccount(time),{...l,standings:{...l.standings,birds:l.standings.birds.map(b=>({...b,migrationStart:null}))}},time);
 l.standings.birds.forEach(b=>b.migrationStart={confirmedAt:new Date(time-1).toISOString()});state=run(state,l,time);assert.equal(state.events.length,0);
});
test('retained final results use My race updates even if stored with the previous league category',()=>{
 const time=Date.now(),state=newNotificationAccount(time);state.events=[{id:'final',title:'Final results',category:'leagueRace',createdAt:time}];
 state.preferences.race=false;assert.equal(notificationResponse(state).items.length,0);
 state.preferences.race=true;state.preferences.leagueRace=false;assert.equal(notificationResponse(state).items.length,1);
});

test('upgrading migration rules or reenabling toggles does not duplicate an already recorded departure',()=>{
 const time=Date.now(),l=league();l.status='ready';l.standings={status:'racing',birds:[{birdId:'own',userId:'a',points:0,migrationStart:null}]};
 let state=run(newNotificationAccount(time),l,time);
 l.standings.birds[0].migrationStart={version:1,confirmedAt:new Date(time+1).toISOString()};state=run(state,l,time+1);
 state.preferences.race=false;state.preferences.leagueRace=false;l.standings.birds[0].migrationStart=null;state=run(state,l,time+2);
 l.standings.birds[0].migrationStart={version:2,confirmedAt:new Date(time+3).toISOString()};state=run(state,l,time+3);
 state.preferences.race=true;state.preferences.leagueRace=true;state=run(state,l,time+4);
 assert.equal(state.events.filter(e=>e.title==='Migration detected').length,1);
});


test('own stage actions stay quiet while other managers and automatic reminders are notified',()=>{
 const l=league();l.owner='a';l.draftStartedBy='a';
 assert.equal(run(newNotificationAccount(now),l).events.length,0);
 assert.ok(reconcileNotifications(newNotificationAccount(now),[l],'b',now).events.some(e=>e.title==='The draft is open'));
 l.picks=[{userId:'a'},{userId:'b'}];
 assert.ok(!reconcileNotifications(newNotificationAccount(now),[l],'b',now).events.some(e=>e.title==='Your pick'));
 l.status='ready';l.draftCompletedBy='b';l.draftCompletedAt=new Date(now).toISOString();
 assert.ok(run(newNotificationAccount(now),l).events.some(e=>e.title==='Trading is open'));
 assert.ok(!reconcileNotifications(newNotificationAccount(now),[l],'b',now).events.some(e=>e.title==='Trading is open'));
 const later=Date.parse('2027-01-16T04:30:00Z');
 assert.ok(reconcileNotifications(newNotificationAccount(now),[l],'b',later).events.some(e=>e.category==='deadlines'));
});

test('trade actors get neither inbox nor email candidates; other parties retain outcomes',()=>{
 for(const [status,actor,reason] of [['accepted','a',''],['declined','a',''],['cancelled','b','Cancelled by proposer'],['cancelled','a','Roster changed or a stork requires replacement'],['cancelled',null,'Trading window closed']]){
  const l=league();l.status='ready';l.trades=[{id:'t',from:'b',to:'a',status,resolvedBy:actor,reason,resolvedAt:new Date(now).toISOString()}];
  for(const user of ['a','b']){const account=newNotificationAccount(now);account.preferences.email_trades=true;const events=reconcileNotifications(account,[l],user,now).events.filter(e=>e.category==='trades');assert.equal(events.length,user===actor?0:1);if(events.length)assert.equal(events[0].emailSuppressed,false);}
 }
});

test('accepted trades and resulting conflicting cancellations persist the same actor',()=>{
 const l=league();l.status='ready';l.picks=[{birdId:'one',userId:'a'},{birdId:'two',userId:'b'}];
 l.trades=['first','conflict'].map(id=>({id,from:'b',to:'a',offer:['two'],request:['one'],status:'pending'}));
 applyTrade(l,'a','acceptTrade',{tradeId:'first'},now);
 assert.deepEqual(l.trades.map(t=>[t.status,t.resolvedBy]),[['accepted','a'],['cancelled','a']]);
 assert.equal(run(newNotificationAccount(now),l).events.length,0);
 assert.equal(reconcileNotifications(newNotificationAccount(now),[l],'b',now).events.length,2);
 const swap=league();swap.status='ready';swap.picks=[];swap.trades=[{id:'swap-conflict',from:'b',to:'a',offer:['two'],request:['one'],status:'pending'}];
 cleanTrades(swap,now,'b');assert.equal(swap.trades[0].resolvedBy,'b');
 assert.equal(reconcileNotifications(newNotificationAccount(now),[swap],'b',now).events.length,0);
 assert.equal(run(newNotificationAccount(now),swap).events.length,1);
});
