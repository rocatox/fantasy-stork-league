// Resolve nearby map markers by distance rather than SVG paint order.
export function nearbyMarkers(markers,x,y,radius){
 return markers.map(m=>({...m,distance:(m.x-x)**2+(m.y-y)**2})).filter(m=>m.distance<=radius*radius).sort((a,b)=>a.distance-b.distance||String(a.bird.id).localeCompare(String(b.bird.id))).map(m=>m.bird);
}
export function nearestMarker(markers,x,y,radius){return nearbyMarkers(markers,x,y,radius)[0]||null;}
