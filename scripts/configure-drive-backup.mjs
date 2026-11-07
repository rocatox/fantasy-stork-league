// Local-only OAuth setup. Credentials go directly to GitHub's encrypted secret store.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,createHash,generateKeyPairSync,createPublicKey} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
const repo='rocatox/fantasy-stork-league';
const scope='https://www.googleapis.com/auth/drive.file';
let stage='read desktop client';
const server=http.createServer();
let deadline;
try {
 const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).installed;
 if(!c?.client_id||!c?.client_secret||c.auth_uri!=='https://accounts.google.com/o/oauth2/auth'||c.token_uri!=='https://oauth2.googleapis.com/token')throw Error('Invalid desktop client');
 const root=path.resolve('.wrangler/private-backups/drive-setup');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 execFileSync('git',['check-ignore',root],{stdio:'pipe'});
 stage='check GitHub authorization';execFileSync('gh',['auth','status'],{stdio:'pipe'});
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const redirect=`http://127.0.0.1:${server.address().port}/callback`;
 const codePromise=new Promise((resolve,reject)=>{
  deadline=setTimeout(()=>reject(Error('Authorization timed out')),10*60*1000);
  server.on('request',(req,res)=>{
   const u=new URL(req.url,redirect);
   if(u.pathname!=='/callback'||u.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid callback');return;}
   if(u.searchParams.has('error')||!u.searchParams.get('code')){res.end('Authorization was not completed.');reject(Error('Authorization denied'));return;}
   res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Google authorization received. You may close this tab. Setup verification continues locally.');resolve(u.searchParams.get('code'));
  });
 });
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:c.client_id,redirect_uri:redirect,response_type:'code',scope,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
 stage='Google consent';
 execFileSync('powershell.exe',['-NoProfile','-Command',`Start-Process '${url.href.replaceAll("'","''")}'`],{stdio:'pipe',windowsHide:true});
 console.log('Google authorization opened in your default browser. Sign in and approve access to files created by this backup app.');
 const code=await codePromise;clearTimeout(deadline);server.close();
 stage='exchange authorization';
 const tr=await fetch(c.token_uri,{method:'POST',body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(30000)});
 const tokens=await tr.json();if(!tr.ok||!tokens.refresh_token||!tokens.access_token)throw Error('Token exchange failed');
 if(tokens.scope?.split(' ').some(s=>s!==scope))throw Error('Unexpected authorization scopes');
 async function drive(url,options={}){const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Drive HTTP '+r.status);return r.json();}
 stage='check Drive storage';
 const about=await drive('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
 const quota=about.storageQuota;if(!quota?.limit||BigInt(quota.limit)-BigInt(quota.usage||0)<2000000000n)throw Error('At least 2 GB free Drive space is required for initial setup');
 stage='create private backup folder';
 const q="trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='fslBackupFolder' and value='v1' }";
 const existing=await drive('https://www.googleapis.com/drive/v3/files?fields=files(id)&q='+encodeURIComponent(q));
 if(existing.files.length>1)throw Error('Multiple backup folders; review before proceeding');
 const folder=existing.files[0]||await drive('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',body:JSON.stringify({name:'Fantasy Stork League Backups',mimeType:'application/vnd.google-apps.folder',appProperties:{fslBackupFolder:'v1'}})});
 const permissions=await drive(`https://www.googleapis.com/drive/v3/files/${folder.id}/permissions?fields=permissions(type,role)`);
 if(permissions.permissions.some(p=>p.role!=='owner'))throw Error('Backup folder is shared; remove sharing before setup');
 if(process.argv[3]==='verify'){
  stage='download and local restore verification';
  const {verifyDriveBackup}=await import('./verify-drive-backup.mjs');
  await verifyDriveBackup(tokens.access_token,folder.id,root);
 }else{
 stage='create recovery key';
 const privatePath=path.join(root,'recovery-private.pem');
 if(!fs.existsSync(privatePath)){const pair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});fs.writeFileSync(privatePath,pair.privateKey,{mode:0o600,flag:'wx'});}
 const publicKey=createPublicKey(fs.readFileSync(privatePath)).export({type:'spki',format:'pem'});
 stage='save encrypted repository credentials';
 async function secret(name,value){await new Promise((resolve,reject)=>{const p=spawn('gh',['secret','set',name,'--repo',repo],{stdio:['pipe','pipe','pipe'],windowsHide:true});p.on('error',reject);p.stdout.resume();p.stderr.resume();p.on('exit',c=>c===0?resolve():reject(Error('Secret configuration failed')));p.stdin.end(value);});}
 await secret('DRIVE_BACKUP_CONFIG',JSON.stringify({clientId:c.client_id,clientSecret:c.client_secret,refreshToken:tokens.refresh_token,folderId:folder.id}));
 await secret('BACKUP_PUBLIC_KEY',publicKey);
 fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({folderId:folder.id,configuredAt:new Date().toISOString(),privateKeyPath:privatePath,quotaBytes:quota.limit,usedBytes:quota.usage,publicKeyFingerprint:createHash('sha256').update(publicKey).digest('hex')},null,2),{mode:0o600});
 console.log('Drive authorization configured. No credential values were printed. Automatic backups are NOT enabled yet.');
 console.log('Recovery key (keep private and copy to a password manager/offline storage): '+privatePath);
 console.log('Private folder: https://drive.google.com/drive/folders/'+folder.id);
 }
} catch {console.error('Setup failed at: '+stage+'. No credential values printed. Automatic backups remain disabled.');process.exitCode=1;} finally {clearTimeout(deadline);server.close();}
