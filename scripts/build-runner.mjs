import {build} from 'esbuild';
await build({entryPoints:['scripts/sync-runner.ts'],outfile:'.runner/sync.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
await build({entryPoints:['scripts/history-runner.ts'],outfile:'.runner/history.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
