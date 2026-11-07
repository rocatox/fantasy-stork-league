// Hosted D1 restore drill. No Worker, routes, triggers, production bindings or email keys.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const account='447b544d13b82f790d35ee40cf9374fd';
const production=new Set(JSON.parse(fs.readFileSync('wrangler.jsonc')).d1_databases.map(d=>d.database_id));
const root=path.resolve('.wrangler/private-backups'),backup=path.resolve(process.argv[2]||''),phase=process.argv[3]||'preflight';
if(!backup.startsWith(root+path.sep)||!fs.existsSync(path.join(backup,'report.json')))throw Error('Verified private backup required');
execFileSync('git',['check-ignore',backup],{stdio:'pipe'});
const backupReport=JSON.parse(fs.readFileSync(path.join(backup,'report.json'))),names=Object.keys(backupReport.capture),archives=names.filter(n=>n!=='main');
const binding=n=>backupReport.bindings?.[n]||(n==='archive'?'HISTORY_ARCHIVE':'HISTORY_ARCHIVE_'+n.slice(7));
const statePath=path.join(backup,'cloud-restore.json');
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)): {createdAt:new Date().toISOString(),targets:{},reads:0,writes:0};
const save=()=>fs.writeFileSync(statePath,JSON.stringify(state,null,2));
const tokenPath=path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml');
const token=()=>fs.readFileSync(tokenPath,'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
async function api(endpoint,method='GET',data,retry=false){
 const response=await fetch('https://api.cloudflare.com/client/v4/'+endpoint,{method,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
 const body=await response.json();
 if([401,403].includes(response.status)&&!retry){execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','whoami'],{stdio:'pipe',env:{...process.env,WRANGLER_LOG_PATH:path.join(root,'wrangler-logs')}});return api(endpoint,method,data,true);}
 if(!response.ok||body.success===false||body.errors?.length||body.result?.some?.(r=>r.success===false)){fs.writeFileSync(path.join(backup,'cloud-error-private.json'),JSON.stringify(body));throw Error(`Cloudflare ${method} failed (${response.status}); diagnostics private`);}
 return body.result??body.data;
}
const base=`accounts/${account}/d1/database`;
async function query(which,queries){
 const target=state.targets[which];if(!target||production.has(target.id)||!target.name.startsWith('fsl-restore-drill-'))throw Error('Test database allowlist check failed');
 if(state.writes>20000||state.reads>150000)throw Error('Drill quota guard reached');
 const result=await api(`${base}/${target.id}/query`,'POST',queries);
 for(const r of result){state.reads+=r.meta?.rows_read||0;state.writes+=r.meta?.rows_written||0;}
 save();return result;
}
const qi=x=>'"'+x.replaceAll('"','""')+'"';
const qs=x=>"'"+x.replaceAll("'","''")+"'";
const schemaSql="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
const sha=x=>createHash('sha256').update(x).digest('hex');
async function preflight(){
 const dbs=await api(base+'?per_page=100');
 const from=new Date().toISOString().slice(0,10)+'T00:00:00Z';
 const metrics=await api('graphql','POST',{query:`query { viewer { accounts(filter:{accountTag:"${account}"}) { d1AnalyticsAdaptiveGroups(limit:100,filter:{datetime_geq:"${from}"}) { sum { rowsRead rowsWritten } } } } }`});
 const groups=metrics.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
 const usage=groups.reduce((a,r)=>({reads:a.reads+r.sum.rowsRead,writes:a.writes+r.sum.rowsWritten}),{reads:0,writes:0});
 const bytes=dbs.reduce((n,d)=>n+(d.file_size||0),0);
 if(dbs.length+names.length>10||bytes>4500000000||usage.reads>3500000||usage.writes>60000)throw Error('Insufficient free-plan headroom; stop before creating test resources');
 state.preflight={at:new Date().toISOString(),databases:dbs.length,bytes,usage};save();console.log(JSON.stringify(state.preflight));
}
function local(which){const file=path.join(backup,`cloud-source-${which}.sqlite`);if(!fs.existsSync(file)){const report=JSON.parse(fs.readFileSync(path.join(backup,'report.json'))),sql=fs.readFileSync(path.join(backup,which+'.sql'),'utf8');if(sha(sql)!==report.capture[which].sha256)throw Error('Backup checksum mismatch');const db=new DatabaseSync(file);db.exec(sql);db.close();}return new DatabaseSync(file,{readOnly:true});}
function tables(db){
 const s=db.prepare(schemaSql).all(),names=s.filter(r=>r.type==='table').map(t=>t.name),ordered=[],visiting=new Set();
 const visit=name=>{if(ordered.includes(name))return;if(visiting.has(name))throw Error('Cyclic foreign keys require a reviewed import strategy');visiting.add(name);for(const fk of db.prepare(`PRAGMA foreign_key_list(${qi(name)})`).all())if(fk.table!==name)visit(fk.table);visiting.delete(name);ordered.push(name);};
 for(const name of names)visit(name);ordered.push('sqlite_sequence');return {schema:s,tables:ordered};
}
if(phase==='preflight'){await preflight();}
else if(phase==='restore'){
 await preflight();
 for(const which of names){
  if(state.targets[which]&&!state.targets[which].deleted)throw Error('Target already exists; verify or clean up before starting another restore');
  const name='fsl-restore-drill-'+Date.now()+'-'+which;
  const created=await api(base,'POST',{name});state.targets[which]={id:created.uuid,name};save();
  const db=local(which),meta=tables(db);
  const test=await query(which,{sql:"SELECT hex(unhex('00FF')) AS decoded"});if(test[0].results[0].decoded!=='00FF')throw Error('BLOB transport unavailable');
  for(const s of meta.schema.filter(r=>r.type==='table'))await query(which,{sql:s.sql});
  let n=0;
  for(const table of meta.tables){
   if(table==='sqlite_sequence')await query(which,{sql:'DELETE FROM sqlite_sequence'});
   const columns=db.prepare(`PRAGMA table_info(${qi(table)})`).all().map(c=>c.name);
   const read=db.prepare('SELECT * FROM '+qi(table)+' ORDER BY rowid');read.setReadBigInts(true);
   let batch=[],bytes=0;
   const flush=async()=>{if(batch.length){const prefix=batch[0].sql.split(' VALUES(')[0];await query(which,{sql:prefix+' VALUES'+batch.map(s=>s.sql.slice(s.sql.indexOf(' VALUES(')+7)).join(','),params:batch.flatMap(s=>s.params)});}batch=[];bytes=0;};
   for(const row of read.iterate()){
    const params=[],values=columns.map(c=>{const v=row[c];if(v===null)return 'NULL';if(v instanceof Uint8Array){params.push(Buffer.from(v).toString('hex'));return 'unhex(?)';}if(typeof v==='bigint'){params.push(v.toString());return 'CAST(? AS INTEGER)';}params.push(v);return '?';});
    const statement={sql:`INSERT INTO ${qi(table)}(${columns.map(qi).join(',')}) VALUES(${values.join(',')})`,params};
    const size=Buffer.byteLength(JSON.stringify(statement));if(bytes+size>3000000||batch.length>=16||batch.reduce((n,s)=>n+s.params.length,0)+params.length>90)await flush();batch.push(statement);bytes+=size;n++;
   }
   await flush();console.log(`${which}: ${n} rows imported`);
  }
  // Install triggers last, preventing import from producing new notifications.
  for(const s of meta.schema.filter(r=>r.type!=='table'))await query(which,{sql:s.sql});
  db.close();state.targets[which].imported=true;save();
 }
 console.log('Hosted import complete; no Worker or email credentials provisioned.');
}
else if(phase==='verify'){
 for(const which of names){
  if(!state.targets[which]?.imported)throw Error('Import incomplete');
  const db=local(which),meta=tables(db);
  const remote=(await query(which,{sql:schemaSql}))[0].results;
  if(JSON.stringify(remote)!==JSON.stringify(meta.schema))throw Error('Hosted schema mismatch');
  const counts={};
  for(const table of meta.tables){
   const columns=db.prepare(`PRAGMA table_info(${qi(table)})`).all().map(c=>c.name);
   const values=columns.map(c=>{const n=qi(c);return `CASE typeof(${n}) WHEN 'text' THEN 'T'||hex(${n}) WHEN 'blob' THEN 'B'||hex(${n}) ELSE quote(${n}) END AS ${n}`;});
   const select=`SELECT rowid AS _backup_rowid,${values.join(',')} FROM ${qi(table)}`;
   const expected=db.prepare(select+' ORDER BY rowid').all();let last=-1,index=0;
   for(;;){const rows=(await query(which,{sql:select+` WHERE rowid>${last} ORDER BY rowid LIMIT 16` }))[0].results;if(!rows.length)break;
    for(const row of rows){last=row._backup_rowid;delete row._backup_rowid;const match=expected[index++];if(!match)throw Error('Extra hosted row');delete match._backup_rowid;if(JSON.stringify(row)!==JSON.stringify(match))throw Error('Hosted contents mismatch');}
   }
   if(index!==expected.length)throw Error('Missing hosted rows');counts[table]=index;
  }
  const integrity=(await query(which,{sql:'PRAGMA quick_check'}))[0].results;
  if(integrity.some(r=>r.quick_check!=='ok'))throw Error('Hosted integrity failure');
  if((await query(which,{sql:'PRAGMA foreign_key_check'}))[0].results.length)throw Error('Hosted foreign-key failure');
  state.targets[which].verified={at:new Date().toISOString(),counts,exactRows:true,exactSchema:true,quickCheck:'ok',foreignKeyCheck:'ok'};save();db.close();console.log(`${which}: every hosted row and schema verified`);
 }
 console.log(JSON.stringify({reads:state.reads,writes:state.writes,verified:true}));
}
else if(phase==='app-check'){
 if(!names.every(k=>state.targets[k]?.verified))throw Error('Verify both hosted databases first');
 const nativeFetch=globalThis.fetch;let blocked=0;
 globalThis.fetch=(url,options)=>{if(!String(url).startsWith('https://api.cloudflare.com/client/v4/')){blocked++;throw Error('Application outbound network forbidden');}return nativeFetch(url,options);};
 const adapter=which=>({prepare(sql){if(!/^SELECT\b/i.test(sql))throw Error('Application check is read-only');const bound=(params=[])=>({all:async()=>({results:(await query(which,{sql,params}))[0].results}),first:async()=>(await query(which,{sql,params}))[0].results[0]||null,run:async()=>{throw Error('Writes forbidden');}});return {...bound(),bind:(...params)=>bound(params)};}});
 globalThis.cloudRestoreEnv={DB:adapter('main'),...Object.fromEntries(archives.map(n=>[binding(n),adapter(n)])),HISTORY_SHARD_COUNT:String(archives.length),EMAIL_ENABLED:'false',SYNC_ENABLED:'false',APP_ORIGIN:'http://restore.invalid'};
 const outfile=path.join(backup,'cloud-app-check.mjs');
 await build({stdin:{contents:"export {GET as history} from './lib/history-endpoint'; export {getBirds} from './lib/store'; export {addStandings} from './lib/standings'; export {deliverEmail,emailConfigured} from './lib/notification-email';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'isolated'}));b.onLoad({filter:/.*/,namespace:'isolated'},()=>({contents:'export const env=globalThis.cloudRestoreEnv',loader:'js'}));}}]});
 const app=await import(pathToFileURL(outfile));
 if(app.emailConfigured()||(await app.deliverEmail()).status!=='not-configured')throw Error('Email isolation failed');
 const birds=await app.getBirds();let profiles=0;
 for(const b of birds){const r=await app.history(new Request('http://restore.invalid/api/history?bird='+encodeURIComponent(b.id)));if(r.status!==200||(await r.json()).records<0)throw Error('Hosted profile check failed');profiles++;}
 const rankings=await (await app.history(new Request('http://restore.invalid/api/history?rankings=1'))).json();
 if(Object.keys(rankings.rankings).length!==birds.length)throw Error('Hosted ranking count mismatch');
 const leagues=(await query('main',{sql:'SELECT state FROM leagues'}))[0].results.map(r=>JSON.parse(r.state));
 const standings=await app.addStandings(leagues);if(standings.length!==leagues.length||standings.some(l=>!l.standings))throw Error('Hosted league read failed');
 state.application={profiles,rankings:Object.keys(rankings.rankings).length,leagues:leagues.length,email:'not-configured',blockedExternalRequests:blocked,runtime:'local app code reading hosted D1 through authenticated API'};save();console.log(JSON.stringify(state.application));
}
else if(phase==='cleanup'){
 for(const [which,t] of Object.entries(state.targets)){
  if(production.has(t.id)||!t.name.startsWith('fsl-restore-drill-'))throw Error('Cleanup target guard failed');
  if(t.deleted)continue;
  const actual=await api(`${base}/${t.id}`);if(actual.name!==t.name)throw Error('Cleanup identity mismatch');
  await api(`${base}/${t.id}`,'DELETE');t.deleted=new Date().toISOString();save();console.log(`${which}: temporary database deleted`);
 }
}else if(phase==='audit'){
 const dbs=await api(base+'?per_page=100');
 if([...production].some(id=>!dbs.some(d=>d.uuid===id)))throw Error('Production inventory check failed');
 if(Object.values(state.targets).some(t=>dbs.some(d=>d.uuid===t.id)))throw Error('Temporary databases still exist');
 const health=await (await fetch('https://storkleague.fans/api/health')).json();
 state.finalAudit={at:new Date().toISOString(),databaseCount:dbs.length,testDatabasesAbsent:true,productionDatabasesPresent:true,liveHealthOK:health.ok,emailConfigured:health.emailConfigured,drillReads:state.reads,drillWrites:state.writes};save();console.log(JSON.stringify(state.finalAudit));
}else throw Error('Unknown phase');
