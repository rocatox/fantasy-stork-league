import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBrevo} from '../scripts/Validate-Brevo.mjs';
const input={key:'fake-key-for-isolated-test-only',to:'owner@example.test'};
test('setup checks authenticated domain, registers sender, sends only synthetic owner test',async()=>{
 const calls=[];let reads=0;
 const result=await validateBrevo(input,async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  let data={};
  if(url.endsWith('/domains/notify.storkleague.fans'))data={domain:'notify.storkleague.fans',authenticated:true};
  if(url.endsWith('/senders')&&options.method==='GET')data={senders:reads++?[{email:'updates@notify.storkleague.fans',active:true}]:[]};
  if(url.endsWith('/smtp/email'))data={messageId:'test-id'};
  return new Response(JSON.stringify(data),{status:200});
 });
 assert.equal(result.ok,true);assert.equal(result.status,'accepted-not-confirmed-delivered');
 assert.equal(calls.filter(c=>c.url.endsWith('/smtp/email')).length,1);
 const message=JSON.parse(calls.at(-1).options.body);assert.deepEqual(message.to,[{email:input.to}]);
 assert.match(message.text,/Resend is still/);assert.ok(!JSON.stringify(result).includes(input.key));
});
test('setup fails closed for unauthenticated domain and sanitizes provider failures',async()=>{
 let sends=0;
 const result=await validateBrevo(input,async url=>{if(url.endsWith('/smtp/email'))sends++;return new Response(JSON.stringify({authenticated:false}));});
 assert.equal(result.category,'domain-not-authenticated');assert.equal(sends,0);
 const denied=await validateBrevo(input,async()=>new Response(input.key,{status:401}));
 assert.deepEqual(denied,{ok:false,stage:'account',httpStatus:401});
 const failed=await validateBrevo(input,async()=>{throw Error(input.key);});
 assert.ok(!JSON.stringify(failed).includes(input.key));
});
