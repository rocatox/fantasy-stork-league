import {spawnSync} from 'node:child_process';
const scenarios=[[64,1,24,0],[100,10,24,0],[200,25,24,0],[200,50,3,1]];
for(const args of scenarios){const run=spawnSync(process.execPath,['tests/race-capacity-rehearsal.mjs',...args.map(String)],{stdio:'inherit'});if(run.status!==0)process.exit(run.status||1);}
const history=spawnSync(process.execPath,['tests/race-capacity-history.mjs'],{stdio:'inherit'});process.exit(history.status??1);
