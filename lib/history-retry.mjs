// Retry only transient failures; never hide access, validation, or lease conflicts.
export function temporaryFailure(error){
 const message=String(error?.message||'');
 const status=message.match(/HTTP (\d{3})/);
 if(status)return [408,500,502,503,504,520,522,524].includes(Number(status[1]));
 return error?.name==='TimeoutError'||/timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|terminated/i.test(message);
}
export async function retryHistory(operation,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{},now=Date.now,deadline=Infinity}={}){
 for(let attempt=1;;attempt++){
  try{return await operation();}catch(error){
   const delayMs=attempt*15000;
   if(attempt>=3||!temporaryFailure(error)||now()+delayMs>=deadline)throw error;
   onRetry({attempt:attempt+1,delayMs});
   await sleep(delayMs);
  }
 }
}
