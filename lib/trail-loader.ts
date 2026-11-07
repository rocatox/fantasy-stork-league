import {receiveTrail} from './trail-transfer.mjs';
import {mapPriority} from './map-priority.mjs';
function client(background:boolean){
 let worker:Worker|null=null,nextId=0;
 const pending=new Map<number,{resolve:(trail:any)=>void,reject:(error:Error)=>void}>();
 if(background)mapPriority.subscribe(state=>worker?.postMessage({priorityState:state}));
 return (bird:any,start:number|null,end:number|null,overview:string|null=null,signal?:AbortSignal)=>{
  if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  if(!worker){
   worker=new Worker(new URL('./trail-worker.ts',import.meta.url),{type:'module'});
   if(background)worker.postMessage({priorityState:mapPriority.state()});
   worker.onmessage=({data})=>{const task=pending.get(data.requestId);if(!task||!receiveTrail(task,data))return;pending.delete(data.requestId);if(data.error)task.reject(new Error(data.error));else task.resolve(data.trail);};
   worker.onerror=()=>{worker?.terminate();worker=null;for(const task of pending.values())task.reject(new Error('Trail processing failed. Please retry.'));pending.clear();};
  }
  const requestId=++nextId;
  return new Promise<any>((resolve,reject)=>{
   const cleanup=()=>signal?.removeEventListener('abort',abort);
   const abort=()=>{pending.delete(requestId);worker?.postMessage({cancel:requestId});cleanup();reject(new DOMException('Cancelled','AbortError'));};
   signal?.addEventListener('abort',abort,{once:true});
   pending.set(requestId,{resolve:trail=>{cleanup();resolve(trail);},reject:error=>{cleanup();reject(error);}});worker!.postMessage({requestId,background,bird:{id:bird.id,revision:bird.revision,longitude:bird.longitude,latitude:bird.latitude,latestValidFixUtc:bird.latestValidFixUtc},start,end,overview});});
 };
}
const backgroundRequest=client(true),priorityRequest=client(false);
let backgroundTail:Promise<any>=Promise.resolve();
export function loadWindowTrail(bird:any,start:number,end:number,signal?:AbortSignal):Promise<any>{
 const task=backgroundTail.then(async()=>{await mapPriority.wait(signal);const trail=await backgroundRequest(bird,start,end,null,signal);await mapPriority.wait(signal);return trail;});
 backgroundTail=task.catch(()=>{});return task;
}
const cache=new Map<string,{at:number,promise:Promise<any>}>();
function loadPriorityTrail(bird:any,start:number|null,end:number|null){
 const key=bird.id+':'+start+':'+end,cached=cache.get(key);if(cached&&Date.now()-cached.at<600000)return cached.promise;
 const release=mapPriority.begin();
 const promise=priorityRequest(bird,start,end).finally(release).catch(error=>{if(cache.get(key)?.promise===promise)cache.delete(key);throw error;});
 cache.set(key,{at:Date.now(),promise});while(cache.size>8)cache.delete(cache.keys().next().value!);return promise;
}
export const loadFullTrail=(id:string)=>loadPriorityTrail({id},null,null);
export const loadSelectedWindowTrail=(bird:any,start:number,end:number)=>loadPriorityTrail(bird,start,end);

// Recent-map requests may fetch concurrently; geometry delivery still yields to
// selection and camera gestures. Each bounded cohort receives previews before detailed refinement.
export async function loadRecentTrail(bird:any,start:number,end:number,detail=false,signal?:AbortSignal){
 await mapPriority.wait(signal);
 const trail=await backgroundRequest(bird,start,end,detail?'detail':'preview',signal);
 await mapPriority.wait(signal);return trail;
}
