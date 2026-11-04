export const defaults={appearance:'system',motion:'system',units:'mi'};
export function preferences(value){return {appearance:['light','dark','system'].includes(value?.appearance)?value.appearance:'system',motion:['system','reduce','full'].includes(value?.motion)?value.motion:'system',units:value?.units==='km'?'km':'mi'};}
export function distanceValue(miles,units){return Number.isFinite(miles)?Math.round(miles*(units==='km'?1.609344:1)).toLocaleString():'—';}
