import {playerUsername} from '../lib/usernames.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider,SignInButton,UserButton,useAuth,useUser,useClerk} from '@clerk/react';
import StorkApp from '../app/StorkApp';
import '../app/globals.css';
function AuthenticatedApp(){const {getToken,isLoaded,isSignedIn,userId}=useAuth();const {user}=useUser();const clerk=useClerk();return <StorkApp auth={{getToken,ready:isLoaded,signedIn:isSignedIn,userId,displayName:playerUsername(user),profileControl:isSignedIn?<button onClick={()=>clerk.openUserProfile()}>Edit username / profile</button>:null,control:isSignedIn?<UserButton/>:<SignInButton mode="modal"><button className="primary">Sign in with Google or email</button></SignInButton>}}/>;}
async function start(){let key='';try{const r=await fetch('/api/config');if(r.ok)key=((await r.json()) as any).clerkPublishableKey||'';}catch{}createRoot(document.getElementById('root')!).render(key?<ClerkProvider publishableKey={key}><AuthenticatedApp/></ClerkProvider>:<StorkApp/>);}
start();
