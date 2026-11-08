// Used only by the generated isolated recovery Worker, never the production entry.
const blocked=new Set(['/api/sync','/api/race','/api/notification-jobs','/api/bug-reports','/api/email-unsubscribe','/api/capacity','/api/operations']);
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export function failoverGate(app){return {async fetch(req,env,ctx){
 const url=new URL(req.url);
 if(env.OPERATIONS_ENABLED==='true'||env.EMAIL_ENABLED!=='false'||env.SYNC_ENABLED!=='false'||env.BREVO_API_KEY||env.GITHUB_SYNC_TOKEN||env.SYNC_SECRET||!Number.isFinite(Number(env.DRILL_EXPIRES))||Date.now()>=Number(env.DRILL_EXPIRES))return new Response('Recovery environment unavailable',{status:503,headers});
 if(url.pathname==='/__drill/unlock'&&req.method==='POST'){
  if(Number(req.headers.get('content-length')||0)>4096)return new Response('Not found',{status:404,headers});
  let token='';try{token=String((await req.formData()).get('token')||'');}catch{}
  if(!same(token,env.DRILL_GATE_KEY))return new Response('Not found',{status:404,headers});
  return new Response(null,{status:303,headers:{...headers,Location:'/', 'Set-Cookie':`__Host-fsl-drill=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=14400`}});
 }
 const cookie=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-fsl-drill='))?.slice(17);
 if(!same(cookie,env.DRILL_GATE_KEY))return new Response('Not found',{status:404,headers});
 if(blocked.has(url.pathname))return new Response('Disabled in recovery drill',{status:403,headers});
 const response=await app.fetch(req,env,ctx),result=new Response(response.body,response);
 for(const [k,v] of Object.entries(headers))result.headers.set(k,v);
 result.headers.set('X-FSL-Recovery-Drill','isolated');return result;
}};}
