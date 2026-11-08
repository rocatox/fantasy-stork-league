// Never automatically retry mutations: a timed-out action may have reached the server.
export async function fetchWithTimeout(url,options={},fetcher=fetch,timeoutMs=20000){
 const controller=new AbortController(),abort=()=>controller.abort(options.signal?.reason);
 if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{return await fetcher(url,{...options,signal:controller.signal});}
 catch(error){if(timedOut)throw Error(options.method&&options.method!=='GET'?'The request timed out. Refresh to check whether your change was saved before trying again.':'The request timed out. Please retry.');throw error;}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
