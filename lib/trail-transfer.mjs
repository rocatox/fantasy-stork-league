// Reassemble worker chunks without screening, sorting or rebuilding geometry.
export function receiveTrail(task,data){
 if(data.error||data.trail)return true;
 if(data.header){task.arrays=Array.from({length:data.header.tolerances.length+2},()=>[]);task.header=data.header;return false;}
 if(data.chunk){task.arrays[data.field].push(...data.chunk);return false;}
 if(data.complete){const [points,segments,...levels]=task.arrays;data.trail={points,segments:task.header.segmentsFromLod===undefined?segments:levels[task.header.segmentsFromLod],bounds:task.header.bounds,lods:task.header.tolerances.map((tolerance,i)=>({tolerance,segments:levels[i]}))};return true;}
 return false;
}
