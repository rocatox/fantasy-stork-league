// Mock every external call and capture command. No live credentials or databases.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fsl-backup-flow-'));
const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'});
const preload=`
import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';
const root=path.resolve('.wrangler/private-backups');let restored=false,uploaded=Buffer.alloc(0),verified=false,deletes=0,uploadCalls=0;
cp.execFileSync=(cmd,args,opts)=>{
 if(args[0]==='scripts/backup-drill.mjs'){const d=path.join(root,'fixture');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(opts.env.BACKUP_RESULT_FILE,JSON.stringify({directory:d}));fs.writeFileSync(path.join(d,'report.json'),JSON.stringify({capturedAt:'2026-11-07T09:38:00.000Z',revision:'synthetic',capture:{main:{},archive:{},archive2:{}},databases:{main:{allRowsMatch:true,allSchemaMatches:true}},safety:{archiveTwoPassMatch:true}}));}
 else if(args[0]==='scripts/restore-smoke.mjs'){restored=true;}
 else if(cmd==='tar'){assert.ok(restored);fs.writeFileSync(args[1],Buffer.alloc(5000000,42));}
 else throw Error('Unexpected subprocess');
};syncBuiltinESMExports();
const j=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
globalThis.fetch=async(input,opts={})=>{const u=new URL(input),method=opts.method||'GET';
 if(u.hostname==='oauth2.googleapis.com')return j({access_token:'fake'});
 assert.equal(opts.headers.Authorization,'Bearer fake');
 if(u.pathname.endsWith('/permissions'))return j({permissions:process.env.SCENARIO==='shared'?[{role:'reader'}]:[{role:'owner'}]});
 if(u.pathname.endsWith('/about'))return j({storageQuota:{limit:'15000000000',usage:process.env.SCENARIO==='quota'?'14999999999':'0'}});
 if(u.pathname.endsWith('/files/folder'))return j({id:'folder',mimeType:'application/vnd.google-apps.folder',appProperties:{fslBackupFolder:'v1'}});
 if(u.pathname==='/upload/drive/v3/files'){assert.ok(restored);return new Response('',{headers:{location:'https://www.googleapis.com/resumable'}});}
 if(u.pathname==='/resumable'){
  const range=opts.headers['Content-Range'];
  if(range.startsWith('bytes */'))return new Response(null,{status:308,headers:uploaded.length?{range:'bytes=0-'+(uploaded.length-1)}:{}});
  uploadCalls++;const start=Number(/bytes ([0-9]+)-/.exec(range)[1]);assert.equal(start,uploaded.length);uploaded=Buffer.concat([uploaded,opts.body]);
  if(process.env.SCENARIO==='retry'&&uploadCalls===1)return new Response(null,{status:500});
  const total=Number(range.split('/')[1]);return uploaded.length===total?j({id:'new'}):new Response(null,{status:308,headers:{range:'bytes=0-'+(uploaded.length-1)}});
 }
 if(u.pathname.endsWith('/files/new')&&u.searchParams.get('alt')==='media'){const b=Buffer.from(uploaded);if(process.env.SCENARIO==='corrupt')b[0]^=1;return new Response(b);}
 if(u.pathname.endsWith('/files/new')&&method==='PATCH'){verified=true;return j({id:'new'});}
 if(u.pathname==='/drive/v3/files'){assert.ok(verified);return j({files:Array.from({length:35},(_,i)=>{const d=new Date(Date.UTC(2026,10,7-i)).toISOString();return{id:String(i),name:'fsl-'+d.replaceAll(':','-').replace('.000','')+'.tar.gz.enc',appProperties:{fslBackup:'v1',verified:'true',capturedAt:d}};}).concat([{id:'personal',name:'personal.txt'}])});}
 if(method==='DELETE'){assert.ok(verified);assert.notEqual(u.pathname.split('/').at(-1),'personal');deletes++;return new Response(null,{status:204});}
 throw Error('Unexpected request');
};
process.on('exit',()=>{fs.writeFileSync('observed.json',JSON.stringify({restored,verified,deletes,uploadCalls}));});
`;
try{
 const hook=path.join(dir,'mock.mjs');fs.writeFileSync(hook,preload);
 for(const scenario of ['success','retry','shared','quota','corrupt']){
  const cwd=path.join(dir,scenario);fs.mkdirSync(cwd);
  const r=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,path.resolve('scripts/drive-backup.mjs')],{cwd,encoding:'utf8',env:{...process.env,SCENARIO:scenario,BACKUP_CF_TOKEN:'fake',BACKUP_PUBLIC_KEY:key,DRIVE_BACKUP_CONFIG:JSON.stringify({clientId:'fake',clientSecret:'fake',refreshToken:'fake',folderId:'folder'})}});
  const o=JSON.parse(fs.readFileSync(path.join(cwd,'observed.json')));
  if(['success','retry'].includes(scenario)){assert.equal(r.status,0,r.stderr);assert.equal(o.verified,true);assert.equal(o.deletes,24);}else{assert.equal(r.status,1);assert.equal(o.verified,false);assert.equal(o.deletes,0);}
  assert.ok(!r.stdout.includes('fake'));console.log(scenario+': passed');
 }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
