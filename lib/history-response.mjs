// Fragments come only from SQLite json_extract on validated stored preview arrays.
// Keep their JSON representation intact: large timelines need not allocate every
// coordinate as a JS object and then serialize those same objects again.
export function historyResponse(metadata,previews){
 const parts=[];
 for(const preview of previews){
  if(preview==null)continue;
  const value=preview.trim();
  if(value==='null')continue;
  if(!value.startsWith('[')||!value.endsWith(']'))throw Error('Invalid stored history preview');
  const inner=value.slice(1,-1).trim();if(inner)parts.push(inner);
 }
 const body=JSON.stringify(metadata);
 return new Response(body.slice(0,-1)+(body==='{}'?'':',')+'"points":['+parts.join(',')+']}',{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
