import {seasonProtected} from './bird-lifecycle.mjs';

// Evaluate the live roster inside the transaction, never against a stale client list.
const retained = `( ? = 1 OR (COALESCE(json_extract(payload,'$.recordedDead'),0)=0 AND julianday(json_extract(payload,'$.latestValidFixUtc')) >= julianday(?)))`;
export const releasePortraitsSql = `DELETE FROM bird_portraits WHERE NOT EXISTS (SELECT 1 FROM birds WHERE birds.id=bird_portraits.bird_id AND ${retained})`;
export const allocatePortraitsSql = `
WITH RECURSIVE slots(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM slots WHERE id<64),
available AS (
 SELECT id, (id-1)/8 AS family,
 ROW_NUMBER() OVER (PARTITION BY (id-1)/8 ORDER BY random()) AS family_rank,
 (SELECT COUNT(*) FROM bird_portraits p WHERE (p.portrait_id-1)/8=(slots.id-1)/8) AS occupied
 FROM slots WHERE NOT EXISTS (SELECT 1 FROM bird_portraits p WHERE p.portrait_id=slots.id)
),
ranked_slots AS (SELECT id, ROW_NUMBER() OVER (ORDER BY occupied+family_rank, random()) AS rank FROM available),
new_birds AS (
 SELECT id, ROW_NUMBER() OVER (ORDER BY random()) AS rank FROM birds
 WHERE ${retained} AND NOT EXISTS (SELECT 1 FROM bird_portraits p WHERE p.bird_id=birds.id)
)
INSERT OR IGNORE INTO bird_portraits(bird_id,portrait_id)
SELECT new_birds.id,ranked_slots.id FROM new_birds JOIN ranked_slots USING(rank)`;

export async function assignPortraits(db,birds,now=Date.now()){
 const args=[seasonProtected(now)?1:0,new Date(now-30*86400000).toISOString()];
 // Batch is atomic in D1: simultaneous refreshes cannot share or shuffle portraits.
 await db.batch([db.prepare(releasePortraitsSql).bind(...args),db.prepare(allocatePortraitsSql).bind(...args)]);
 const result=await db.prepare('SELECT bird_id,portrait_id FROM bird_portraits').all();
 const assignments=new Map(result.results.map(r=>[r.bird_id,r.portrait_id]));
 return birds.map(b=>({...b,portraitId:assignments.get(b.id)||null}));
}
