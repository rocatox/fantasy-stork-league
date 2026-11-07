import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {EMAIL_URGENT_SQL} from '../lib/email-priority.mjs';
test('send priority is limited to draft turns, proposals, replacements and deadlines',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE events(payload TEXT)');
 for(const [category,title,urgent] of [['draft','Your pick',true],['trades','Trade proposal',true],['replacements','Replacement available',true],['deadlines','Preseason ends within an hour',true],['draft','New manager joined',false],['trades','Trade accepted',false],['race','Final results',false],['race','Arrival confirmed',false],['leagueRace','Migration started',false]]){
  db.exec('DELETE FROM events');db.prepare('INSERT INTO events VALUES(?)').run(JSON.stringify({category,title}));assert.equal(db.prepare('SELECT '+EMAIL_URGENT_SQL+' AS urgent FROM events').get().urgent,Number(urgent),title);
 }db.close();
});
test('queue timestamp is recorded when queued, even for backdated observations; opt-in replays do not restart it',()=>{
 const db=new DatabaseSync(':memory:');let seconds=100000;db.function('unixepoch',()=>seconds);
 db.exec('CREATE TABLE notification_accounts(user_id TEXT PRIMARY KEY,payload TEXT)');db.exec(readFileSync('drizzle/0010_notification_email.sql','utf8'));db.exec(readFileSync('drizzle/0013_email_digest.sql','utf8'));
 const event={id:'old',createdAt:1,emailSuppressed:false,category:'race',title:'Arrival'};
 db.prepare('INSERT INTO notification_accounts VALUES(?,?)').run('u',JSON.stringify({events:[event]}));
 const queued=db.prepare('SELECT queued_at FROM notification_email_queue').get().queued_at;assert.equal(queued,seconds*1000);
 seconds+=60;db.prepare('UPDATE notification_accounts SET payload=?').run(JSON.stringify({events:[event]}));assert.equal(db.prepare('SELECT queued_at FROM notification_email_queue').get().queued_at,queued);
 db.close();
});
