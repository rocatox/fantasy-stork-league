export function inviteCode(value,origin='https://storkleague.fans'){
 const text=String(value||'').trim();
 if(/^[a-f0-9]{32}$/i.test(text))return text;
 try{const url=new URL(text);if(!['https:','http:'].includes(url.protocol)||url.origin!==origin)return null;const code=url.searchParams.get('invite');return /^[a-f0-9]{32}$/i.test(code||'')?code:null;}catch{return null;}
}
