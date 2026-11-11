import {useRef,useState} from 'react';
import {authenticatedFetch} from '../lib/authenticated-fetch.mjs';

// No custom focus management: keep the keyboard/focus rollback intact.
export default function AccountPrivacy({auth}:any){
 const [kind,setKind]=useState('Privacy question'),[reply,setReply]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState('');
 const attempt=useRef<{body:string,id:string}|null>(null),sending=useRef(false);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(sending.current)return;sending.current=true;setBusy(true);setError('');
  try{
   const body=JSON.stringify({title:kind,area:'privacy',description:`Reply address: ${reply.trim()}\n\n${message.trim()}`});
   if(attempt.current?.body!==body)attempt.current={body,id:crypto.randomUUID()};
   const response=await authenticatedFetch(auth.getToken,'/api/bug-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),id:attempt.current.id})});
   const result=await response.json() as {id?:string,error?:string};
   if(!response.ok||!result.id)throw Error(result.error||'Could not send your request. Please try again.');
   setReceipt(result.id);setMessage('');setReply('');attempt.current=null;
  }catch(e:any){setError(e.message||'Could not send your request. Please try again.');}
  finally{sending.current=false;setBusy(false);}
 }
 return <details className="help-disclosure account-privacy">
  <summary>Privacy & account data <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></summary>
  <div className="privacy-information">
   <p>Fantasy Stork League uses account and game information to run private leagues, save your preferences and lists, and deliver the notifications you choose.</p>
   <h3>What is stored</h3><p>Clerk manages sign-in, your username, profile photo, email and connected accounts. The app stores league membership, drafts, trades, swaps, results, lists, notification settings and history, and reports you submit. Browser storage keeps device preferences, starred birds and navigation state. Bird tracking data comes from the approved studies; it does not track your location.</p>
   <h3>Who can access it</h3><p>Managers in your leagues can see your league identity, roster and game activity. Reports and privacy requests are private to the app operator. Cloudflare hosts the app and databases; Clerk handles identity; Brevo delivers email. GitHub Actions processes imports and backups, and the operator’s Google Drive stores encrypted backups. Private records are not published in the public source repository.</p>
   <h3>Retention and deletion</h3><p>In-app notifications retain up to 200 events for up to 90 days. Private account data is removed when automatic account deletion is processed. Historical league results retain the roster under “Deleted manager”; player-written league names remain. A minimal private deletion receipt is retained to prevent old sessions or restored records from recreating the account. Encrypted backups rotate through seven daily and four weekly recovery points; deletion from the live app does not immediately erase older backup copies, emails already delivered, or service-provider logs.</p>
   <p>Automatic account deletion removes invite-stage membership and transfers hosting to the longest-standing remaining manager. Older drafted leagues without join-order records use the first remaining manager in stored order. After drafting starts, rosters and historical results are preserved as “Deleted manager.” An unfinished draft still follows the normal deadline rules. Use Delete account below to start automatic deletion. The privacy-request form only sends a request for review. Browser-local settings and stars are cleared on the device used for deletion; clear browser storage on other devices separately.</p>
   <h3>Your choices</h3><p>Manage your identity above and control in-app and email notifications separately in Settings. Use this form for privacy questions, a copy or correction of account data, or a deletion request. Include a reply address you can access. Do not include passwords, sign-in codes or API keys.</p>
  </div>
  {!auth?.signedIn?<div className="help-content"><p>Sign in to send a private account-data request.</p><button disabled={!auth?.ready} onClick={()=>auth?.signIn?.()}>Sign in to send a request</button></div>:receipt?<div className="help-content"><p role="status">Your request was saved privately for review. No account changes have been made.</p><small className="bug-receipt">Reference: {receipt}</small><button onClick={()=>{setReceipt('');setError('');}}>Send another request</button></div>:<form className="bug-form" onSubmit={submit}>
   <p>Your request and reply address are stored privately and emailed to the app operator. The operator’s personal address is not displayed.</p>
   <fieldset disabled={busy}><label>Request type<select value={kind} onChange={e=>setKind(e.target.value)}>{['Privacy question','Copy of my account data','Correct my account data','Help with account deletion'].map(k=><option key={k}>{k}</option>)}</select></label><label>Reply email<input type="email" autoComplete="email" maxLength={254} required value={reply} onChange={e=>setReply(e.target.value)}/></label><label className="bug-description">Request details<textarea value={message} onChange={e=>setMessage(e.target.value)} minLength={10} maxLength={3500} required rows={4}/></label></fieldset>
   {error&&<p className="bug-error" role="alert">{error}</p>}<div className="bug-actions"><small>{message.length.toLocaleString()} / 3,500</small><button type="submit" className="primary" disabled={busy}>{busy?'Sending…':'Send private request'}</button></div>
  </form>}
 </details>;
}
