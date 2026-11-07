import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {encrypt,decrypt,digest,retention} from '../scripts/backup-crypto.mjs';
test('encrypted backup roundtrip, fresh randomness, tampering and wrong-key rejection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fsl-crypto-'));const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 try{const src=path.join(dir,'source');fs.writeFileSync(src,randomBytes(300000));
 await encrypt(src,path.join(dir,'a'),pair.publicKey);await encrypt(src,path.join(dir,'b'),pair.publicKey);
 assert.notEqual(await digest(path.join(dir,'a')),await digest(path.join(dir,'b')));
 await decrypt(path.join(dir,'a'),path.join(dir,'restored'),pair.privateKey);assert.equal(await digest(src),await digest(path.join(dir,'restored')));
 const bad=fs.readFileSync(path.join(dir,'a'));bad[bad.length-35]^=1;fs.writeFileSync(path.join(dir,'bad'),bad);
 await assert.rejects(decrypt(path.join(dir,'bad'),path.join(dir,'rejected'),pair.privateKey));assert.equal(fs.existsSync(path.join(dir,'rejected')),false);
 const wrong=generateKeyPairSync('rsa',{modulusLength:2048});await assert.rejects(decrypt(path.join(dir,'a'),path.join(dir,'wrong'),wrong.privateKey));
 assert.equal(fs.readdirSync(dir).some(f=>f.includes('unverified')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('retention keeps daily/weekly copies and never touches unrelated or unverified files',()=>{
 const files=Array.from({length:60},(_,i)=>{const date=new Date(Date.UTC(2026,10,7-i)).toISOString();return {id:String(i),name:'fsl-'+date.replaceAll(':','-').replace('.000','')+'.tar.gz.enc',appProperties:{fslBackup:'v1',verified:'true',capturedAt:date}};});
 files.push({id:'personal',name:'personal.txt'},{...files[0],id:'unverified',appProperties:{...files[0].appProperties,verified:'false'}});
 const removed=retention(files).map(f=>f.id);assert.equal(removed.length,49);for(let i=0;i<7;i++)assert.ok(!removed.includes(String(i)));assert.ok(!removed.includes('personal'));assert.ok(!removed.includes('unverified'));
});
