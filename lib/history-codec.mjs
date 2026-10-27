import {gzipSync,gunzipSync} from 'node:zlib';
// Keep original field values, including coordinate strings and source flags.
export function encodeHistory(rows){
 const columns=Array.from({length:7},(_,i)=>rows.map(r=>r[i]));
 return gzipSync(JSON.stringify({version:2,columns}),{level:9});
}
export function decodeHistory(bytes){
 const value=JSON.parse(gunzipSync(bytes).toString());
 if(Array.isArray(value))return value; // Original row-oriented archives.
 if(value?.version!==2||!Array.isArray(value.columns)||value.columns.length!==7||!value.columns.every(c=>Array.isArray(c)&&c.length===value.columns[0].length))throw Error('Invalid history archive');
 return value.columns[0].map((_,i)=>value.columns.map(c=>c[i]));
}
