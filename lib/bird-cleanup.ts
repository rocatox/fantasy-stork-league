import {refreshReplacements} from './replacements';
import {env} from 'cloudflare:workers';
import {database} from './store';
import {keepBird,birdRecord,rosterMetadata} from './bird-lifecycle.mjs';
// Called by the scheduled history queue even when no GPS import is due.
// Delete the roster row last: interrupted cross-database cleanup is retried.
export async function cleanupBirds(now=Date.now()){
 const db=database(),archive=(env as any).HISTORY_ARCHIVE;
 let birds=(await db.prepare('SELECT payload FROM birds').all()).results.map((r:any)=>JSON.parse(r.payload));
 if(!birds.some((b:any)=>!keepBird(b,now)))return [];
 await refreshReplacements(now);
 const lease=crypto.randomUUID();
 await db.prepare("DELETE FROM sync_state WHERE id='external-sync-lock' AND json_extract(payload,'$.expiresAt')<?").bind(now).run();
 const claim=await db.prepare('INSERT OR IGNORE INTO sync_state(id,payload) VALUES(?,?)').bind('external-sync-lock',JSON.stringify({lease,expiresAt:now+20*60000})).run();
 if(!claim.meta.changes)throw Error('Study sync is running; defer roster cleanup');
 try{
 birds=(await db.prepare('SELECT payload FROM birds').all()).results.map((r:any)=>JSON.parse(r.payload));
 const removed=[];
 // Bound each invocation for the free Worker; remaining birds drain on later runs.
 for(const bird of birds.filter((b:any)=>!keepBird(b,now)).slice(0,3)){
  const lock=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind('history-lock:'+bird.id).first();
  // Let an already-authorized writer finish/expire before deleting either database.
  if(lock&&JSON.parse(lock.payload).expiresAt>=now)continue;
  const leagues=await db.prepare('SELECT id,state FROM leagues').all();
  for(const row of leagues.results){
   const state=JSON.parse(row.state);let changed=false;
   for(const pick of state.picks||[])if(pick.birdId===bird.id&&!pick.bird){pick.bird=birdRecord(bird);changed=true;}
   if(changed){
    const result=await db.prepare('UPDATE leagues SET state=?,revision=revision+1 WHERE id=? AND state=?').bind(JSON.stringify(state),row.id,row.state).run();
    if(!result.meta.changes)throw Error('League changed during bird cleanup; retry required');
   }
  }
  for(const store of archive?[archive,db]:[db])await store.batch(['history_parts','history_chunks'].map(table=>store.prepare(`DELETE FROM ${table} WHERE bird_id=?`).bind(bird.id)));
  await db.batch([
   db.prepare('DELETE FROM history_state WHERE bird_id=?').bind(bird.id),
   db.prepare('DELETE FROM sync_state WHERE id=?').bind('history-lock:'+bird.id),
   ...['race_results','race_audit'].map(table=>db.prepare(`DELETE FROM ${table} WHERE bird_id=? AND NOT EXISTS (SELECT 1 FROM leagues,json_each(leagues.state,'$.picks') p WHERE json_extract(p.value,'$.birdId')=? AND json_extract(leagues.state,'$.year')=${table}.year)`).bind(bird.id,bird.id)),
   db.prepare('DELETE FROM birds WHERE id=? AND payload=?').bind(bird.id,JSON.stringify(bird))
  ]);
  removed.push(bird.id);
 }
 const live=(await db.prepare('SELECT payload FROM birds').all()).results.map((r:any)=>JSON.parse(r.payload));
 const metadata=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'metadata:%'").all();
 for(const row of metadata.results){const value=rosterMetadata(JSON.parse(row.payload),live.filter((b:any)=>b.studyId===row.id.slice(9)));await db.prepare('UPDATE sync_state SET payload=? WHERE id=? AND payload=?').bind(JSON.stringify(value),row.id,row.payload).run();}
 return removed;
 }finally{await db.prepare("DELETE FROM sync_state WHERE id='external-sync-lock' AND json_extract(payload,'$.lease')=?").bind(lease).run();}
}
