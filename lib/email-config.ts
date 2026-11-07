import {env} from 'cloudflare:workers';
export function emailConfigured(config:any=env){return config.EMAIL_ENABLED==='true'&&!!config.BREVO_API_KEY&&!!config.CLERK_SECRET_KEY&&/^[a-z0-9._+-]+@notify\.storkleague\.fans$/i.test(config.EMAIL_FROM||'')&&config.APP_ORIGIN==='https://storkleague.fans';}
