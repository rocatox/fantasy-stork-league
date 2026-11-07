// Compare old/new durable trigger behavior through real standings/notification rules.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {standings,RACE_VERSION} from '../lib/race.mjs';
import {reconcileNotifications,newNotificationAccount} from '../lib/notifications.mjs';
let now=Date.parse('2027-03-01T00:00:00Z');const day=86400000;
const league={id:'l',name:'Synthetic',year:2027,status:'ready',size:1,owner:'a',members:[{id:'a',name:'A'},{id:'b',name:'B'}],picks:[{birdId:'bird-a',userId:'a',bird:{name:'A'}},{birdId:'bird-b',userId:'b',bird:{name:'B'}}]};
const cases=[false,true].map(optimized=>{const db=new DatabaseSync(':memory:');db.function('unixepoch',()=>Math.floor(now/1000));db.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER);');for(const m of ['0004_race','0008_notification_outbox',...(optimized?['0014_race_notification_changes','0015_race_initial_notifications']:[])])db.exec(readFileSync('drizzle/'+m+'.sql','utf8'));db.prepare('INSERT INTO leagues VALUES(?,?,0)').run(league.id,JSON.stringify(league));return {db,accounts:Object.fromEntries(league.members.map(m=>{const a=newNotificationAccount(now-day);a.preferences.email_race=true;a.preferences.email_leagueRace=true;return [m.id,a];})),jobs:0};});
function drain(c){for(const r of c.db.prepare('SELECT * FROM notification_outbox ORDER BY id').all()){c.jobs++;const {league:l,results}=JSON.parse(r.payload);l.standings=standings(l,results,r.created_at);for(const m of l.members)c.accounts[m.id]=reconcileNotifications(c.accounts[m.id],[l],m.id,r.created_at);}c.db.exec('DELETE FROM notification_outbox');}
function compare(){for(const c of cases)drain(c);assert.deepEqual(cases[1].accounts,cases[0].accounts);}
compare();const data=new Map();
function commit(id,changes={}){const previous=data.get(id),value={version:RACE_VERSION,year:2027,birdId:id,individualId:id,arrival:null,migrationStart:null,migrationStartVersion:2,boundaryVersion:'fixture',revision:1,changedAt:new Date(now).toISOString(),...previous,...changes,checkedAt:new Date(now).toISOString(),startedAt:changes.startedAt||new Date(now).toISOString()};data.set(id,value);for(const c of cases)c.db.prepare('INSERT INTO race_results VALUES(?,?,?) ON CONFLICT(bird_id,year) DO UPDATE SET payload=excluded.payload').run(id,2027,JSON.stringify(value));compare();}
commit('bird-a');commit('bird-b');
const initial=cases[1].jobs;for(let h=1;h<=6;h++){now+=3600000;commit('bird-a',{eventRows:h});commit('bird-b',{eventRows:h});}assert.equal(cases[1].jobs,initial);
// Arrival while the other bird is stale: notify arrival, then award points on recovery.
now+=4*3600000;const arrival={eventId:'arrival',observedAt:'2027-03-01T08:00:00.000Z',longitude:10,latitude:51,tagId:'t',qualityVersion:4,support:'repeat-inside',confirmation:{eventId:'confirm',observedAt:'2027-03-01T09:00:00.000Z',longitude:10,latitude:51,tagId:'t'}};
commit('bird-a',{arrival,revision:2,changedAt:new Date(now).toISOString()});const beforeRecovery=cases[1].jobs;commit('bird-b');assert.ok(cases[1].jobs>beforeRecovery);
assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Arrival confirmed'));assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Race score updated'));
now+=3600000;commit('bird-b',{migrationStart:{observedAt:'2027-03-01T09:00:00Z',confirmedAt:'2027-03-01T10:00:00Z'}});assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Migration detected'));
now+=3600000;commit('bird-a',{arrival:null,revision:3,changedAt:new Date(now).toISOString()});now+=3600000;commit('bird-a',{arrival,revision:4,changedAt:new Date(now).toISOString()});
// Cover the whole race after its end, then run the same settlement snapshot as the timer.
now=Date.parse('2027-07-01T06:00:00Z');commit('bird-a');commit('bird-b');now+=4*day;
for(const c of cases){const results=c.db.prepare('SELECT payload FROM race_results').all().map(r=>JSON.parse(r.payload));c.db.prepare('INSERT INTO notification_outbox(event_key,created_at,payload) VALUES(?,?,?)').run('settlement',now,JSON.stringify({league,results}));}compare();assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Final results'));
// Correction after finalization must reopen and preserve the same update notifications.
now+=3600000;commit('bird-a',{arrival:null,revision:5,changedAt:new Date(now).toISOString()});
assert.ok(cases[1].jobs<cases[0].jobs);console.log('PASS: old/new trigger notification-state parity for unchanged checks, stale recovery, migration, retraction/restoration, season coverage, final results and post-final correction;',cases.map(c=>c.jobs));for(const c of cases)c.db.close();
