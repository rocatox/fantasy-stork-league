import {easternParts,syncPolicy} from './sync-policy.mjs';
export const MAX_LEAGUES=6;
export function membershipYear(now=Date.now()){const p=easternParts(now);return Number(p.year)+(Number(p.month)>6?1:0);}
export function activeMembership(l,now=Date.now()){return l.status!=='disbanded'&&l.year>=membershipYear(now);}
export function entryOpen(now=Date.now()){return !syncPolicy(now).racing;}
