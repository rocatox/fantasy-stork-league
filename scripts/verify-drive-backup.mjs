// Local-only end-to-end verification: download, decrypt, restore, compare, read app.
import fs from 'node:fs';import path from 'node:path';import {pipeline} from 'node:stream/promises';import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {digest,decrypt} from './backup-crypto.mjs';
export async function verifyDriveBackup(token,folderId,setupRoot){
 const base='https://www.googleapis.com/drive/v3/files',headers={Authorization:'Bearer '+token};
 const query=new URLSearchParams({q:`'${folderId}' in parents and trashed = false and appProperties has { key='verified' and value='true' } and appProperties has { key='fslBackup' and value='v1' }`,fields:'files(id,name,appProperties)',orderBy:'createdTime desc',pageSize:'1'});
 const listing=await fetch(base+'?'+query,{headers,signal:AbortSignal.timeout(30000)});if(!listing.ok)throw Error('List failed');
 const file=(await listing.json()).files[0];if(!file)throw Error('No verified backup');
 const dir=path.resolve('.wrangler/private-backups/drive-restore-'+Date.now());fs.mkdirSync(dir,{mode:0o700});
 const enc=path.join(dir,'download.enc');
 const r=await fetch(`${base}/${file.id}?alt=media`,{headers,signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error('Download failed');
 await pipeline(r.body,fs.createWriteStream(enc,{flags:'wx',mode:0o600}));
 if(await digest(enc)!==file.appProperties.sha256)throw Error('Ciphertext checksum failed');
 const archive=path.join(dir,'backup.tar.gz');await decrypt(enc,archive,fs.readFileSync(path.join(setupRoot,'recovery-private.pem')));
 const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
 if(new Set(entries).size!==entries.length||entries.some(n=>! /^(report\.json|source\.zip|main\.sql|archive(?:[2-8])?\.sql)$/.test(n)))throw Error('Unexpected archive entry');
 execFileSync('tar',['-xzf',archive,'-C',dir],{stdio:'pipe'});
 const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
 for(const [name,capture] of Object.entries(report.capture)){
  if(!/^(main|archive[2-8]?)$/.test(name))throw Error('Unexpected store');
  const sql=path.join(dir,name+'.sql');if(await digest(sql)!==capture.sha256)throw Error('SQL checksum mismatch');
  const db=new DatabaseSync(path.join(dir,name+'-restored.sqlite'));
  try{db.exec(fs.readFileSync(sql,'utf8'));if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Integrity failure');
   for(const [table,count] of Object.entries(report.databases[name].tables)){if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table))throw Error('Unexpected table');if(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n!==count)throw Error('Row count mismatch');}
  }finally{db.close();}
 }
 const current=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(current!==report.revision)throw Error('Use matching source revision for application verification');
 const fd=fs.openSync(path.join(dir,'private-app-verification.log'),'w',0o600);
 try{execFileSync(process.execPath,['scripts/restore-smoke.mjs',dir],{stdio:['ignore',fd,fd],timeout:600000});}finally{fs.closeSync(fd);}
 fs.writeFileSync(path.join(dir,'drive-verification.json'),JSON.stringify({ok:true,capturedAt:report.capturedAt,revision:report.revision,databases:Object.keys(report.capture).length,downloadVerified:true,decrypted:true,integrity:true,rowsMatch:true,offlineApp:true},null,2));
 console.log('Drive download, recovery-key decryption, database integrity, row counts and offline app reads all passed. No emails sent.');
}
