import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {migrationSeasons} from '../lib/migration-stats.mjs';
import {historyResponse} from '../lib/history-response.mjs';
const now=Date.parse('2026-11-07T20:00:00Z'),RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
globalThis.fetch=async()=>{throw Error('External requests forbidden');};
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE birds(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE sync_state(id TEXT PRIMARY KEY,payload TEXT);');sql.exec(readFileSync('drizzle/0002_history.sql','utf8'));
const queries=[];const db={prepare(q){const stmt=sql.prepare(q);const bound=(a=[])=>({first:async()=>stmt.get(...a)||null,all:async()=>({results:stmt.all(...a)})});queries.push(q);return {...bound(),bind:(...a)=>bound(a)};}};
globalThis.timelineEnv={DB:db};
await build({entryPoints:['lib/history-endpoint.ts'],outfile:'.runner/timeline-response-endpoint.mjs',bundle:true,format:'esm',platform:'node',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.timelineEnv;',loader:'js'}));}}]});
const {GET}=await import('../.runner/timeline-response-endpoint.mjs');
const bird={id:'fixture',latestValidFixUtc:new Date(now).toISOString()};sql.prepare('INSERT INTO birds VALUES(?,?)').run(bird.id,JSON.stringify(bird));
const months=[];for(let y=2001;y<=2025;y++)for(let m=1;m<=12;m++){
 const month=y+'-'+String(m).padStart(2,'0'),first=month+'-01T12:00:00Z';
 const preview=Array.from({length:121},(_,i)=>[3.12345678+i/10000,44.23456789,first,'event "quoted" \\ 雀 '+i,i%3===0?null:false]);
 const summary={records:100000,valid:99999,first,last:first,preview,migration:{version:4,first:{at:first,position:m<3?'outside':'inside'},inside:m===3?{at:first}:null},sampled:true};
 sql.prepare('INSERT INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?)').run(bird.id,month,'unread-full-resolution-archive',JSON.stringify(summary));months.push({month,...summary});
}
const expected=(year,timeline)=>({migration:migrationSeasons(months),state:null,years:[...new Set(months.map(m=>m.month.slice(0,4)))],records:months.reduce((n,m)=>n+m.records,0),valid:months.reduce((n,m)=>n+m.valid,0),first:months[0].first,last:months.at(-1).last,points:timeline?months.flatMap(m=>m.preview):year?months.filter(m=>m.month.startsWith(year)).flatMap(m=>m.preview):[],months:months.map(({preview,...m})=>m)});
for(const [query,year,timeline] of [['',null,false],['&timeline=1',null,true],['&year=2004','2004',false],['&year=2004&timeline=1','2004',true],['&year=1999','1999',false]]){
 const r=await GET(new Request('https://test/api/history?bird=fixture'+query));assert.equal(r.status,200);assert.deepEqual(await r.json(),expected(year,timeline));
}
const start=Date.parse('2025-11-15'),end=Date.parse('2025-12-15');const window=await GET(new Request(`https://test/api/history?bird=fixture&start=${start}&end=${end}`));assert.deepEqual((await window.json()).points,months.filter(m=>m.month>='2025-10').flatMap(m=>m.preview));
assert.ok(!queries.some(q=>/^SELECT .*\bdata\b.*FROM history_chunks/.test(q)),'Reads must not touch full-resolution BLOBs');
assert.deepEqual(await historyResponse({},[' [] ',null,'null',' [ [1,"\\\"",null] ] ']).json(),{points:[[1,'"',null]]});
assert.throws(()=>historyResponse({},['{"bad":true}']),/Invalid/);
sql.prepare('UPDATE birds SET payload=?').run(JSON.stringify({...bird,recordedDead:true}));assert.equal((await GET(new Request('https://test/api/history?bird=fixture&timeline=1'))).status,404);
const meta=expected(null,false);delete meta.points;const raws=months.map(m=>JSON.stringify(m.preview));
const old=()=>Response.json({...meta,points:raws.flatMap(r=>JSON.parse(r))});const current=()=>historyResponse(meta,raws);
for(let i=0;i<5;i++){await old().arrayBuffer();await current().arrayBuffer();}
const sample=async fn=>{const start=process.cpuUsage();for(let i=0;i<30;i++)await fn().arrayBuffer();const cpu=process.cpuUsage(start);return (cpu.user+cpu.system)/1000/30;};
const result={points:months.length*121,bytes:(await current().arrayBuffer()).byteLength,legacyCpuMs:await sample(old),newCpuMs:await sample(current)};
writeFileSync('.runner/timeline-response-benchmark.json',JSON.stringify(result));console.log('Timeline parity: metadata, all years, single year, window, escapes, lifecycle and unchanged migration statistics passed. '+JSON.stringify(result));
