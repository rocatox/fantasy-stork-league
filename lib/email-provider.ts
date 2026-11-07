export function emailProvider(_config?:any){return 'brevo';}
// Use the shorter documented single-email window, with a safety margin.
export function retryWindow(_provider?:string){return 14*60000;}
export async function sendEmail(config:any,provider:string,message:any,key:string):Promise<any>{
 const {_provider,...clean}=message;
 if(provider!=='brevo')return {error:{statusCode:400,name:'unknown-provider'}};
 const sender=clean.from.match(/^(.*?)\s*<([^>]+)>$/);
 if(!sender||!clean.html)return {error:{statusCode:400,name:'invalid-message'}};
 try{
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));digest[6]=(digest[6]&15)|64;digest[8]=(digest[8]&63)|128;const hex=Array.from(digest.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');const brevoKey=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':config.BREVO_API_KEY,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(12000),body:JSON.stringify({sender:{name:sender[1].trim(),email:sender[2]},to:clean.to.map((email:string)=>({email})),subject:clean.subject,htmlContent:clean.html,textContent:clean.text,headers:{...clean.headers,idempotencyKey:brevoKey}})});
  const result:any=await r.json().catch(()=>({}));
  if(r.ok&&result.messageId)return {data:{id:result.messageId}};
  // A same-key duplicate means Brevo already processed this exact durable message.
  if(r.status===400&&result.code==='duplicate_parameter'&&/idempotency/i.test(result.message||''))return {data:{id:'idempotent:'+key}};
  return {error:{statusCode:r.ok?undefined:r.status,name:result.code},headers:{'retry-after':r.headers.get('retry-after')}};
 }catch(e:any){return {error:{name:['AbortError','TimeoutError','TypeError'].includes(e?.name)?e.name:'network-or-response-error'}};}
}

