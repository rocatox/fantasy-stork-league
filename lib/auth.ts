import {deletionEnabled} from './account-deletion-state';
import {SessionError} from './auth-error';
import {playerUsername} from './usernames.mjs';
import {env} from 'cloudflare:workers';
import {clerkClient} from './clerk-client';
export async function getSession(req:Request,allowDeleting=false){const config=env as any;if(!config.CLERK_SECRET_KEY||!config.CLERK_PUBLISHABLE_KEY||!config.APP_ORIGIN)throw new SessionError('auth-configuration','Sign-in configuration is unavailable.');
 // No credentials can produce an authenticated session. Preserve Clerk validation
 // for every supplied Authorization header or cookie, including invalid/empty ones.
 if(!req.headers.has('authorization')&&!req.headers.has('cookie'))return null;
 const client=clerkClient();
 const state=await client.authenticateRequest(req,{authorizedParties:[config.APP_ORIGIN,config.LEGACY_APP_ORIGIN].filter(Boolean),acceptsToken:'session_token'});
 if(!state.isAuthenticated){if(!req.headers.has('authorization'))return null;const code=String(state.reason||'session-unverified').replace(/[^a-z0-9-]/gi,'').slice(0,80);throw new SessionError(code,'Your session could not be verified. Please sign out and sign in again.');}const auth=state.toAuth();if(!auth?.userId){if(auth?.sessionStatus==='pending')throw new SessionError('session-pending','Finish the account setup requested by Clerk, then sign in again.');throw new SessionError('session-inactive','Your session is not active. Please sign in again.');}
 if(!allowDeleting&&deletionEnabled(config)&&await config.DB.prepare('SELECT 1 FROM account_deletions WHERE user_id=?').bind(auth.userId).first())throw new SessionError('account-deleted','This account is being deleted.');
 return auth;
}
export async function getUser(req:Request,includeProfile=false){
 const auth=await getSession(req);if(!auth)return null;
 const user=includeProfile?await clerkClient().users.getUser(auth.userId):null;
 return {userId:auth.userId,displayName:playerUsername(user)};
}
