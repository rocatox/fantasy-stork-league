// Tracking duration is a lower bound, never an inferred hatch date.
export function profileAge(bird,first,now=Date.now()){
 const valid=v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
 if(valid(bird.ageYears))return Number(bird.ageYears).toFixed(1)+' years';
 const tracked=first? (now-Date.parse(first))/(365.2425*86400000):NaN;
 const bounds=[valid(bird.minimumAgeYears)?Number(bird.minimumAgeYears):NaN,tracked].filter(v=>Number.isFinite(v)&&v>=0);
 // Round down so the displayed lower bound never overstates known age.
 return bounds.length?'At least '+(Math.floor(Math.max(...bounds)*10)/10).toFixed(1)+' years':'Not recorded';
}
