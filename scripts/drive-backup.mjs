// CI orchestration. Never writes backup contents to stdout or public artifacts.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {encrypt,retention} from './backup-crypto.mjs';
const root=path.resolve('.wrangler/private-backups');
let stage='configuration';
try{
 if(!process.env.BACKUP_CF_TOKEN||!process.env.BACKUP_PUBLIC_KEY)throw Error('Missing backup credentials');
 const cfg=JSON.parse(process.env.DRIVE_BACKUP_CONFIG||'null');
 if(!cfg?.clientId||!cfg?.clientSecret||!cfg?.refreshToken||!/^[\w-]+$/.test(cfg.folderId))throw Error('Missing Drive configuration');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const result=path.join(root,'capture-result.json'),log=fs.openSync(path.join(root,'private-run.log'),'a',0o600);
 stage='capture and local restoration';
 execFileSync(process.execPath,['scripts/backup-drill.mjs'],{stdio:['ignore',log,log],env:{...process.env,BACKUP_RESULT_FILE:result},timeout:50*60*1000});
 const dir=JSON.parse(fs.readFileSync(result,'utf8')).directory;
 if(!path.resolve(dir).startsWith(root+path.sep))throw Error('Invalid capture location');
 const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
 if(!report.safety?.archiveTwoPassMatch||Object.values(report.databases).some(d=>!d.allRowsMatch||!d.allSchemaMatches))throw Error('Unverified recovery point');
 stage='offline app verification';
 // This process explicitly blocks outbound network and disables delivery.
 execFileSync(process.execPath,['scripts/restore-smoke.mjs',dir],{stdio:['ignore',log,log],timeout:10*60*1000});
 fs.closeSync(log);
 stage='compress and encrypt';
 const archive=path.join(dir,'backup.tar.gz');
 execFileSync('tar',['-czf',archive,'-C',dir,'report.json','source.zip',...Object.keys(report.capture).map(n=>n+'.sql')],{stdio:'pipe'});
 const file=archive+'.enc',encrypted=await encrypt(archive,file,process.env.BACKUP_PUBLIC_KEY);
 stage='Drive authorization';
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,refresh_token:cfg.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});
 const t=await auth.json();if(!auth.ok||!t.access_token)throw Error('Drive authorization failed');
 const headers={Authorization:'Bearer '+t.access_token};
 async function request(url,options={}){const r=await fetch(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Drive request failed');return r;}
 async function json(url,options){return (await request(url,options)).json();}
 stage='private folder and quota checks';
 const base='https://www.googleapis.com/drive/v3/files';
 const folder=await json(`${base}/${cfg.folderId}?fields=id,mimeType,trashed,appProperties`);
 if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||folder.appProperties?.fslBackupFolder!=='v1')throw Error('Invalid backup folder');
 const perms=await json(`${base}/${cfg.folderId}/permissions?fields=permissions(type,role)`);if(perms.permissions.some(p=>p.role!=='owner'))throw Error('Backup folder sharing is not private');
 const {storageQuota:q}=await json('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
 if(!q?.limit||BigInt(q.limit)-BigInt(q.usage||0)<BigInt(encrypted.bytes)+200000000n)throw Error('Insufficient free storage; no old backups removed');
 stage='encrypted upload';
 const name='fsl-'+report.capturedAt.replaceAll(':','-').replace(/\.\d{3}Z$/,'Z')+'.tar.gz.enc';
 const init=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(encrypted.bytes)},body:JSON.stringify({name,parents:[cfg.folderId],appProperties:{fslBackup:'v1',verified:'false',capturedAt:report.capturedAt,sha256:encrypted.sha256}})});
 const session=init.headers.get('location');if(!session||new URL(session).origin!=='https://www.googleapis.com')throw Error('Invalid upload session');
 const fd=fs.openSync(file,'r');let offset=0,id,failures=0;
 try{while(offset<encrypted.bytes){
  const chunk=Buffer.alloc(Math.min(4*1024*1024,encrypted.bytes-offset));fs.readSync(fd,chunk,0,chunk.length,offset);
  let response;
  try{response=await fetch(session,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Range':`bytes ${offset}-${offset+chunk.length-1}/${encrypted.bytes}`},body:chunk,signal:AbortSignal.timeout(120000)});}catch{}
  if(!response||response.status===429||response.status>=500){
   if(++failures>3)throw Error('Upload retry limit');await new Promise(r=>setTimeout(r,failures*2000));
   response=await fetch(session,{method:'PUT',headers:{...headers,'Content-Range':`bytes */${encrypted.bytes}`,'Content-Length':'0'},signal:AbortSignal.timeout(30000)});
  }
  if(response.ok){id=(await response.json()).id;offset=encrypted.bytes;}
  else if(response.status===308){const range=response.headers.get('range');const next=range?Number(/^bytes=0-(\d+)$/.exec(range)?.[1])+1:0;if(!Number.isSafeInteger(next)||next<offset||next>offset+chunk.length)throw Error('Invalid upload offset');if(next===offset&&++failures>3)throw Error('Upload stalled');offset=next;}
  else throw Error('Upload failed');
 }}finally{fs.closeSync(fd);}
 if(!id)throw Error('Missing uploaded file');
 stage='download integrity verification';
 const download=await request(`${base}/${id}?alt=media`),hash=createHash('sha256');let bytes=0;
 for await(const chunk of download.body){hash.update(chunk);bytes+=chunk.length;}
 if(bytes!==encrypted.bytes||hash.digest('hex')!==encrypted.sha256)throw Error('Uploaded ciphertext mismatch');
 await json(`${base}/${id}?fields=id`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({appProperties:{verified:'true'}})});
 stage='bounded retention';
 let files=[],pageToken;
 do{const query=new URLSearchParams({q:`'${cfg.folderId}' in parents and trashed = false`,fields:'nextPageToken,files(id,name,appProperties)',pageSize:'1000',...(pageToken?{pageToken}:{})});const page=await json(base+'?'+query);files.push(...page.files);pageToken=page.nextPageToken;}while(pageToken);
 // Prune only after a new verified upload and only marked backups in our private folder.
 const obsolete=retention(files);for(const f of obsolete)await request(`${base}/${f.id}`,{method:'DELETE'});
 console.log(JSON.stringify({ok:true,databases:Object.keys(report.capture).length,encryptedBytes:encrypted.bytes,downloadVerified:true,localRestoreVerified:true,removedOldBackups:obsolete.length,revision:report.revision,capturedAt:report.capturedAt}));
}catch{console.error('Backup failed at '+stage+'. No backup contents or credentials printed; private diagnostics remain local to this runner.');process.exitCode=1;}
