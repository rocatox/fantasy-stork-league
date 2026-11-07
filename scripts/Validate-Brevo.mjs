import {pathToFileURL} from 'node:url';

const DOMAIN='notify.storkleague.fans';
const FROM='updates@'+DOMAIN;
// Deliberately independent of the production queue: only a synthetic test is sent.
export async function validateBrevo(input, request=fetch){
 let stage='input';
 try {
  const {key,to}=input;
  if(typeof key!=='string'||key.length<20||/[\s"']/.test(key)||typeof to!=='string'||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to))return {ok:false,stage,category:'invalid-input'};
  const call=async(path,body)=>{
   const r=await request('https://api.brevo.com/v3'+path,{method:body?'POST':'GET',headers:{'api-key':key,'Content-Type':'application/json',accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw {httpStatus:r.status};
   return r.json();
  };
  stage='account';await call('/account');
  stage='domain';const domain=await call('/senders/domains/'+DOMAIN);
  if(domain.domain!==DOMAIN||domain.authenticated!==true)return {ok:false,stage,category:'domain-not-authenticated'};
  stage='sender';let senders=await call('/senders');
  if(!senders.senders?.some(s=>s.email===FROM)){
   await call('/senders',{name:'Fantasy Stork League',email:FROM});
   senders=await call('/senders');
  }
  if(!senders.senders?.some(s=>s.email===FROM&&s.active===true))return {ok:false,stage,category:'sender-not-active'};
  stage='test-send';
  const sent=await call('/smtp/email',{
   sender:{name:'Fantasy Stork League',email:FROM},to:[{email:to}],
   subject:'Fantasy Stork League — Brevo delivery test',
   text:'This is a synthetic Brevo delivery test. Brevo is the production sender. No player notifications or preferences were changed. Open the app: https://storkleague.fans/?view=settings',
   htmlContent:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div style="max-width:600px;margin:auto;padding:16px;font-family:Arial,sans-serif;color:#202b4d;line-height:1.6"><h1 style="font-size:24px;border-bottom:3px solid #c29a34;padding-bottom:12px">Fantasy Stork League</h1><p>This is a synthetic Brevo delivery test.</p><p>Brevo is the production sender. No player notifications or preferences were changed.</p><p><a href="https://storkleague.fans/?view=settings">Open notification settings</a></p></div></body></html>'
  });
  if(typeof sent.messageId!=='string')return {ok:false,stage,category:'unexpected-response'};
  return {ok:true,stage,status:'accepted-not-confirmed-delivered',messageId:sent.messageId};
 }catch(e){return {ok:false,stage,...(Number.isInteger(e?.httpStatus)?{httpStatus:e.httpStatus}:{category:'network-or-response-error'})};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let raw='';for await(const chunk of process.stdin)raw+=chunk;
 let result;try{const input=JSON.parse(raw);raw='';result=await validateBrevo(input);}catch{result={ok:false,stage:'input',category:'invalid-input'};}
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
