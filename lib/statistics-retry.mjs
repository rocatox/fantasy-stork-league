import {retryHistory} from './history-retry.mjs';

// Resume from persisted summaries after an ambiguous write response. Reusing the
// claim ID also recovers a claim whose response was lost, without stealing locks.
export async function retryStatisticsBird(api,birdId,calculate,options={}){
 const lease=crypto.randomUUID();
 try{
  return await retryHistory(async()=>{
   const context=await api({action:'claim',birdId,lease});
   return calculate(context,lease);
  },options);
 }finally{
  await api({action:'release',birdId,lease}).catch(()=>{});
 }
}
