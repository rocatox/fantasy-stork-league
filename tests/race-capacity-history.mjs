// Dense protected-season archive rehearsal: two local SQLite stores, no network.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {encodeHistory,decodeHistory} from '../lib/history-codec.mjs';
import {summarizeRecords,mergeRecords} from '../lib/history.mjs';
globalThis.fetch=async()=>{throw Error('External network forbidden');};
const real=Date,now=Date.parse('2027-07-01T03:59:59Z');globalThis.Date=class extends real{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
const main=new DatabaseSync(':memory:'),archive=new DatabaseSync(':memory:');
main.exec('CREATE TABLE leagues(id TEXT PRIMARY KEY,state TEXT,revision INTEGER DEFAULT 0);CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_runs(id TEXT PRIMARY KEY,payload TEXT);');
for(const m of ['0002_history','0003_history_parts','0005_bird_portraits'])main.exec(readFileSync('drizzle/'+m+'.sql','utf8'));
archive.exec(readFileSync('drizzle-history/0000_archive.sql','utf8'));
let queries=0;const adapter=sql=>({prepare(q){const st=sql.prepare(q),bound=(a=[])=>{a=a.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return {run:async()=>{queries++;return {meta:{changes:Number(st.run(...a).changes)}};},first:async()=>{queries++;return st.get(...a)||null;},all:async()=>{queries++;return {results:st.all(...a)};}};};return {...bound(),bind:(...a)=>bound(a)};},async batch(st){sql.exec('BEGIN');try{const r=[];for(const s of st)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}});
globalThis.denseEnv={DB:adapter(main),HISTORY_ARCHIVE:adapter(archive),SYNC_SECRET:'fixture'};mkdirSync('.runner/race-capacity',{recursive:true});
await build({entryPoints:['lib/history-endpoint.ts'],outfile:'.runner/race-capacity/dense-history.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'isolation',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.denseEnv;',loader:'js'}));}}]});
const {POST}=await import('../.runner/race-capacity/dense-history.mjs');const report=[];
async function post(body){const r=await POST(new Request('https://isolated.test/api/history',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)}));const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
for(const interval of [1,5]){
 const bird={id:`24442409:Dense ${interval}`,name:`Dense ${interval}`,studyId:'24442409',latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:700,currentDeployment:true,recordedDead:false,reviewRequired:false};main.prepare('INSERT INTO birds VALUES(?,?)').run(bird.id,JSON.stringify(bird));const {lease}=await post({action:'claim',birdId:bird.id});const groups=new Map();let i=0;
 for(let t=Date.parse('2027-01-16T05:00:00Z');t<=now;t+=interval*60000){const stamp=new Date(t).toISOString(),month=stamp.slice(0,7),rows=groups.get(month)||[];rows.push([stamp,String(i),(2+i/100000+Math.sin(i)*.0001).toFixed(6),(42+i/200000+Math.cos(i)*.0001).toFixed(6),'tag-synthetic','true',true]);groups.set(month,rows);i++;}
 const months=[];let totalBytes=0;
 for(const [month,rows] of groups){const started=performance.now(),bytes=encodeHistory(rows);totalBytes+=bytes.length;const before=queries;await post({action:'chunk',birdId:bird.id,lease,month,binary:true,data:bytes.toString('base64'),summary:summarizeRecords(rows)});const writeQueries=queries-before;const stored=await post({action:'read',birdId:bird.id,lease,month});assert.deepEqual(decodeHistory(Buffer.from(stored.data,'base64')),rows);months.push({month,records:rows.length,gzipBytes:bytes.length,writeQueries,roundTripMs:performance.now()-started});}
 // Hourly current-month read/merge/rewrite preserves every fix and is repeatable.
 const month='2027-06',rows=groups.get(month),prefix=rows.slice(0,-Math.floor(60/interval)),increment=rows.slice(prefix.length);let current=prefix;
 for(let h=0;h<24;h++){current=mergeRecords(current,increment);const bytes=encodeHistory(current);await post({action:'chunk',birdId:bird.id,lease,month,binary:true,data:bytes.toString('base64'),summary:summarizeRecords(current)});const stored=await post({action:'read',birdId:bird.id,lease,month});assert.deepEqual(decodeHistory(Buffer.from(stored.data,'base64')),rows);}
 assert.equal(archive.prepare('SELECT SUM(json_extract(summary,\'$.records\')) n FROM history_chunks WHERE bird_id=?').get(bird.id).n,i);
 report.push({intervalMinutes:interval,fullResolutionSeasonPoints:i,gzipBytes:totalBytes,months,hourlyReadMergeWriteChecks:24,projectedSeasonPayloadMB:Object.fromEntries([64,100,200].map(n=>[n,totalBytes*n/1e6]))});
}
writeFileSync('.runner/race-capacity/dense-history-result.json',JSON.stringify({report,totalQueries:queries,scope:'Synthetic full-resolution Jan16-Jun30 season; local main/archive SQLite; projections exclude pre-existing history and physical allocation. Five-minute cadence represents a source interval, not sampling protected season data.'},null,2));console.log(JSON.stringify(report.map(({months,...r})=>r)));main.close();archive.close();globalThis.Date=real;
