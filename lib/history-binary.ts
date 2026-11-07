import {Buffer} from './native-buffer.mjs';
// Native base64 avoids a per-byte JS callback and spread/string conversion for
// every archive transfer. Respect view offsets (including sliced Buffers).
export function transportData(value:any):string {
 if(typeof value==='string')return value;
 if(value instanceof ArrayBuffer)return Buffer.from(value).toString('base64');
 if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString('base64');
 return Buffer.from(value).toString('base64');
}
export function storageData(value:string,binary:boolean):any {
 if(!binary)return value;
 const bytes=Buffer.from(value,'base64');
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}
