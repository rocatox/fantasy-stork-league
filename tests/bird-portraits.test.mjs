import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {allocatePortraitsSql,releasePortraitsSql,assignPortraits,PORTRAIT_COUNT} from '../lib/bird-portraits.mjs';
test('every allocatable portrait has a distinct WebP asset and circular crop metadata',()=>{
 const circles=JSON.parse(readFileSync(new URL('../data/portrait-circles.json',import.meta.url),'utf8'));
 const hashes=new Set();
 for(let id=1;id<=PORTRAIT_COUNT;id++){
  const bytes=readFileSync(new URL(`../public/stork-portraits/stork-${String(id).padStart(2,'0')}.webp`,import.meta.url));
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  hashes.add(createHash('sha256').update(bytes).digest('hex'));
  assert.equal(circles[id].length,3);
 }
 assert.equal(hashes.size,PORTRAIT_COUNT);
});
function fixture(n=36){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT)');
 db.exec(readFileSync(new URL('../drizzle/0005_bird_portraits.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../drizzle/0021_expand_bird_portraits.sql',import.meta.url),'utf8'));
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
 const groups=Array(PORTRAIT_COUNT/8).fill(0);first.forEach(r=>groups[Math.floor((r.portrait_id-1)/8)]++);
 assert.ok(Math.max(...groups)-Math.min(...groups)<=1);
 assert.deepEqual(reconcile(db),first);
 db.prepare('INSERT INTO birds VALUES(?,?)').run('new',JSON.stringify({latestValidFixUtc:'2026-10-28T12:00:00Z'}));
 const next=reconcile(db);assert.equal(next.length,37);assert.deepEqual(next.filter(r=>r.bird_id!=='new'),first);
});
test('pool exhaustion never reuses an occupied portrait; departed birds release theirs',()=>{
 const db=fixture(PORTRAIT_COUNT+1);const first=reconcile(db);assert.equal(first.length,PORTRAIT_COUNT);
 const departed=first[0];db.prepare('UPDATE birds SET payload=? WHERE id=?').run(JSON.stringify({recordedDead:true,latestValidFixUtc:'2026-10-28T12:00:00Z'}),departed.bird_id);
 const next=reconcile(db);assert.equal(next.length,PORTRAIT_COUNT);assert.ok(!next.some(r=>r.bird_id===departed.bird_id));
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

test('normal roster reads skip allocation writes, while changed rosters reconcile',async()=>{
 const sql=fixture(2);reconcile(sql);let batches=0;
 const db={prepare(q){const s=sql.prepare(q);const bind=(args=[])=>({all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})});return {...bind(),bind:(...args)=>bind(args)};},async batch(stmts){batches++;for(const s of stmts)await s.run();}};
 const birds=()=>sql.prepare('SELECT id,payload FROM birds').all().map(r=>({id:r.id,...JSON.parse(r.payload)}));
 const now=Date.parse('2026-10-28T12:00:00Z');
 const first=await assignPortraits(db,birds(),now);assert.equal(batches,0);assert.equal(first.length,2);
 sql.prepare('INSERT INTO birds VALUES(?,?)').run('3',JSON.stringify({latestValidFixUtc:new Date(now).toISOString()}));
 const next=await assignPortraits(db,birds(),now);assert.equal(batches,1);assert.ok(next[2].portraitId);assert.deepEqual(next.slice(0,2),first);
 await assignPortraits(db,birds(),now);assert.equal(batches,1);
});

test('expansion preserves all 64 existing assignments and covers the enlarged roster with reserves',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT)');
 db.exec(readFileSync(new URL('../drizzle/0005_bird_portraits.sql',import.meta.url),'utf8'));
 for(let i=1;i<=204;i++)db.prepare('INSERT INTO birds VALUES(?,?)').run(String(i),JSON.stringify({latestValidFixUtc:'2026-10-28T12:00:00Z'}));
 for(let i=1;i<=64;i++)db.prepare('INSERT INTO bird_portraits VALUES(?,?)').run(String(i),i);
 db.exec(readFileSync(new URL('../drizzle/0021_expand_bird_portraits.sql',import.meta.url),'utf8'));
 const rows=reconcile(db);
 assert.equal(rows.length,204);assert.equal(new Set(rows.map(r=>r.portrait_id)).size,204);
 for(let i=1;i<=64;i++)assert.equal(rows.find(r=>r.bird_id===String(i)).portrait_id,i);
 assert.equal(PORTRAIT_COUNT-rows.length,52);
 assert.throws(()=>db.prepare('INSERT INTO bird_portraits VALUES(?,?)').run('overflow',PORTRAIT_COUNT+1));
 assert.throws(()=>db.prepare('INSERT INTO bird_portraits VALUES(?,?)').run('duplicate',1));
});
