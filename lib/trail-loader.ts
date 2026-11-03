let worker:Worker|null=null,nextId=0;
const pending=new Map<number,{resolve:(trail:any)=>void,reject:(error:Error)=>void}>();
export function loadWindowTrail(bird:any,start:number,end:number):Promise<any>{
 if(!worker){
  worker=new Worker(new URL('./trail-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const task=pending.get(data.requestId);if(!task)return;pending.delete(data.requestId);if(data.error)task.reject(new Error(data.error));else task.resolve(data.trail);};
  worker.onerror=()=>{worker?.terminate();worker=null;for(const task of pending.values())task.reject(new Error('Trail processing failed. Please retry.'));pending.clear();};
 }
 const requestId=++nextId;
 return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});worker!.postMessage({requestId,bird:{id:bird.id,longitude:bird.longitude,latitude:bird.latitude,latestValidFixUtc:bird.latestValidFixUtc},start,end});});
}
