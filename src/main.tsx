import {playerUsername} from '../lib/usernames.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider,SignInButton,UserButton,useAuth,useUser} from '@clerk/react';
import StorkApp from '../app/StorkApp';
import '../app/globals.css';
function AuthenticatedApp(){const {getToken,isLoaded,isSignedIn,userId}=useAuth();const {user}=useUser();return <StorkApp auth={{getToken,ready:isLoaded,signedIn:isSignedIn,userId,displayName:playerUsername(user),control:isSignedIn?<UserButton appearance={{elements:{avatarBox:{width:40,height:40},userButtonTrigger:{padding:2,minWidth:44,minHeight:44}}}}/>:<SignInButton mode="modal"><button className="primary" aria-label="Sign in with Google or email"><span className="signin-full">Sign in with Google or email</span><span className="signin-compact">Sign in</span></button></SignInButton>}}/>;}
async function start(){let key='';try{const r=await fetch('/api/config');if(r.ok)key=((await r.json()) as any).clerkPublishableKey||'';}catch{}createRoot(document.getElementById('root')!).render(key?<ClerkProvider publishableKey={key}><AuthenticatedApp/></ClerkProvider>:<StorkApp/>);}
start();
