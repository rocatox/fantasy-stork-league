// Recheck on resume: mobile browsers can miss media-query changes while suspended.
export function watchDevicePreferences(win, doc, notify) {
 const dark=win.matchMedia('(prefers-color-scheme: dark)');
 const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
 const update=()=>notify({dark:dark.matches,reduced:motion.matches});
 update();
 dark.addEventListener('change',update);motion.addEventListener('change',update);
 win.addEventListener('pageshow',update);win.addEventListener('focus',update);doc.addEventListener('visibilitychange',update);
 return()=>{dark.removeEventListener('change',update);motion.removeEventListener('change',update);win.removeEventListener('pageshow',update);win.removeEventListener('focus',update);doc.removeEventListener('visibilitychange',update);};
}
export function resolvedPreferences(value, device) {
 return {dark:value.appearance==='dark'||value.appearance==='system'&&device.dark,reduced:value.motion==='reduce'||value.motion==='system'&&device.reduced};
}
