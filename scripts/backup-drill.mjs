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
const config=JSON.parse(fs.readFileSync(process.env.BACKUP_CONFIG||'wrangler.jsonc','utf8'));
const bindings=Object.fromEntries(config.d1_databases.filter(d=>d.binding==='DB'||/^HISTORY_ARCHIVE(?:_[2-8])?$/.test(d.binding)).map(d=>[d.binding==='DB'?'main':d.binding==='HISTORY_ARCHIVE'?'archive':'archive'+d.binding.split('_').at(-1),d.binding]));
const ids=Object.fromEntries(Object.entries(bindings).map(([key,binding])=>[key,config.d1_databases.find(d=>d.binding===binding).database_id]));
const names=Object.keys(ids),archives=names.filter(n=>n!=='main');
if(!ids.main||!archives.length||Number(config.vars?.HISTORY_SHARD_COUNT||archives.length)!==archives.length)throw Error('Incomplete configured archive inventory');
const root=path.resolve('.wrangler/private-backups');
if(!fs.existsSync(root))throw Error('Create an access-restricted private backup directory first.');
execFileSync('git',['check-ignore',root],{stdio:'pipe'});
const resume=process.argv[2];
const dir=resume?path.resolve(resume):path.join(root,new Date().toISOString().replace(/[:.]/g,'-'));
if(!dir.startsWith(root+path.sep))throw Error('Invalid private backup path');
if(!resume)fs.mkdirSync(dir);
if(fs.existsSync(path.join(dir,'report.json')))throw Error('Verified backup already exists; do not overwrite it');
const started=Date.now(),revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sessionConfig=process.env.BACKUP_CF_TOKEN?'':fs.readFileSync(path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'),'utf8');
 let token=process.env.BACKUP_CF_TOKEN||sessionConfig.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if(!token)throw Error('No saved Cloudflare session');
const hash=x=>createHash('sha256').update(x).digest('hex');
const qi=x=>'"'+x.replaceAll('"','""')+'"';
const qs=x=>"'"+x.replaceAll("'","''")+"'";
let requests=0,rowsRead=0;
async function query(db,sql,retried=false,attempt=0){
 if(!/^SELECT\b/i.test(sql))throw Error('Remote SQL must be read-only SELECT');
 let r;
 try{r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${ids[db]}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(60000)});}
 catch(e){if(attempt>=2)throw e;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));return query(db,sql,retried,attempt+1);}
 if((r.status===429||r.status>=500)&&attempt<2){await r.text();await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));return query(db,sql,retried,attempt+1);}
 requests++;
 const body=await r.json();
 if((r.status===401||r.status===403)&&!retried&&!process.env.BACKUP_CF_TOKEN){
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
  // Two small read-only pages in flight; preserve row order and verify a second pass.
  for(const t of meta.tables){
   if(t.name==='sqlite_sequence')put('DELETE FROM sqlite_sequence;\n');
   const keys=await query(db,`SELECT rowid AS rid FROM ${qi(t.name)} ORDER BY rowid`);
   for(let i=0;i<keys.length;i+=16){
    const pages=[];
    for(let j=i;j<Math.min(i+16,keys.length);j+=8){const last=Math.min(j+7,keys.length-1);pages.push(query(db,t.select+` WHERE rowid>=${keys[j].rid} AND rowid<=${keys[last].rid} ORDER BY rowid`));}
    for(const rows of await Promise.all(pages))for(const r of rows){put(r.statement+'\n');count++;}
   }
   console.log(`${db}: ${count} rows captured`);
  }
 }
 for(const s of meta.s.filter(x=>x.type!=='table'))put(s.sql+';\n');
 put('COMMIT;\n');fs.closeSync(fd);
 return {sha256:digest.digest('hex'),rows:count,bytes:fs.statSync(filename).size};
}
const healthBefore=await (await fetch('https://storkleague.fans/api/health')).json();
const schemas=Object.fromEntries(await Promise.all(names.map(async name=>[name,await schema(name)])));
const captures={};
for(const name of archives){
 const file=path.join(dir,name+'.sql');
 if(resume&&fs.existsSync(file)){const text=fs.readFileSync(file,'utf8');if(!text.endsWith('COMMIT;\n'))throw Error('Incomplete archive snapshot; start a new capture');captures[name]={sha256:hash(text),rows:text.split('\n').filter(l=>l.startsWith('INSERT INTO ')).length,bytes:Buffer.byteLength(text)};}
 else captures[name]=await capture(name,schemas[name],file);
}
const mainFile=path.join(dir,'main.sql');if(resume&&fs.existsSync(mainFile))fs.renameSync(mainFile,path.join(dir,'main-incomplete-'+Date.now()+'.sql'));
captures.main=await capture('main',schemas.main,mainFile);
for(const name of archives){
 const second=await capture(name,schemas[name],path.join(dir,name+'-check-'+Date.now()+'.sql'));
 if(captures[name].sha256!==second.sha256)throw Error('Archive changed during capture; not a verified backup');
}
for(const name of names)if(JSON.stringify((await schema(name)).s)!==JSON.stringify(schemas[name].s))throw Error('Schema changed during capture');
// From this point forward no network operations are allowed in the restore drill.
const healthAfter=await (await fetch('https://storkleague.fans/api/health')).json();
globalThis.fetch=async()=>{throw Error('Network forbidden in isolated restore');};
const restored={};const report={revision,capturedAt:new Date(started).toISOString(),capture:captures,bindings,requests,rowsRead,liveHealthBefore:healthBefore.ok,liveHealthAfter:healthAfter.ok,databases:{}};
for(const name of names){
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
if(process.env.BACKUP_RESULT_FILE)fs.writeFileSync(process.env.BACKUP_RESULT_FILE,JSON.stringify({directory:dir}));
console.log(JSON.stringify({directory:dir,...report},null,2));
