// Presentation only: Movebank names, identifiers, and league records remain unchanged.
// Keep this fixed list/order: numeric aliases must stay stable across devices,
// imports, and roster changes. The original number disambiguates repeated names.
const numericNames=['Ari','Robin','Charlie','Dakota','Elliot','Finley','Harper','Jules','Pip','Kai','Logan','Marley','Nico','Oakley','Parker','Avery','Quinn','Reese','Riley','Rowan','Sage','Sam','Scout','Shiloh','Sky','Sunny','Taylor','Toby','Wren','Alex','Jamie','Jack'];
function numericName(number){let index=0;for(const digit of number)index=(index*10+Number(digit))%numericNames.length;return `${numericNames[index]} (${number})`;}
function titleCase(name){
 return name.replace(/\p{L}[\p{L}\p{M}]*/gu,(word,offset)=>{
  // Preserve numbered place-name suffixes such as Frensdorf II-1.
  if(offset>0&&/\s/.test(name[offset-1])&&/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i.test(word))return word.toUpperCase();
  return word.toLowerCase().replace(/^\p{L}/u,letter=>letter.toUpperCase());
 });
}
export function birdName(value){
 if(value&&typeof value==='object')return value.displayName||birdName(value.name||value.id);
 const original=String(value??'').trim();
 const alias=original.match(/^([A-Za-z]+)\s*\((\d+)\)$/);
 if(alias&&alias[1].toLowerCase()===numericName(alias[2]).split(' ')[0].toLowerCase())return numericName(alias[2]);
 const hamburg=original.match(/^WHST-noband0*(\d+)-(.+)$/i);
 if(hamburg)return titleCase(`${hamburg[2].trim()} ${Number(hamburg[1])}`);
 let name=original.replace(/\s*\((?:https?:\/\/|www\.)[^)]*\)/gi,'').replace(/\s*\([^)]*\d[^)]*\)/g,'').replace(/\s*\/\s*(?:DER\b|e-?obs\b|OT\b).*$/i,'');
 const taggedLocation=/\s+colou?r\s+ring\b/i.test(name);
 name=name.replace(/\s+colou?r\s+ring\b.*$/i,'');
 // Ring codes and their accompanying numeric transmitter IDs, not numbered place names.
 // Support both code/number orders, including spaced and mixed codes (A6Y46).
 name=name.replace(/\s+e-?obs\s*$/i,'');
 name=name.replace(/\s+(?:[A-Z]{1,4}\s*\d{2,}|[A-Z]\s*\d\s*[A-Z]\s*\d{2,})\s+\d{4,}\s*$/i,'');
 name=name.replace(/\s+\d{4,}\s+(?:[A-Z]{1,4}\d{2,}|[A-Z]\s*\d\s*[A-Z]\s*\d{2,})\s*$/i,'');
 name=name.replace(/\s+(?:[A-Z]{1,4}\d{2,}|[A-Z]\s*\d\s*[A-Z]\s*\d{2,})\s*$/,'');
 if(taggedLocation)name=name.replace(/\s+(?:DEH|DER)$/i,'').replace(/^(?:19|20)\d{2}\s+/,'').replace(/\s+(?:19|20)\d{2}\s+.*$/,'');
 if(/^\d+$/.test(name.trim()))return numericName(name.trim());
 name=name.replace(/\+/g,' ').replace(/(\p{L})(\d)/gu,'$1 $2').replace(/\s*-\s*/g,'-').replace(/\b0+(\d+)\b/g,'$1').replace(/\s+/g,' ').trim();
 return titleCase(name||original);
}

// Resolve against the whole roster, before searching or filtering it. Preserve
// source names/IDs; the additional field is only a presentation label.
export function assignDisplayNames(birds){
 const key=s=>s.normalize('NFKC').toLocaleLowerCase('en-US');
 const groups=new Map(),labels=new Map(),used=new Set();
 const tags=b=>[...new Set([
  String(b.ringId||'').trim(),
  ...(String(b.name||'').match(/\b[A-Z]{1,4}\d{2,}\b/gi)||[]),
  ...(String(b.name||'').replace(/https?:\/\/\S+/g,'').match(/\b\d{4,}\b/g)||[]),
  String(b.individualId||'')
 ].filter(Boolean))].sort((a,b)=>a.length-b.length||a.localeCompare(b));
 for(const b of birds){const base=birdName(b.name),k=key(base);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({bird:b,base,tags:tags(b)});}
 // Reserve natural names first so an appended tag cannot collide with one.
 for(const group of groups.values())if(group.length===1){const {bird,base}=group[0];labels.set(bird.id,base);used.add(key(base));}
 for(const group of [...groups.values()].filter(g=>g.length>1).sort((a,b)=>a[0].base.localeCompare(b[0].base))){
  for(const item of [...group].sort((a,b)=>a.bird.id.localeCompare(b.bird.id))){
   const {bird,base}=item;
   const tag=item.tags.find(t=>!group.some(other=>other!==item&&other.tags.some(x=>key(x)===key(t)))&&!used.has(key(`${base} (${t})`)));
   let label=tag?`${base} (${tag})`:`${base} (${bird.id})`;
   // IDs are unique; this also handles an unusual literal name matching an ID label.
   while(used.has(key(label)))label=`${label} (${bird.id})`;
   labels.set(bird.id,label);used.add(key(label));
  }
 }
 return birds.map(b=>({...b,displayName:labels.get(b.id)}));
}
