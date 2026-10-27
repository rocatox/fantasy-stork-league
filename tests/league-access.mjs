import {build} from 'esbuild';
import assert from 'node:assert/strict';
const fixture={user:{userId:'owner',displayName:'Account Name'},rows:[],created:null};
globalThis.leagueTest=fixture;
const mocks={
 auth:`export const getUser=async()=>globalThis.leagueTest.user;`,
 disband:`export const disbandExpired=async()=>{};`,
 store:`export const json=(body,status=200)=>Response.json(body,{status});export const safeWrite=req=>req.headers.get('origin')===new URL(req.url).origin;export const getBirds=async()=>[];
 export const database=()=>({prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:globalThis.leagueTest.rows};},async first(){if(sql.includes('COUNT'))return {n:0};return globalThis.leagueTest.rows[0]||null;},async run(){if(sql.startsWith('INSERT'))globalThis.leagueTest.created=JSON.parse(this.args[2]);return {meta:{changes:1}};}};}});`
};
const compiled=await build({entryPoints:['app/api/leagues/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'test-boundaries',setup(b){b.onResolve({filter:/lib\/(auth|store|disband)$/},args=>({path:args.path.split('/').pop(),namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const url='https://storkleague.fans/api/leagues';const post=body=>POST(new Request(url,{method:'POST',headers:{origin:'https://storkleague.fans','content-type':'application/json'},body:JSON.stringify(body)}));
const league={id:'league',name:'Private',owner:'owner',invite:'private-code',status:'lobby',members:[{id:'owner',name:'Old Name'}],picks:[],year:2027};
fixture.rows=[{id:'league',state:JSON.stringify(league),revision:0}];
let result=await GET(new Request(url));let body=await result.json();assert.equal(body.leagues[0].members[0].name,'Account Name');
result=await post({action:'create',name:'Test',displayName:'Spoofed Name'});assert.equal(result.status,200);assert.equal(fixture.created.members[0].name,'Account Name');
fixture.user={userId:'outsider',displayName:'Other Account'};body=await (await GET(new Request(url))).json();assert.equal(body.leagues.length,0);
for(const action of ['rotateInvite','start','pick'])assert.equal((await post({action,id:'league'})).status,404);
fixture.user={userId:'owner',displayName:''};assert.equal((await post({action:'create',name:'Test',displayName:'Spoofed Name'})).status,400);
fixture.user=null;body=await (await GET(new Request(url))).json();assert.equal(body.signedIn,false);assert.equal(body.leagues.length,0);assert.equal((await post({action:'create',name:'Test'})).status,401);
console.log('PASS: members only; nonmember writes denied; anonymous access denied; verified account names override client input; missing names rejected; existing member name refreshed.');
delete globalThis.leagueTest;
