// Only these two anonymous responses may enter shared storage. Private endpoints,
// errors and writes never use this helper. Authoritative draft checks bypass it.
export function publicCacheKey(request) {
 const u=new URL(request.url);
 if(request.method!=='GET')return null;
 const name=u.pathname==='/api/birds'?'roster':u.pathname==='/api/history'&&u.searchParams.get('rankings')==='1'?'rankings':null;
 return name?new Request(u.origin+'/__public-cache/v1/'+name):null;
}
export async function publicCached(request,load,cache,ctx){
 const key=publicCacheKey(request);if(!key||!cache)return load();
 const serve=(r,status)=>{const headers=new Headers(r.headers);headers.set('Cache-Control','no-store');headers.set('X-Public-Cache',status);return new Response(r.body,{status:r.status,headers});};
 try{const hit=await cache.match(key);if(hit)return serve(hit,'HIT');}catch{/* cache failure must not make the API unavailable */}
 const response=await load();
 if(response.status!==200||response.headers.has('Set-Cookie'))return response;
 const headers=new Headers(response.headers);headers.set('Cache-Control','public, max-age=60');headers.delete('Vary');
 const saved=new Response(response.clone().body,{status:200,headers});
 ctx.waitUntil(cache.put(key,saved).catch(()=>{}));
 return serve(response,'MISS');
}
