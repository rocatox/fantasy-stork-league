// Presentation only: Movebank names, identifiers, and league records remain unchanged.
function titleCase(name){
 return name.replace(/\p{L}[\p{L}\p{M}]*/gu,(word,offset)=>{
  // Preserve numbered place-name suffixes such as Frensdorf II-1.
  if(offset>0&&/\s/.test(name[offset-1])&&/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i.test(word))return word.toUpperCase();
  return word.toLowerCase().replace(/^\p{L}/u,letter=>letter.toUpperCase());
 });
}
export function birdName(value){
 const original=String(value||'').trim();
 const hamburg=original.match(/^WHST-noband0*(\d+)-(.+)$/i);
 if(hamburg)return titleCase(`${hamburg[2].trim()} ${Number(hamburg[1])}`);
 let name=original.replace(/\s*\((?:https?:\/\/|www\.)[^)]*\)/gi,'').replace(/\s*\([^)]*\d[^)]*\)/g,'').replace(/\s*\/\s*(?:DER\b|e-?obs\b|OT\b).*$/i,'');
 // Ring codes and their accompanying numeric transmitter IDs, not numbered place names.
 name=name.replace(/\s+(?:\d{4,}\s+)?[A-Z]{1,4}\d{2,}\s*$/,'');
 name=name.replace(/(\p{L})(\d)/gu,'$1 $2').replace(/\s*-\s*/g,'-').replace(/\b0+(\d+)\b/g,'$1').replace(/\s+/g,' ').trim();
 return titleCase(name||original);
}
