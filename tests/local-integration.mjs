// Loopback-only authentication boundary smoke test; no real accounts are used.
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:5173';
const r=await fetch(origin+'/api/leagues');assert.equal(r.status,200);assert.deepEqual((await r.json()).leagues,[]);
const denied=await fetch(origin+'/api/leagues',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':'spoofed','oai-authenticated-user-email':'spoofed@example.test'},body:JSON.stringify({action:'create',name:'Untrusted',displayName:'X'})});assert.equal(denied.status,401);
const sync=await fetch(origin+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(sync.status,401);
console.log('PASS: anonymous league list empty; spoofed identity rejected; sync writer protected. Multi-user draft integration still requires separate authenticated accounts.');
