import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.authFixture={CLERK_SECRET_KEY:'fixture',CLERK_PUBLISHABLE_KEY:'fixture',APP_ORIGIN:'https://storkleague.fans',LEGACY_APP_ORIGIN:'https://fantasy-stork-league.rocatox.workers.dev'};
let calls=0,options,authenticated=false,reason='token-expired',identity={userId:'verified-user'};
globalThis.authClient={authenticateRequest:async(req,opts)=>{calls++;options=opts;return {isAuthenticated:authenticated,reason,toAuth:()=>identity};},users:{getUser:async id=>({id,username:'Verified'})}};
await build({entryPoints:['lib/auth.ts'],outfile:'.runner/auth-boundary.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'boundary',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/clerk-client$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='env'?'export const env=globalThis.authFixture;':'export const clerkClient=()=>globalThis.authClient;'}));}}]});
const {getUser}=await import('../.runner/auth-boundary.mjs');
const req=headers=>new Request('https://storkleague.fans/api/leagues',{headers});
assert.equal(await getUser(req({})),null);assert.equal(calls,0);
for(const r of ['token-expired','token-invalid-signature','token-invalid-authorized-parties']){reason=r;await assert.rejects(getUser(req({authorization:'Bearer untrusted'})),e=>e.code===r);}
assert.equal(options.acceptsToken,'session_token');assert.deepEqual(options.authorizedParties,[authFixture.APP_ORIGIN,authFixture.LEGACY_APP_ORIGIN]);
assert.equal(await getUser(req({cookie:'__session=untrusted'})),null);
authenticated=true;assert.deepEqual(await getUser(req({authorization:'Bearer verified','x-user-id':'attacker'}),true),{userId:'verified-user',displayName:'Verified'});
identity={userId:null,sessionStatus:'pending'};await assert.rejects(getUser(req({authorization:'Bearer incomplete'})),e=>e.code==='session-pending');
delete authFixture.CLERK_SECRET_KEY;await assert.rejects(getUser(req({authorization:'Bearer verified'})),e=>e.code==='auth-configuration');
console.log('PASS auth boundary: missing credentials, rejected/expired sessions, allowed parties/session-token policy, server identity, incomplete accounts, missing configuration. Clerk verifier mocked; no claim of live provider testing.');
