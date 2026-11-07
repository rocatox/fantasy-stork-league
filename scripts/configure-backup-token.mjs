// Receives the Cloudflare token via stdin, never command-line arguments or logs.
import fs from 'node:fs';import {spawn} from 'node:child_process';
let input='';for await(const c of process.stdin)input+=c;const token=input.trim();
try{
 if(!token||/\s/.test(token))throw Error('Invalid token');
 const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
 for(const d of config.d1_databases){const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${d.database_id}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT 1 AS backup_read_check'}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(!r.ok||!b.success)throw Error('Database check failed');}
 await new Promise((resolve,reject)=>{const p=spawn('gh',['secret','set','BACKUP_CF_TOKEN','--repo','rocatox/fantasy-stork-league'],{stdio:['pipe','pipe','pipe'],windowsHide:true});p.stdout.resume();p.stderr.resume();p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('Secret save failed')));p.stdin.end(token);});
 console.log('Read access to all three databases verified; encrypted repository secret saved. No token printed.');
}catch{console.error('Backup token setup failed. Check D1 Read permission for your account and GitHub CLI authorization. No token printed.');process.exitCode=1;}
