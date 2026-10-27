import assert from 'node:assert/strict';
const origin=process.env.APP_ORIGIN||'https://fantasy-stork-league.rocatox.workers.dev';
const secret=process.env.SYNC_SECRET;if(!secret)throw Error('SYNC_SECRET required');
const headers={'Content-Type':'application/json',Authorization:`Bearer ${secret}`};
const post=body=>fetch(origin+'/api/sync',{method:'POST',headers,body:JSON.stringify(body),redirect:'error'});
assert.equal((await fetch(origin+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
const studyId='10449318';const before=await fetch(origin+'/api/birds').then(r=>r.json());
const r=await post({action:'context',studyId});assert.equal(r.status,200);const context=await r.json();
try{
 assert.equal((await post({action:'release',studyId,lease:'not-the-owner'})).status,409);
 const invalid=await post({action:'commit',studyId,lease:context.lease,birds:[{id:'another-study:Bird',studyId:'another-study'}],metadata:context.metadata,state:context.state,report:{status:'succeeded',studyId}});
 assert.equal(invalid.status,400);
}finally{assert.equal((await post({action:'release',studyId,lease:context.lease})).status,200);}
const after=await fetch(origin+'/api/birds').then(r=>r.json());
assert.equal(JSON.stringify(after.birds)===JSON.stringify(before.birds),true,'Bird snapshot changed');assert.equal(JSON.stringify(after.sources)===JSON.stringify(before.sources),true,'Source state changed');
console.log('PASS: unauthorized sync denied; lease ownership enforced; invalid snapshot rejected; committed birds and source state unchanged.');

