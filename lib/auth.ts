import {env} from 'cloudflare:workers';
import {createClerkClient} from '@clerk/backend';
export async function getUser(req:Request,includeProfile=false){const config=env as any;if(!config.CLERK_SECRET_KEY||!config.CLERK_PUBLISHABLE_KEY||!config.APP_ORIGIN)return null;
 const client=createClerkClient({secretKey:config.CLERK_SECRET_KEY,publishableKey:config.CLERK_PUBLISHABLE_KEY});
 const state=await client.authenticateRequest(req,{authorizedParties:[config.APP_ORIGIN,config.LEGACY_APP_ORIGIN].filter(Boolean),acceptsToken:'session_token'});
 if(!state.isAuthenticated)return null;const auth=state.toAuth();if(!auth?.userId)return null;
 const user=includeProfile?await client.users.getUser(auth.userId):null;
 const displayName=user?([user.firstName,user.lastName].filter(Boolean).join(' ').trim()||user.username||''):'';
 return {userId:auth.userId,displayName:displayName.slice(0,100)};
}

