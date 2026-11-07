import {env} from 'cloudflare:workers';
import {createClerkClient} from '@clerk/backend';
let client:ReturnType<typeof createClerkClient>|undefined;
export function clerkClient(){return client??=createClerkClient({secretKey:(env as any).CLERK_SECRET_KEY,publishableKey:(env as any).CLERK_PUBLISHABLE_KEY});}
