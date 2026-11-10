// Source labels can change. Never fall back to a reused name when a stable ID exists.
export function sourceIndividual(bird, individuals) {
 const id=bird.individualId||bird.archiveState?.individualId;
 const matches=(individuals||[]).filter(a=>id?String(a.id)===String(id):a.local_identifier===bird.name);
 if(matches.length>1)throw Error('Ambiguous source individual identity');
 return matches[0];
}
