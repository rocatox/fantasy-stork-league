// Versioned authenticated envelope: RSA-OAEP-SHA256 wraps a fresh AES-256-GCM key.
import fs from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomBytes,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,constants,createHash} from 'node:crypto';
const MAGIC=Buffer.from('FSLBACK1');
export async function digest(file,algorithm='sha256'){
 const h=createHash(algorithm);for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex');
}
export async function encrypt(file,out,publicKey){
 const key=randomBytes(32),iv=randomBytes(12);
 const wrapped=publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key);
 const size=Buffer.alloc(4);size.writeUInt32BE(wrapped.length);
 const header=Buffer.concat([MAGIC,size,wrapped,iv]);
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
 fs.writeFileSync(out,header,{flag:'wx',mode:0o600});
 try{await pipeline(fs.createReadStream(file),cipher,fs.createWriteStream(out,{flags:'a'}));fs.appendFileSync(out,cipher.getAuthTag());}
 catch(e){fs.rmSync(out,{force:true});throw e;}finally{key.fill(0);}
 return {sha256:await digest(out),bytes:fs.statSync(out).size};
}
export async function decrypt(file,out,privateKey){
 if(fs.existsSync(out))throw Error('Recovery output already exists');
 const fd=fs.openSync(file,'r');let header,key,iv,tag;
 try{
  const prefix=Buffer.alloc(12);if(fs.readSync(fd,prefix,0,12,0)!==12||!prefix.subarray(0,8).equals(MAGIC))throw Error('Invalid backup format');
  const size=prefix.readUInt32BE(8);if(size<256||size>1024)throw Error('Invalid key envelope');
  header=Buffer.alloc(12+size+12);if(fs.readSync(fd,header,0,header.length,0)!==header.length)throw Error('Truncated header');
  if(fs.statSync(file).size<header.length+16)throw Error('Truncated backup');
  iv=header.subarray(-12);tag=Buffer.alloc(16);fs.readSync(fd,tag,0,16,fs.statSync(file).size-16);
  key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},header.subarray(12,12+size));
 }finally{fs.closeSync(fd);}
 const temp=out+'.unverified-'+randomBytes(8).toString('hex');
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(header);decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(file,{start:header.length,end:fs.statSync(file).size-17}),decipher,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
  fs.renameSync(temp,out);
 }catch(e){fs.rmSync(temp,{force:true});throw e;}finally{key.fill(0);}
}
export function retention(files){
 // Inputs must already belong to our private folder; unknown or unverified files are untouched.
 const candidates=files.filter(f=>f.appProperties?.fslBackup==='v1'&&f.appProperties?.verified==='true'&&/^fsl-\d{4}-\d{2}-\d{2}T[\d-]+Z\.tar\.gz\.enc$/.test(f.name)&&Number.isFinite(Date.parse(f.appProperties.capturedAt)));
 candidates.sort((a,b)=>Date.parse(b.appProperties.capturedAt)-Date.parse(a.appProperties.capturedAt));
 const keep=new Set(),days=new Set(),weeks=new Set();
 for(const f of candidates){const day=f.appProperties.capturedAt.slice(0,10);if(!days.has(day)&&days.size<7){days.add(day);keep.add(f.id);}}
 const oldestDaily=[...days].sort()[0];
 for(const f of candidates){if(keep.has(f.id)||f.appProperties.capturedAt.slice(0,10)>=oldestDaily)continue;const d=new Date(f.appProperties.capturedAt);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const week=d.toISOString().slice(0,10);if(!weeks.has(week)&&weeks.size<4){weeks.add(week);keep.add(f.id);}}
 return candidates.filter(f=>!keep.has(f.id));
}
