import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {standings} from '../lib/race.mjs';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0004_race.sql','utf8'));
const calls=[];let returned=0,authCalls=0;
globalThis.readCostsEnv={CLERK_SECRET_KEY:'fixture',CLERK_PUBLISHABLE_KEY:'fixture',APP_ORIGIN:'https://app.test',DB:{
 prepare(q){const st=sql.prepare(q);return {
  bind(...args){calls.push({q,args});return {all:async()=>{const results=st.all(...args);returned+=results.length;return {results};}};}
 };}
}};
globalThis.readCostsClerk={authenticateRequest:async()=>{authCalls++;return globalThis.readCostsAuth;}};
await build({entryPoints:['lib/standings.ts','lib/auth.ts'],outdir:'.runner/read-costs',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/clerk-client$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='env'?'export const env=globalThis.readCostsEnv;':'export const clerkClient=()=>globalThis.readCostsClerk;',loader:'js'}));}}]});
const {getUser}=await import('../.runner/read-costs/auth.mjs');
assert.equal(await getUser(new Request('https://app.test/api/leagues')),null);assert.equal(authCalls,0);
globalThis.readCostsAuth={isAuthenticated:false,reason:'fixture-invalid'};
await assert.rejects(getUser(new Request('https://app.test',{headers:{authorization:'Bearer invalid'}})),{code:'fixture-invalid'});
assert.equal(authCalls,1);
assert.equal(await getUser(new Request('https://app.test',{headers:{cookie:'__session=invalid'}})),null);assert.equal(authCalls,2);
globalThis.readCostsAuth={isAuthenticated:true,toAuth:()=>({userId:'member'})};
assert.equal((await getUser(new Request('https://app.test',{headers:{authorization:'Bearer valid'}}))).userId,'member');
assert.equal((await getUser(new Request('https://app.test',{headers:{cookie:'__session=valid'}}))).userId,'member');
delete globalThis.readCostsEnv.CLERK_SECRET_KEY;
await assert.rejects(getUser(new Request('https://app.test')),/configuration/);
const {addStandings}=await import('../.runner/read-costs/standings.mjs');
const results=[];for(const year of [2026,2027])for(let i=0;i<1000;i++){
 const r={year,birdId:'b'+i,version:4,arrival:null,checkedAt:new Date().toISOString(),startedAt:new Date().toISOString(),changedAt:new Date().toISOString()};
 sql.prepare('INSERT INTO race_results VALUES(?,?,?)').run(r.birdId,year,JSON.stringify(r));results.push(r);
}
const league=(id,year,n)=>({id,year,status:'ready',size:n/2,members:[{id:'a'},{id:'b'}],picks:Array.from({length:n},(_,i)=>({birdId:'b'+i,userId:i%2?'a':'b'}))});
const leagues=[league('small',2026,6),league('overlap',2026,6),league('large',2027,182),{...league('lobby',2027,0),status:'lobby'}];
const actual=await addStandings(leagues),expected=leagues.map(l=>({...l,standings:standings(l,results)}));assert.deepEqual(actual,expected);
assert.equal(returned,188,'Only distinct picked birds per year are returned, not all 2,000 results');
assert.equal(calls.length,4);assert.ok(calls.every(c=>c.args.length<=91));
assert.ok(calls.every(c=>sql.prepare('EXPLAIN QUERY PLAN '+c.q).all(...c.args).some(r=>/SEARCH.*INDEX/.test(r.detail))),'Race reads must use indexed searches');
calls.length=0;assert.equal((await addStandings([{...league('empty',2027,0),status:'lobby'}]))[0].standings.status,'draft-incomplete');assert.equal(calls.length,0);
console.log('Read costs: credential-free auth skips SDK; supplied credentials remain verified; standings parity, indexed pick-only reads, cross-year deduplication and oversized roster bounds passed.');
