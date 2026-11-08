// Receives the Cloudflare token via stdin, never command-line arguments or logs.
import fs from 'node:fs';import {spawn} from 'node:child_process';
import path from 'node:path';
const installedGh=path.join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI','gh.exe');
const gh=process.platform==='win32'&&fs.existsSync(installedGh)?installedGh:'gh';
let input='';for await(const c of process.stdin)input+=c;const token=input.trim();
const diagnostic={ok:false,stage:'validate token input',category:'invalid-input'};
try{
 if(!token||/\s/.test(token))throw Error('Invalid token');
 diagnostic.stage='read database configuration';diagnostic.category='configuration';
 const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
 for(const d of config.d1_databases){
  diagnostic.stage='Cloudflare database read';diagnostic.database=config.d1_databases.indexOf(d)+1;diagnostic.category='network';delete diagnostic.httpStatus;delete diagnostic.providerCodes;
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${d.database_id}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT 1 AS backup_read_check'}),signal:AbortSignal.timeout(30000)});
  diagnostic.httpStatus=r.status;diagnostic.category='unexpected-response';
  const b=await r.json();diagnostic.providerCodes=(b.errors||[]).map(e=>e.code).filter(Number.isSafeInteger);
  if(!r.ok||!b.success||b.result?.some(x=>x.success===false)){diagnostic.category=r.status===401?'authentication-rejected':r.status===403?'access-denied':'query-rejected';throw Error('Database check failed');}
 }
 diagnostic.stage='save GitHub repository secret';diagnostic.category='github-secret-save';delete diagnostic.httpStatus;delete diagnostic.providerCodes;delete diagnostic.database;
 await new Promise((resolve,reject)=>{
  const p=spawn(gh,['secret','set','BACKUP_CF_TOKEN','--repo','rocatox/fantasy-stork-league'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let stderr='';
  p.stdout.resume();p.stderr.on('data',c=>{stderr=(stderr+c).slice(-16000);});
  p.on('error',e=>{diagnostic.category=e.code==='ENOENT'?'github-cli-not-found':'github-cli-launch-failed';reject(Error('CLI launch failed'));});
  p.stdin.on('error',()=>{});
  p.on('close',c=>{
   if(c===0){resolve();return;}
   diagnostic.exitCode=Number.isInteger(c)?c:null;
   if(/gh auth login|not logged|authentication|HTTP 401|Bad credentials/i.test(stderr))diagnostic.category='github-authentication';
   else if(/HTTP 403|Resource not accessible|permission/i.test(stderr))diagnostic.category='github-permission';
   else if(/HTTP 404|Could not resolve to a Repository/i.test(stderr))diagnostic.category='github-repository-access';
   else if(/connection|lookup|timeout|TLS|certificate/i.test(stderr))diagnostic.category='github-network';
   reject(Error('Secret save failed'));
  });p.stdin.end(token);
 });
 diagnostic.ok=true;diagnostic.stage='complete';diagnostic.category='success';
 console.log('Read access to all three databases verified; encrypted repository secret saved. No token printed.');
}catch{
 console.error('Safe diagnostic: '+JSON.stringify(diagnostic));
 console.error('Backup token setup failed. No token printed or saved locally; scheduled backups remain disabled.');process.exitCode=1;
}finally{
 try{fs.mkdirSync('.runner',{recursive:true});fs.writeFileSync('.runner/backup-token-setup-diagnostic.json',JSON.stringify(diagnostic,null,2));}catch{}
}
