import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import StorkApp from '../../app/StorkApp';
import{playerUsername}from'../../lib/usernames.mjs';
import '../../app/globals.css';
// Simulate only the external identity-provider boundary, never a real account.
function Fixture(){
 const [signedIn,setSignedIn]=useState(false),[username,setUsername]=useState('');
 (window as any).setFixtureUsername=setUsername;
 const signIn=()=>setSignedIn(true);
 const auth={ready:true,signedIn,userId:signedIn?'new-player':null,displayName:playerUsername({username}),email:'player@example.test',getToken:async()=>signedIn?'isolated-player-token':null,signIn,signOut:()=>setSignedIn(false),manageAccount:()=>{},savePreferences:async()=>{},control:<button onClick={signIn}>{signedIn?'Isolated account':'Sign in with Google or email'}</button>};
 return <StorkApp auth={auth}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
