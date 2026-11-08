import {env} from 'cloudflare:workers';
import {reverificationErrorResponse} from '@clerk/backend/internal';
import {getSession} from '../../../lib/auth';
import {clerkClient} from '../../../lib/clerk-client';
import {boundedJson,RequestBodyError} from '../../../lib/bounded-json';
import {json,safeWrite} from '../../../lib/store';
import {beginDeletion} from '../../../lib/account-deletion';
import {deletionEnabled} from '../../../lib/account-deletion-state';
export async function POST(req:Request){
 if(!safeWrite(req))return json({error:'Same-origin JSON required'},403);
 const config:any=env;if(!deletionEnabled(config))return json({error:'Account deletion is temporarily unavailable.'},503);
 const session:any=await getSession(req,true);if(!session)return json({error:'Sign in to delete your account.'},401);
 let body:any;try{body=await boundedJson(req,1024);}catch(e){return json({error:e instanceof RequestBodyError?e.message:'Invalid request'},e instanceof RequestBodyError?e.status:400);}
 if(body?.action!=='delete'||body?.confirmation!=='DELETE')return json({error:'Type DELETE to confirm permanent account deletion.'},400);
 const existing=await config.DB.prepare('SELECT status FROM account_deletions WHERE user_id=?').bind(session.userId).first();
 if(existing)return json({accepted:true,status:existing.status},202);
 if(!session.has({reverification:'strict'})){
  const response=reverificationErrorResponse('strict');response.headers.set('Cache-Control','no-store');return response;
 }
 await clerkClient().users.getUser(session.userId);
 const result=await beginDeletion(config,session.userId);
 if(!result.accepted)return json({error:'A background update is finishing. Please retry deletion shortly.'},409);
 return json(result,202);
}
