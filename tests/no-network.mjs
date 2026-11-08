// CI preload: unexpected backend HTTP fails before it can reach a real service.
// Individual integration fixtures replace fetch with their explicit mock.
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const blocked=()=>{throw new Error('External HTTP disabled in isolated regression tests; install an explicit mock');};
globalThis.fetch=async()=>blocked();
http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;
syncBuiltinESMExports();
