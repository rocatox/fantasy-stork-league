import {receiveTrail} from './trail-transfer.mjs';
let worker:Worker|null=null,nextId=0;
const pending=new Map<number,{resolve:(trail:any)=>void,reject:(error:Error)=>void}>();
export function loadWindowTrail(bird:any,start:number|null,end:number|null):Promise<any>{
 if(!worker){
  worker=new Worker(new URL('./trail-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const task=pending.get(data.requestId);if(!task)return;if(!receiveTrail(task,data))return;pending.delete(data.requestId);if(data.error)task.reject(new Error(data.error));else task.resolve(data.trail);};
  worker.onerror=()=>{worker?.terminate();worker=null;for(const task of pending.values())task.reject(new Error('Trail processing failed. Please retry.'));pending.clear();};
 }
 const requestId=++nextId;
 return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});worker!.postMessage({requestId,bird:{id:bird.id,longitude:bird.longitude,latitude:bird.latitude,latestValidFixUtc:bird.latestValidFixUtc},start,end});});
}

// Keep selected-history work off the UI thread too. A separate worker prevents
// a selection from sitting behind every background bird's geometry preparation.
let fullWorker:Worker|null=null,fullId=0;
const fullPending=new Map<number,{resolve:(trail:any)=>void,reject:(error:Error)=>void}>();
const fullCache=new Map<string,{at:number,promise:Promise<any>}>();
export function loadFullTrail(id:string):Promise<any>{
 const cached=fullCache.get(id);if(cached&&Date.now()-cached.at<600000)return cached.promise;
 if(!fullWorker){
  fullWorker=new Worker(new URL('./trail-worker.ts',import.meta.url),{type:'module'});
  fullWorker.onmessage=({data})=>{const task=fullPending.get(data.requestId);if(!task)return;if(!receiveTrail(task,data))return;fullPending.delete(data.requestId);if(data.error)task.reject(new Error(data.error));else task.resolve(data.trail);};
  fullWorker.onerror=()=>{fullWorker?.terminate();fullWorker=null;for(const task of fullPending.values())task.reject(new Error('Trail processing failed.'));fullPending.clear();fullCache.clear();};
 }
 const requestId=++fullId;
 const promise=new Promise<any>((resolve,reject)=>{fullPending.set(requestId,{resolve,reject});fullWorker!.postMessage({requestId,bird:{id},start:null,end:null});}).catch(error=>{if(fullCache.get(id)?.promise===promise)fullCache.delete(id);throw error;});
 fullCache.set(id,{at:Date.now(),promise});while(fullCache.size>8)fullCache.delete(fullCache.keys().next().value!);
 return promise;
}
export const prefetchFullTrail=(id:string)=>{loadFullTrail(id).catch(()=>{});};
