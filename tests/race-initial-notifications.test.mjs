// Initial-import trigger parity: compare prior trigger to optimized trigger,
// including signals already present on first import and post-season nonfinishers.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {standings,RACE_VERSION} from '../lib/race.mjs';
import {newNotificationAccount,reconcileNotifications} from '../lib/notifications.mjs';
let now;
const day=86400000;
function scenario({label,signal,afterSeason=false,delayedDrain=false}){
 now=Date.parse(afterSeason?'2027-07-05T12:00:00Z':'2027-03-01T12:00:00Z');
 const members=[{id:'a',name:'A'},{id:'b',name:'B'}],picks=Array.from({length:8},(_,i)=>({birdId:'bird-'+i,userId:members[i%2].id,bird:{name:'Bird '+i}}));
 const league={id:'league',name:'Test',year:2027,status:'ready',size:4,owner:'a',members,picks};
 const cases=[false,true].map(optimized=>{const db=new DatabaseSync(':memory:');db.function('unixepoch',()=>Math.floor(now/1000));db.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER)');for(const m of ['0004_race','0008_notification_outbox','0014_race_notification_changes',...(optimized?['0015_race_initial_notifications']:[])])db.exec(readFileSync('drizzle/'+m+'.sql','utf8'));db.prepare('INSERT INTO leagues VALUES(?,?,0)').run('league',JSON.stringify(league));return {db,accounts:Object.fromEntries(members.map((m,i)=>{const a=newNotificationAccount(now-day);a.preferences.race=!!i;a.preferences.leagueRace=!i;a.preferences.email_race=!i;a.preferences.email_leagueRace=!!i;return [m.id,a];})),jobs:0};});
 function drain(){for(const c of cases){for(const row of c.db.prepare('SELECT * FROM notification_outbox ORDER BY id').all()){c.jobs++;const p=JSON.parse(row.payload);p.league.standings=standings(p.league,p.results,row.created_at);for(const m of members)c.accounts[m.id]=reconcileNotifications(c.accounts[m.id],[p.league],m.id,row.created_at);}c.db.exec('DELETE FROM notification_outbox');}assert.deepEqual(cases[1].accounts,cases[0].accounts,label);}
 drain();
 for(let i=0;i<8;i++){
  const arrival=signal==='arrival'&&i===0?{eventId:'a',observedAt:'2027-03-01T08:00:00.000Z',longitude:10,latitude:51,tagId:'tag',qualityVersion:4,support:'repeat-inside',confirmation:{eventId:'b',observedAt:'2027-03-01T09:00:00.000Z',longitude:10,latitude:51,tagId:'tag'}}:null;
  const value={birdId:'bird-'+i,year:2027,version:RACE_VERSION,arrival,migrationStart:signal==='migration'&&i===0?{observedAt:'2027-03-01T08:00:00.000Z',confirmedAt:'2027-03-01T09:00:00.000Z'}:null,migrationStartVersion:2,revision:1,boundaryVersion:'fixture',checkedAt:new Date(now).toISOString(),startedAt:new Date(now).toISOString(),changedAt:new Date(now).toISOString()};
  for(const c of cases)c.db.prepare('INSERT INTO race_results VALUES(?,?,?)').run(value.birdId,2027,JSON.stringify(value));
  if(!delayedDrain)drain();
 }
 drain();
 if(!signal&&!afterSeason)assert.equal(cases[1].jobs,2,'league snapshot plus one neutral initial baseline');
 if(signal==='arrival'){assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Arrival confirmed'));assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Race score updated'&&e.body.includes('8 points')),'last neutral import must unlock points');}
 if(signal==='migration')assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Migration detected'));
 if(afterSeason){now+=4*day;for(const c of cases){const results=c.db.prepare('SELECT payload FROM race_results').all().map(r=>JSON.parse(r.payload));c.db.prepare('INSERT INTO notification_outbox(event_key,created_at,payload) VALUES(?,?,?)').run('settlement',now,JSON.stringify({league,results}));}drain();assert.ok(cases[1].accounts.a.events.some(e=>e.title==='Final results'));}
 for(const c of cases)c.db.close();
 console.log('PASS initial import:',label,cases.map(c=>c.jobs));
}
scenario({label:'neutral sequential'});scenario({label:'neutral delayed background',delayedDrain:true});scenario({label:'arrival first with points awaiting remaining imports',signal:'arrival'});scenario({label:'arrival first with delayed background',signal:'arrival',delayedDrain:true});scenario({label:'migration signal on first import',signal:'migration'});scenario({label:'post-season initial nonfinishers',afterSeason:true});
// Applying the migration must leave preexisting durable work untouched.
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER)');for(const m of ['0004_race','0008_notification_outbox','0014_race_notification_changes'])db.exec(readFileSync('drizzle/'+m+'.sql','utf8'));db.prepare('INSERT INTO notification_outbox(event_key,created_at,payload) VALUES(?,?,?)').run('pending',123,'{}');const before=db.prepare('SELECT * FROM notification_outbox').all();db.exec(readFileSync('drizzle/0015_race_initial_notifications.sql','utf8'));assert.deepEqual(db.prepare('SELECT * FROM notification_outbox').all(),before);db.close();
