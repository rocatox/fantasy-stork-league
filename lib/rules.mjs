export const DAY=86400000;
export function eligible(b, now=Date.now()) { const age=now-Date.parse(b.latestValidFixUtc);return Number.isFinite(age)&&age>=0&&age<=30*DAY&&b.distanceToGermanyMiles>450&&b.countryCode!=='DE'&&!b.recordedDead&&b.currentDeployment===true&&!b.reviewRequired; }
export function teamSize(count,players){return Math.min(6,Math.floor(count/players));}
export function turn(pick,players){const round=Math.floor(pick/players);return round%2===0?pick%players:players-1-pick%players;}
export function cutoff(year){return Date.parse(`${year}-01-16T05:00:00Z`);}
export function points(count,rank){return Math.max(0,count-rank+1);}
