export class RequestBodyError extends Error {
 constructor(public status:number,message:string){super(message);}
}
// Limit actual streamed bytes, not just the caller-controlled Content-Length.
export async function boundedJson(req:Request,max=16384){
 const declared=Number(req.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>max)throw new RequestBodyError(413,'Request is too large');
 const reader=req.body?.getReader();if(!reader)throw new RequestBodyError(400,'Invalid request');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){void reader.cancel().catch(()=>{});throw new RequestBodyError(413,'Request is too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RequestBodyError(400,'Invalid request');}
 }finally{reader.releaseLock();}
}
