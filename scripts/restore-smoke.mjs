// Offline application checks. Never supply production credentials to this process.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const dir=path.resolve(process.argv[2]||'');
const root=path.resolve('.wrangler/private-backups')+path.sep;
if(!dir.startsWith(root))throw Error('Expected isolated private backup directory');
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw Error('Network disabled in restore drill');};
const main=new DatabaseSync(path.join(dir,'main-restored.sqlite'),{readOnly:true});
const archive=new DatabaseSync(path.join(dir,'archive-restored.sqlite'),{readOnly:true});
function adapter(db){return {prepare(q){
 const s=db.prepare(q),bound=(args=[])=>({first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>{throw Error('Writes forbidden in restored smoke test');}});
 return {...bound(),bind:(...args)=>bound(args)};
}};}
globalThis.restoreEnv={DB:adapter(main),HISTORY_ARCHIVE:adapter(archive),EMAIL_ENABLED:'false',SYNC_ENABLED:'false',APP_ORIGIN:'http://restore.invalid'};
const outfile=path.join(dir,'offline-app.mjs');
await build({stdin:{contents:"export {GET as history} from './lib/history-endpoint'; export {getBirds} from './lib/store'; export {addStandings} from './lib/standings'; export {deliverEmail,emailConfigured} from './lib/notification-email';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'offline-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:'export const env=globalThis.restoreEnv',loader:'js'}));}}]});
const app=await import(pathToFileURL(outfile));
assert.equal(app.emailConfigured(),false);
assert.deepEqual(await app.deliverEmail(),{status:'not-configured'});
const birds=await app.getBirds();let historyProfiles=0;
for(const bird of birds){const response=await app.history(new Request('http://restore.invalid/api/history?bird='+encodeURIComponent(bird.id)));assert.equal(response.status,200);const data=await response.json();assert.ok(Array.isArray(data.months));assert.ok(data.records>=0);historyProfiles++;}
const rankings=await (await app.history(new Request('http://restore.invalid/api/history?rankings=1'))).json();
assert.equal(Object.keys(rankings.rankings).length,birds.length);
const leagues=main.prepare('SELECT state FROM leagues').all().map(r=>JSON.parse(r.state));
const enriched=await app.addStandings(leagues);assert.equal(enriched.length,leagues.length);assert.ok(enriched.every(l=>l.standings));
assert.equal(networkAttempts,0);
const report={historyProfiles,rankings:Object.keys(rankings.rankings).length,leagueStandings:enriched.length,emailStatus:'not-configured',networkAttempts,readOnlyDatabases:true};
// Exercise recovered write triggers in a disposable copy, then roll back.
const writablePath=path.join(dir,'write-check-'+Date.now()+'.sqlite');
fs.copyFileSync(path.join(dir,'main-restored.sqlite'),writablePath,fs.constants.COPYFILE_EXCL);
const writable=new DatabaseSync(writablePath);
const league=writable.prepare('SELECT id FROM leagues LIMIT 1').get();
if(league){
 const before=writable.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n;
 writable.exec('BEGIN');
 try{writable.prepare('UPDATE leagues SET revision=revision+1 WHERE id=?').run(league.id);assert.equal(writable.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,before+1);}finally{writable.exec('ROLLBACK');}
 assert.equal(writable.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,before);
 report.leagueWriteAndNotificationTrigger='passed in disposable copy; rolled back';
}
writable.close();
fs.writeFileSync(path.join(dir,'application-checks.json'),JSON.stringify(report,null,2));
main.close();archive.close();console.log(JSON.stringify(report,null,2));
