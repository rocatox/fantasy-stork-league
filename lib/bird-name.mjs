// Presentation only: Movebank names, identifiers, and league records remain unchanged.
export function birdName(value){
 const original=String(value||'').trim();
 const hamburg=original.match(/^WHST-noband0*(\d+)-(.+)$/i);
 if(hamburg)return `${hamburg[2].trim()} ${Number(hamburg[1])}`;
 let name=original.replace(/\s*\([^)]*\d[^)]*\)/g,'').replace(/\s*\/\s*(?:DER\b|e-?obs\b|OT\b).*$/i,'');
 // Ring codes and their accompanying numeric transmitter IDs, not numbered place names.
 name=name.replace(/\s+(?:\d{4,}\s+)?[A-Z]{1,4}\d{2,}\s*$/,'');
 name=name.replace(/(\p{L})(\d)/gu,'$1 $2').replace(/\s*-\s*/g,'-').replace(/\b0+(\d+)\b/g,'$1').replace(/\s+/g,' ').trim();
 return name||original;
}
