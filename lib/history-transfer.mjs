import {encodeHistory,decodeHistory} from './history-codec.mjs';
export async function readArchive(api,birdId,lease,month){
 const previous=await api({action:'read',birdId,lease,month,manifest:true});
 if(previous.parts){const pieces=[];for(let part=0;part<previous.parts.count;part++)pieces.push((await api({action:'readPart',birdId,lease,month,generation:previous.parts.generation,part})).data);previous.data=pieces.join('');}
 return previous.data?decodeHistory(Buffer.from(previous.data,'base64')):[];
}
export async function writeArchive(api,birdId,lease,month,rows,summary){
 const bytes=encodeHistory(rows);let data=bytes.toString('base64');
 if(data.length>500000){const count=Math.ceil(data.length/500000);for(let part=0;part<count;part++)await api({action:'part',birdId,lease,month,part,binary:true,data:data.slice(part*500000,(part+1)*500000)});data=`parts:${lease}:${count}`;}
 await api({action:'chunk',birdId,lease,month,data,binary:true,summary});
 // Verify every retained field through the actual database read path before pruning.
 const readback=await readArchive(api,birdId,lease,month);
 if(JSON.stringify(readback)!==JSON.stringify(rows))throw Error('Archive verification failed; legacy copy preserved');
 await api({action:'pruneLegacy',birdId,lease,month,verifiedSummary:summary});
 return bytes.length;
}
