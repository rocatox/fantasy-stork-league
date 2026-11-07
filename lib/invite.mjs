export function inviteCode(value){
 const text=String(value||'').trim();
 return /^\d{6}$/.test(text)?text:null;
}
export function newInviteCode(){
 const values=new Uint32Array(1);let n;
 do{crypto.getRandomValues(values);n=values[0];}while(n>=4294000000);
 return String(n%1000000).padStart(6,'0');
}
