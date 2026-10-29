import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {allocatePortraitsSql,releasePortraitsSql} from '../lib/bird-portraits.mjs';
function fixture(n=36){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT)');
 db.exec(readFileSync(new URL('../drizzle/0005_bird_portraits.sql',import.meta.url),'utf8'));
 for(let i=1;i<=n;i++)db.prepare('INSERT INTO birds VALUES(?,?)').run(String(i),JSON.stringify({latestValidFixUtc:'2026-10-28T12:00:00Z',distanceToGermanyMiles:i%2?100:900}));
 return db;
}
function reconcile(db,protectedSeason=0,threshold='2026-09-28T12:00:00Z'){
 db.exec('BEGIN');db.prepare(releasePortraitsSql).run(protectedSeason,threshold);db.prepare(allocatePortraitsSql).run(protectedSeason,threshold);db.exec('COMMIT');
 return db.prepare('SELECT * FROM bird_portraits ORDER BY bird_id').all().map(r=>({...r}));
}
test('eligible and research birds get unique, balanced, persistent portraits',()=>{
 const db=fixture();const first=reconcile(db);
 assert.equal(first.length,36);assert.equal(new Set(first.map(r=>r.portrait_id)).size,36);
 const groups=Array(8).fill(0);first.forEach(r=>groups[Math.floor((r.portrait_id-1)/8)]++);
 assert.ok(Math.max(...groups)-Math.min(...groups)<=1);
 assert.deepEqual(reconcile(db),first);
 db.prepare('INSERT INTO birds VALUES(?,?)').run('new',JSON.stringify({latestValidFixUtc:'2026-10-28T12:00:00Z'}));
 const next=reconcile(db);assert.equal(next.length,37);assert.deepEqual(next.filter(r=>r.bird_id!=='new'),first);
});
test('pool exhaustion never reuses an occupied portrait; departed birds release theirs',()=>{
 const db=fixture(65);const first=reconcile(db);assert.equal(first.length,64);
 const departed=first[0];db.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({recordedDead:true,latestValidFixUtc:'2026-10-28T12:00:00Z'}),departed.bird_id);
 const next=reconcile(db);assert.equal(next.length,64);assert.ok(!next.some(r=>r.bird_id===departed.bird_id));
 assert.deepEqual(next.filter(r=>r.portrait_id!==departed.portrait_id),first.filter(r=>r.bird_id!==departed.bird_id));
});
test('deceased and inactive birds keep portraits through protected season and grace',()=>{
 const db=fixture(2);const first=reconcile(db);
 db.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({recordedDead:true}),'1');
 db.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({latestValidFixUtc:'2026-01-01T00:00:00Z'}),'2');
 assert.deepEqual(reconcile(db,1),first);assert.deepEqual(reconcile(db,0),[]);
 db.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({latestValidFixUtc:'2026-10-28T12:00:00Z'}),'2');
 assert.equal(reconcile(db).length,1);
});
