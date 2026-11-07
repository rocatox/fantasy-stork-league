const ignored=new Set(['','NOBAND','NORING','UNKNOWN','NA','NONE']);
export function reviewDuplicateRings(birds){
 const key=b=>String(b.ringId??'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 const owners=new Map();
 for(const b of birds){const k=key(b);if(ignored.has(k))continue;let ids=owners.get(k);if(!ids)owners.set(k,ids=new Set());ids.add(b.id);}
 return birds.map(b=>owners.get(key(b))?.size>1?{...b,duplicateRingReview:true,reviewRequired:true}:b);
}
