import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storkImportEvents,mergeStorkEvents} from '../lib/stork-notifications.mjs';
import {newNotificationAccount,emailNotificationEnabled,notificationResponse} from '../lib/notifications.mjs';
const now=Date.parse('2026-11-10T15:00:00Z');
const bird=(n,extra={})=>({id:'study:'+n,studyId:'study',individualId:n,name:'Stork '+n,recordedDead:false,...extra});
test('initial study baseline is silent; later discoveries include nearby research birds',()=>{
 const initial=storkImportEvents([], [bird('1'),bird('2')],[],false,now);assert.equal(initial.events.length,0);
 const next=storkImportEvents([bird('1'),bird('2')],[bird('1'),bird('2'),bird('3',{distanceToGermanyMiles:10}),bird('4',{distanceToGermanyMiles:900})],initial.seen,true,now);
 assert.equal(next.events.length,2);assert.ok(next.events.every(e=>e.category==='storks'&&e.emailSuppressed));
 assert.equal(storkImportEvents([], [bird('3')],next.seen,true,now).events.length,0,'returning birds are not discoveries');
 assert.equal(storkImportEvents([bird('1')],[bird('1',{name:'Renamed'})],[],true,now).events.length,0);
});
test('death is a transition, not inactivity, and uses only a known source mortality date',()=>{
 const previous=[bird('1')];
 const events=storkImportEvents(previous,[bird('1',{recordedDead:true,mortalityDate:'2026-11-02 00:00:00.000'})],[],true,now).events;
 assert.equal(events[0].body,'On November 2, 2026, Stork 1 passed away. May we keep them in our hearts.');
 assert.equal(storkImportEvents([bird('1',{recordedDead:true})],[bird('1',{recordedDead:true})],[],true,now).events.length,0);
 assert.equal(storkImportEvents(previous,[bird('1',{latestValidFixUtc:'2020-01-01'})],[],true,now).events.length,0);
 assert.match(storkImportEvents(previous,[bird('1',{recordedDead:true})],[],true,now).events[0].body,/We learned that/);
 assert.equal(storkImportEvents([], [bird('1',{recordedDead:true})],[],true,now).events.length,0);
 assert.equal(emailNotificationEnabled({email_storks:true},events[0]),false);
});
test('closed-app events merge once, respect opt-out, and preserve read state',()=>{
 const event=storkImportEvents([], [bird('1')],[],true,now).events[0],rows=[{id:1,payload:JSON.stringify(event)}];
 let state=mergeStorkEvents(newNotificationAccount(now-1000),rows,now);
 assert.equal(notificationResponse(state).unread,1);state.events[0].read=true;
 state=mergeStorkEvents(state,rows,now);assert.equal(state.events.length,1);assert.equal(state.events[0].read,true);assert.equal(state.storkCursor,1);
 const optedOut=newNotificationAccount(now-1000);optedOut.preferences.storks=false;
 const hidden=mergeStorkEvents(optedOut,rows,now);hidden.preferences.storks=true;assert.equal(notificationResponse(hidden).items.length,0);
 assert.equal(mergeStorkEvents(newNotificationAccount(now+1),rows,now+1).events.length,0,'no pre-account backlog');
});
