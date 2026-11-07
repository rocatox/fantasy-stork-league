import {env} from 'cloudflare:workers';
import {database} from './store';
import {keepBird} from './bird-lifecycle.mjs';
import {migrationSeasons,MIGRATION_STATS_VERSION} from './migration-stats.mjs';
export const rankingKey=(birdId:string)=>'ranking:'+birdId;
export const RANKING_VERSION=1;
export async function invalidateRanking(birdId:string){await database().prepare('DELETE FROM sync_state WHERE id=?').bind(rankingKey(birdId)).run();}
export async function rebuildRanking(birdId:string,lease:string,now=Date.now()){
 const db=database(),stores=(env as any).HISTORY_ARCHIVE?[db,(env as any).HISTORY_ARCHIVE]:[db];
 const sources=await Promise.all(stores.map(store=>store.prepare("SELECT month,json_extract(summary,'$.migration') AS migration FROM history_chunks WHERE bird_id=?").bind(birdId).all()));
 const months=new Map<string,any>();for(const source of sources)for(const row of source.results)months.set(row.month,{month:row.month,migration:JSON.parse(row.migration||'null')});
 const stats=migrationSeasons([...months.values()],now),ranking=Object.fromEntries(['successes','attempts','pendingYears','typicalArrival'].map(k=>[k,stats[k]]));
 const future=[...months.values()].map(m=>Date.parse(m.migration?.inside?.at)).filter(at=>at>now);
 const payload=JSON.stringify({version:RANKING_VERSION,rulesVersion:MIGRATION_STATS_VERSION,computedAt:now,validUntil:future.length?Math.min(...future):null,ranking});
 const result=await db.prepare("INSERT INTO sync_state(id,payload) SELECT ?,? WHERE EXISTS (SELECT 1 FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=? AND json_extract(payload,'$.expiresAt')>=?) AND EXISTS (SELECT 1 FROM birds WHERE id=?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(rankingKey(birdId),payload,'history-lock:'+birdId,lease,Date.now(),birdId).run();
 if(!result.meta.changes)throw Error('Ranking lease expired or bird removed; retry');
 return ranking;
}
export async function savedRankings(now=Date.now()){
 const rows=await database().prepare("SELECT birds.id,json_extract(birds.payload,'$.latestValidFixUtc') AS fix,json_extract(birds.payload,'$.recordedDead') AS dead,sync_state.payload AS ranking FROM birds LEFT JOIN sync_state ON sync_state.id='ranking:'||birds.id").all();
 return Object.fromEntries(rows.results.filter((r:any)=>keepBird({latestValidFixUtc:r.fix,recordedDead:r.dead},now)).map((r:any)=>{const value=r.ranking?JSON.parse(r.ranking):null;return [r.id,value?.version===RANKING_VERSION&&value.rulesVersion===MIGRATION_STATS_VERSION&&(!value.validUntil||now<value.validUntil)?value.ranking:{successes:0,attempts:0,pendingYears:1,typicalArrival:null}];}));
}
