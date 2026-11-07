// Read-only production capture; restores ONLY to new local SQLite files.
// Run from the repository root. Backups must remain in the private ignored directory.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {decodeHistory} from '../lib/history-codec.mjs';
import {migrationSeasons} from '../lib/migration-stats.mjs';

const account='447b544d13b82f790d35ee40cf9374fd';
const ids={main:'51919e6d-148a-41f6-b836-8ac66dca4f73',archive:'d811283c-1221-43b9-93a3-c39784aab234'};
const root=path.resolve('.wrangler/private-backups');
if(!fs.existsSync(root))throw Error('Create an access-restricted private backup directory first.');
execFileSync('git',['check-ignore',root],{stdio:'pipe'});
const resume=process.argv[2];
const dir=resume?path.resolve(resume):path.join(root,new Date().toISOString().replace(/[:.]/g,'-'));
if(!dir.startsWith(root+path.sep))throw Error('Invalid private backup path');
if(!resume)fs.mkdirSync(dir);
if(fs.existsSync(path.join(dir,'report.json')))throw Error('Verified backup already exists; do not overwrite it');
const started=Date.now(),revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const config=fs.readFileSync(path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'),'utf8');
 let token=config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if(!token)throw Error('No saved Cloudflare session');
const hash=x=>createHash('sha256').update(x).digest('hex');
const qi=x=>'"'+x.replaceAll('"','""')+'"';
const qs=x=>"'"+x.replaceAll("'","''")+"'";
let requests=0,rowsRead=0;
async function query(db,sql,retried=false){
 if(!/^SELECT\b/i.test(sql))throw Error('Remote SQL must be read-only SELECT');
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${ids[db]}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(60000)});
 requests++;
 const body=await r.json();
 if((r.status===401||r.status===403)&&!retried){
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','whoami'],{stdio:'pipe',env:{...process.env,WRANGLER_LOG_PATH:path.join(root,'wrangler-logs')}});
  token=fs.readFileSync(path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'),'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
  return query(db,sql,true);
 }
 if(!r.ok||!body.success||body.result?.some(x=>!x.success)){fs.writeFileSync(path.join(dir,'private-api-error.json'),JSON.stringify(body));throw Error(`Read-only ${db} capture failed (HTTP ${r.status}); diagnostic saved privately`);}
 rowsRead+=body.result.reduce((n,x)=>n+(x.meta?.rows_read||0),0);
 return body.result[0].results;
}
async function schema(db){
 const s=await query(db,"SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name");
 if(s.some(r=>/VIRTUAL TABLE|WITHOUT ROWID/i.test(r.sql)))throw Error('Unsupported schema; review before capture');
 const tables=[];
 const tableDefinitions=s.filter(r=>r.type==='table');
 if(s.some(r=>/AUTOINCREMENT/i.test(r.sql)))tableDefinitions.push({name:'sqlite_sequence'});
 tableDefinitions.sort((a,b)=>a.name.localeCompare(b.name));
 for(const t of tableDefinitions){
  const columns=await query(db,`SELECT name FROM pragma_table_info(${qs(t.name)}) ORDER BY cid`);
  const values=columns.map(c=>{const n=qi(c.name);return `CASE typeof(${n}) WHEN 'text' THEN 'CAST(X'''||hex(${n})||''' AS TEXT)' WHEN 'blob' THEN 'X'''||hex(${n})||'''' ELSE quote(${n}) END`;});
  tables.push({name:t.name,select:`SELECT ${qs(t.name)} AS t,rowid AS rid,${qs('INSERT INTO '+qi(t.name)+'('+columns.map(c=>qi(c.name)).join(',')+') VALUES(')}||${values.join("||','||")}||');' AS statement FROM ${qi(t.name)}`});
 }
 return {s,tables};
}
async function capture(db,meta,filename){
 const fd=fs.openSync(filename,'wx');const digest=createHash('sha256');let count=0;
 const put=s=>{fs.writeSync(fd,s);digest.update(s);};
 put('PRAGMA foreign_keys=OFF;\nBEGIN;\n');
 for(const s of meta.s.filter(x=>x.type==='table'))put(s.sql+';\n');
 if(db==='main'){
  // One SELECT statement captures all application tables at one SQLite read snapshot.
  const [snapshot]=await query(db,'SELECT '+meta.tables.map(t=>`(SELECT json_group_array(statement) FROM (${t.select} ORDER BY rowid)) AS ${qi(t.name)}`).join(','));
  for(const t of meta.tables){if(t.name==='sqlite_sequence')put('DELETE FROM sqlite_sequence;\n');for(const statement of JSON.parse(snapshot[t.name])){put(statement+'\n');count++;}}
 }else{
  // Small bounded reads: no export lock or long-running transaction on production.
  for(const t of meta.tables){let last=-1;if(t.name==='sqlite_sequence')put('DELETE FROM sqlite_sequence;\n');
   for(;;){const rows=await query(db,t.select+` WHERE rowid>${last} ORDER BY rowid LIMIT 16`);
    if(!rows.length)break;
    for(const r of rows){put(r.statement+'\n');count++;last=r.rid;}
    if(count%200===0)console.log(`${db}: ${count} rows captured`);
   }
  }
 }
 for(const s of meta.s.filter(x=>x.type!=='table'))put(s.sql+';\n');
 put('COMMIT;\n');fs.closeSync(fd);
 return {sha256:digest.digest('hex'),rows:count,bytes:fs.statSync(filename).size};
}
const healthBefore=await (await fetch('https://storkleague.fans/api/health')).json();
const schemas={main:await schema('main'),archive:await schema('archive')};
console.log('Capturing archive with bounded read-only queries.');
let first;
if(resume){let text=fs.readFileSync(path.join(dir,'archive.sql'),'utf8');if(!text.endsWith('COMMIT;\n'))throw Error('Incomplete archive cannot resume');
 const seq=schemas.archive.tables.find(t=>t.name==='sqlite_sequence');
 if(seq&&!text.includes('DELETE FROM sqlite_sequence;')){const rows=await query('archive',seq.select+' ORDER BY rowid');text=text.slice(0,-8)+'DELETE FROM sqlite_sequence;\n'+rows.map(r=>r.statement+'\n').join('')+'COMMIT;\n';fs.writeFileSync(path.join(dir,'archive.sql'),text);}
 first={sha256:hash(text),rows:text.split('\n').filter(l=>l.startsWith('INSERT INTO ')).length,bytes:Buffer.byteLength(text)};
 if(fs.existsSync(path.join(dir,'main.sql')))fs.renameSync(path.join(dir,'main.sql'),path.join(dir,'main-incomplete-'+Date.now()+'.sql'));
 if(fs.existsSync(path.join(dir,'archive-check.sql')))fs.renameSync(path.join(dir,'archive-check.sql'),path.join(dir,'archive-check-incomplete-'+Date.now()+'.sql'));
}else first=await capture('archive',schemas.archive,path.join(dir,'archive.sql'));
console.log('Capturing main database in one read snapshot.');
const main=await capture('main',schemas.main,path.join(dir,'main.sql'));
console.log('Re-reading archive to detect concurrent changes.');
const second=await capture('archive',schemas.archive,path.join(dir,'archive-check.sql'));
if(first.sha256!==second.sha256)throw Error('Archive changed during capture. Files retained privately but NOT a verified backup; retry in a quiet interval.');
for(const db of ['main','archive'])if(JSON.stringify((await schema(db)).s)!==JSON.stringify(schemas[db].s))throw Error('Schema changed during capture');
// From this point forward no network operations are allowed in the restore drill.
const healthAfter=await (await fetch('https://storkleague.fans/api/health')).json();
globalThis.fetch=async()=>{throw Error('Network forbidden in isolated restore');};
const restored={};const report={revision,capturedAt:new Date(started).toISOString(),capture:{main,archive:first},requests,rowsRead,liveHealthBefore:healthBefore.ok,liveHealthAfter:healthAfter.ok,databases:{}};
for(const name of ['main','archive']){
 const sql=fs.readFileSync(path.join(dir,name+'.sql'),'utf8');
 const db=new DatabaseSync(path.join(dir,name+'-restored.sqlite'));
 db.exec(sql);restored[name]=db;
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key check failed');
 const tables={};let restoredStatements=[];
 for(const t of schemas[name].tables){const rows=db.prepare(t.select+' ORDER BY rowid').all();tables[t.name]=rows.length;restoredStatements.push(...rows);}
 if(name==='main')restoredStatements.sort((a,b)=>a.t<b.t?-1:a.t>b.t?1:a.rid-b.rid);
 const expected=sql.split('\n').filter(x=>x.startsWith('INSERT INTO '));
 if(hash(expected.join('\n'))!==hash(restoredStatements.map(r=>r.statement).join('\n')))throw Error('Restored contents differ from backup');
 const restoredSchema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all();
 if(JSON.stringify(restoredSchema)!==JSON.stringify(schemas[name].s))throw Error('Restored schema differs');
 report.databases[name]={tables,integrity:'ok',foreignKeys:'ok',allRowsMatch:true,allSchemaMatches:true};
}
let chunks=0,records=0,parts=0;const months=new Map();
for(const db of Object.values(restored))for(const c of db.prepare('SELECT * FROM history_chunks').iterate()){
 let bytes=c.data;
 if(typeof bytes==='string'&&bytes.startsWith('parts:')){
  const [,gen,n]=bytes.split(':');const pieces=db.prepare('SELECT part,data FROM history_parts WHERE bird_id=? AND month=? AND generation=? ORDER BY part').all(c.bird_id,c.month,gen);
  if(pieces.length!==Number(n)||pieces.some((p,i)=>p.part!==i))throw Error('Missing archive part');
  bytes=Buffer.concat(pieces.map(p=>typeof p.data==='string'?Buffer.from(p.data,'base64'):Buffer.from(p.data)));parts+=pieces.length;
 }else bytes=typeof bytes==='string'?Buffer.from(bytes,'base64'):Buffer.from(bytes);
 const rows=decodeHistory(bytes),summary=JSON.parse(c.summary);
 if(rows.length!==summary.records)throw Error('Decoded history record count mismatch');
 chunks++;records+=rows.length;
 if(!months.has(c.bird_id))months.set(c.bird_id,new Map());
 months.get(c.bird_id).set(c.month,{month:c.month,...summary});
}
let rankings=0;
for(const r of restored.main.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'ranking:%'").all()){
 const saved=JSON.parse(r.payload),stats=migrationSeasons([...(months.get(r.id.slice(8))?.values()||[])],started);
 for(const k of ['successes','attempts','pendingYears','typicalArrival'])if(JSON.stringify(saved.ranking[k])!==JSON.stringify(stats[k]))throw Error('Restored ranking does not match reconstructed history');
 rankings++;
}
report.history={chunks,parts,records,rankingsVerified:rankings};
report.elapsedSeconds=Math.round((Date.now()-started)/1000);
report.safety={remoteWrites:0,emailCalls:0,localOnlyRestore:true,archiveTwoPassMatch:true,scheduledHandlersRun:false};
for(const db of Object.values(restored))db.close();
execFileSync('git',['archive','--format=zip','--output='+path.join(dir,'source.zip'),'HEAD']);
fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({directory:dir,...report},null,2));
