// D1 returns BLOBs as byte arrays. JSON transport remains base64; storage does not.
export function transportData(value:any):string {
 if(typeof value==='string')return value;
 const bytes=new Uint8Array(value instanceof ArrayBuffer?value:value?.buffer&&ArrayBuffer.isView(value)?value.buffer:value);
 let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}
export function storageData(value:string,binary:boolean):any {
 if(!binary)return value;
 const text=atob(value);return Uint8Array.from(text,c=>c.charCodeAt(0)).buffer;
}
