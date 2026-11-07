// Six attempts can fit inside the existing 14-minute ambiguity cutoff.
const BACKOFF_SECONDS=[60,60,120,180,240,240];
export function nextEmailRetry(now,attempts,retryAfter){
 const seconds=retryAfter==null?NaN:Number(retryAfter);
 const providerAt=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(retryAfter||'');
 return Math.max(now+BACKOFF_SECONDS[Math.min(Math.max(0,attempts-1),5)]*1000,Number.isFinite(providerAt)?providerAt:0);
}
export async function recordEmailCooldown(db,until){
 await db.prepare("INSERT INTO sync_state(id,payload) VALUES('email-provider-cooldown',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify({until})).run();
}
