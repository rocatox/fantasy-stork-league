// Local ground scale for the spherical Mercator display (not race measurement).
export function mapScale(camera,height,units='mi',maxPixels=100){
 const worldY=camera.y+(height/2-22)*camera.units;
 const latitude=Math.atan(Math.sinh(Math.PI*(1-2*worldY/1024)));
 const kmPerPixel=40075.016686*Math.cos(latitude)*camera.units/1024;
 const perPixel=kmPerPixel/(units==='km'?1:1.609344);
 if(!(perPixel>0)||!Number.isFinite(perPixel))return null;
 const maxDistance=perPixel*maxPixels,power=10**Math.floor(Math.log10(maxDistance));
 const distance=[5,2,1].map(n=>n*power).find(n=>n<=maxDistance)||power;
 return {distance,pixels:distance/perPixel,units:units==='km'?'km':'mi'};
}
