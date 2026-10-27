import {SessionError} from './auth-error';
import {playerUsername} from './usernames.mjs';
import {env} from 'cloudflare:workers';
import {createClerkClient} from '@clerk/backend';
export async function getUser(req:Request,includeProfile=false){const config=env as any;if(!config.CLERK_SECRET_KEY||!config.CLERK_PUBLISHABLE_KEY||!config.APP_ORIGIN)throw new SessionError('auth-configuration','Sign-in configuration is unavailable.');
 const client=createClerkClient({secretKey:config.CLERK_SECRET_KEY,publishableKey:config.CLERK_PUBLISHABLE_KEY});
 const state=await client.authenticateRequest(req,{authorizedParties:[config.APP_ORIGIN,config.LEGACY_APP_ORIGIN].filter(Boolean),acceptsToken:'session_token'});
 if(!state.isAuthenticated){if(!req.headers.has('authorization'))return null;const code=String(state.reason||'session-unverified').replace(/[^a-z0-9-]/gi,'').slice(0,80);throw new SessionError(code,'Your session could not be verified. Please sign out and sign in again.');}const auth=state.toAuth();if(!auth?.userId){if(auth?.sessionStatus==='pending')throw new SessionError('session-pending','Finish the account setup requested by Clerk, then sign in again.');throw new SessionError('session-inactive','Your session is not active. Please sign in again.');}
 const user=includeProfile?await client.users.getUser(auth.userId):null;
 const displayName=playerUsername(user);
 return {userId:auth.userId,displayName};
}

