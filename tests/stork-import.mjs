import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE history_state(bird_id TEXT PRIMARY KEY,payload TEXT);');
sql.exec(readFileSync('drizzle/0020_stork_notifications.sql','utf8'));
const db={prepare(q){const s=sql.prepare(q),bound=(a=[])=>({run:async()=>({meta:{changes:Number(s.run(...a).changes)}}),first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)})});return {...bound(),bind:(...a)=>bound(a)};},async batch(rows){sql.exec('BEGIN');try{const out=[];for(const r of rows)out.push(await r.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.storkEnv={DB:db,SYNC_SECRET:'isolated'};
await build({entryPoints:['lib/snapshot-endpoint.ts'],outfile:'.runner/stork-import.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/(replacements|disband)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.storkEnv;':a.path==='./replacements'?'export const refreshReplacements=async()=>{};':'export const disbandExpired=async()=>{};'}));
 b.onLoad({filter:/data[\\/]seed\.json$/},()=>({loader:'json',contents:JSON.stringify({birds:[],studies:[{studyId:'isolated'}]})}));
}}]});
const {POST}=await import('../.runner/stork-import.mjs');
const bird=n=>({id:'isolated:Bird '+n,name:'Bird '+n,studyId:'isolated',individualId:n,latitude:40,longitude:-4,distanceToGermanyMiles:800,latestValidFixUtc:new Date().toISOString(),history:[],currentDeployment:true,recordedDead:false,reviewRequired:false});
async function commit(birds){const lease=crypto.randomUUID(),date=new Date().toISOString();sql.prepare('INSERT OR REPLACE INTO sync_state VALUES (?,?)').run('external-sync-lock',JSON.stringify({lease,studyId:'isolated',expiresAt:Date.now()+60000}));const input={action:'commit',studyId:'isolated',lease,birds,metadata:{individuals:[],deployments:[]},state:{lastSuccessAt:date,lastSuccessSlot:'fixture'},report:{studyId:'isolated',status:'succeeded',startedAt:date,lastSuccessAt:date}};const r=await POST(new Request('https://isolated.test/api/snapshot',{method:'POST',headers:{authorization:'Bearer isolated'},body:JSON.stringify(input)}));assert.equal(r.status,200,await r.text());}
await commit([bird('1')]);assert.equal(sql.prepare('SELECT count(*) n FROM stork_notification_events').get().n,0);
await commit([bird('1'),bird('2'),{...bird('3'),distanceToGermanyMiles:10}]);assert.equal(sql.prepare('SELECT count(*) n FROM stork_notification_events').get().n,2);
await commit([{...bird('1'),recordedDead:true,mortalityDate:'2026-01-01'},bird('2'),bird('3')]);
await commit([{...bird('1'),recordedDead:true,mortalityDate:'2026-01-01'},bird('2'),bird('3')]);
const events=sql.prepare('SELECT payload FROM stork_notification_events').all().map(r=>JSON.parse(r.payload));assert.equal(events.length,3);assert.equal(events.filter(e=>e.title.startsWith('Remembering')).length,1);assert.ok(events.every(e=>e.emailSuppressed));
sql.prepare('DELETE FROM birds WHERE id=?').run('isolated:Bird 2');await commit([bird('2')]);assert.equal(sql.prepare('SELECT count(*) n FROM stork_notification_events').get().n,3,'returning bird remains deduplicated after cleanup');
console.log('Study commit: silent initial import, both discovery types, death transition, duplicate commits and returning birds passed with isolated data.');
