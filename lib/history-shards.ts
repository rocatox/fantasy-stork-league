import {env} from 'cloudflare:workers';
import {database} from './store';

export function archiveEntries():{key:string,store:any}[]{
 const config:any=env,entries=[{key:'main',store:database()}];
 if(config.HISTORY_ARCHIVE)entries.push({key:'history',store:config.HISTORY_ARCHIVE});
 for(let n=2;n<=8;n++)if(config['HISTORY_ARCHIVE_'+n])entries.push({key:'history'+n,store:config['HISTORY_ARCHIVE_'+n]});
 const count=Number(config.HISTORY_SHARD_COUNT||0);
 if(config.HISTORY_SHARD_COUNT!==undefined&&(!Number.isInteger(count)||count<1||count>8||entries.length!==count+1))throw Error('Configured history shard binding missing');
 return entries;
}
export const archiveStores=()=>archiveEntries().map(e=>e.store);
export const shardedHistory=()=>archiveEntries().length>2;
async function routes(birdId:string){
 if(!shardedHistory())return new Map<string,string>();
 const rows=await database().prepare('SELECT month,shard FROM history_shard_routes WHERE bird_id=?').bind(birdId).all();
 const result=new Map<string,string>(rows.results.map((r:any)=>[r.month,r.shard]));
 const keys=new Set(archiveEntries().map(e=>e.key));
 if([...result.values()].some(key=>!keys.has(key)))throw Error('Required history shard is not configured');
 return result;
}
// Routed chunks win; legacy-main fallback remains readable until verified pruning.
export async function historyRows(birdId:string,columns:string,suffix='',params:any[]=[]){
 const entries=archiveEntries(),assigned=await routes(birdId);
 const sources=await Promise.all(entries.map(e=>e.store.prepare(`SELECT month,${columns} FROM history_chunks WHERE bird_id=? ${suffix}`).bind(birdId,...params).all()));
 const merged=new Map<string,any>();
 for(let i=0;i<entries.length;i++)for(const row of sources[i].results){
  const old=merged.get(row.month);if(old&&old.key===assigned.get(row.month))continue;
  merged.set(row.month,{key:entries[i].key,row});
 }
 return [...merged.values()].map(x=>x.row).sort((a,b)=>a.month.localeCompare(b.month));
}
export async function archiveRow(birdId:string,month:string,summaryOnly=false){
 const entries=archiveEntries(),assigned=(await routes(birdId)).get(month);
 const ordered=[...entries].reverse().sort((a,b)=>Number(b.key===assigned)-Number(a.key===assigned));
 for(const {store} of ordered){const row=await store.prepare(`SELECT ${summaryOnly?'summary':'data'} FROM history_chunks WHERE bird_id=? AND month=?`).bind(birdId,month).first();if(row)return {row,store};}
 return {row:null,store:entries.at(-1)!.store};
}
export async function archiveWriteStore(birdId:string,month:string,lease:string){
 const entries=archiveEntries(),shards=entries.slice(1);
 if(!shardedHistory())return (shards[0]||entries[0]).store;
 const assigned=(await routes(birdId)).get(month);
 if(assigned)return entries.find(e=>e.key===assigned)!.store;
 let chosen:any;
 // Existing monthly chunks stay put, including full-resolution race months.
 for(const entry of [...shards].reverse())if(await entry.store.prepare('SELECT 1 AS found FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,month).first()){chosen=entry;break;}
 if(!chosen){
  const sizes=await Promise.all(shards.map(async e=>{const r=await e.store.prepare('SELECT 1').run();return {...e,bytes:Number(r.meta?.size_after)};}));
  chosen=sizes.filter(e=>Number.isFinite(e.bytes)&&e.bytes>0&&e.bytes<400000000).sort((a,b)=>a.bytes-b.bytes||a.key.localeCompare(b.key))[0];
  if(!chosen)throw Error('No free archive headroom; existing history retained');
 }
 await database().prepare("INSERT OR IGNORE INTO history_shard_routes(bird_id,month,shard) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=? AND json_extract(payload,'$.expiresAt')>=?)").bind(birdId,month,chosen.key,'history-lock:'+birdId,lease,Date.now()).run();
 const saved=(await routes(birdId)).get(month);
 if(!saved)throw Error('History route lease expired');
 return entries.find(e=>e.key===saved)!.store;
}
export async function checkArchiveHeadroom(store:any){
 if(!shardedHistory())return;
 const r=await store.prepare('SELECT 1').run(),bytes=Number(r.meta?.size_after);
 if(!Number.isFinite(bytes)||bytes<=0||bytes>=450000000)throw Error('Archive headroom unavailable; existing history retained');
}
