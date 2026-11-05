// CSS pixel offsets relative to the viewport center keep the cursor anchor fixed.
export function zoomAt(camera,factor,x,y){
 const units=Math.max(.00001,Math.min(3,camera.units*factor));
 return {x:camera.x+x*(camera.units-units),y:camera.y+y*(camera.units-units),units};
}
export function wheelDelta(delta,mode,height){return Math.max(-240,Math.min(240,delta*(mode===1?16:mode===2?height:1)));}
