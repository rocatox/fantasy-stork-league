import {useRef,useState} from 'react';
export default function DeleteAccount({auth}:any){
 const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[error,setError]=useState('');
 const sending=useRef(false);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(sending.current||confirmation!=='DELETE')return;sending.current=true;setBusy(true);setError('');
  try{
   const response=await auth.deleteAccount();if(!response)return;
   const result=await response.json();if(!response.ok||!result.accepted)throw Error(result.error||'Deletion could not be started. Please try again.');
   setAccepted(true);
   // Browser-local data is separate from Clerk/database storage. Other
   // devices cannot have their local browser storage erased remotely.
   try{localStorage.removeItem('stork-preferences:'+auth.userId);localStorage.removeItem('stork-stars-v1');sessionStorage.removeItem('stork-view');}catch{}
   await auth.signOut?.();
  }catch(e:any){setError(e.message||'Deletion could not be started. Please try again.');}
  finally{sending.current=false;setBusy(false);}
 }
 return <details className="help-disclosure account-delete"><summary>Delete account <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></summary>
  {accepted?<p role="status">Deletion has started. Account access and future app email are blocked; cleanup will continue automatically. You can close this page.</p>:<form className="bug-form" onSubmit={submit}>
   <p>This permanently deletes your account, private lists, preferences, notifications and reports. Invite-stage membership is removed. Hosting passes to the longest-standing remaining manager, or the first remaining manager in stored order for older leagues without join-order records. An empty league is disbanded.</p>
   <p>After drafting starts, your roster and historical results remain as <b>Deleted manager</b>. Pending trades involving you are cancelled. An unfinished draft still expires at the normal deadline. Encrypted backup copies expire through backup rotation; already delivered emails cannot be recalled.</p>
   <p>You will be signed out. Cleanup runs automatically and retries temporary failures. This cannot be undone.</p>
   <label className="deletion-confirmation">Type DELETE to confirm<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} maxLength={6} disabled={busy} required/></label>
   {error&&<p className="bug-error" role="alert">{error}</p>}<div className="bug-actions"><button type="submit" disabled={busy||confirmation!=='DELETE'||!auth?.deleteAccount}>{busy?'Starting deletion…':'Permanently delete my account'}</button></div>
  </form>}
 </details>;
}
