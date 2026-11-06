import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {authenticatedFetch} from '../lib/authenticated-fetch.mjs';
import {NOTIFICATION_CATEGORIES,notificationDefaults} from '../lib/notifications.mjs';
import './Notifications.css';
const Context=createContext<any>(null);
export const useNotifications=()=>useContext(Context);
export function NotificationsProvider({auth,children}:any){
 const [data,setData]=useState<any>({items:[],unread:0,preferences:notificationDefaults}),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const authRef=useRef(auth),seq=useRef(0),saving=useRef(false),pending=useRef(false);authRef.current=auth;
 async function request(body?:any){
  if(!authRef.current?.signedIn||(!body&&(saving.current||pending.current)))return;
  if(body&&saving.current)return;
  const owner=authRef.current.userId,n=++seq.current;
  if(body){saving.current=true;setBusy(true);}else{pending.current=true;setLoading(true);}
  try{const r=await authenticatedFetch(authRef.current.getToken,'/api/notifications',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Could not load notifications');if(n===seq.current&&owner===authRef.current?.userId){setData(d);setError('');setLoaded(true);}}
  catch(e:any){if(n===seq.current)setError(e.message||'Notifications unavailable.');}
  finally{if(body){saving.current=false;setBusy(false);}else{pending.current=false;setLoading(false);}}
 }
 useEffect(()=>{++seq.current;setData({items:[],unread:0,preferences:notificationDefaults});setError('');setLoaded(false);if(auth?.ready&&auth?.signedIn)request();},[auth?.ready,auth?.signedIn,auth?.userId]);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')request();};const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[]);
 return <Context.Provider value={{...data,error,loading,busy,loaded,signedIn:!!auth?.signedIn,refresh:()=>request(),write:request}}>{children}</Context.Provider>;
}
export function NotificationSettings(){const n=useNotifications();return <section className="settings-card notification-settings"><h2>Notifications</h2>{!n.signedIn?<p>Sign in to manage in-app notifications.</p>:<><p>Updates appear in the bell while you use the app. Your choices and read status sync across devices.</p>{NOTIFICATION_CATEGORIES.map(([key,label,description])=><label className="settings-row" key={key}><span><b>{label}</b><small>{description}</small></span><input type="checkbox" checked={n.preferences[key]} disabled={n.busy||!n.loaded} onChange={e=>n.write({action:'preferences',preferences:{[key]:e.target.checked}})}/></label>)}<div className="settings-save" role="status">{n.busy?'Saving…':n.loading&&!n.loaded?'Loading…':n.error||'Saved automatically. No push or email messages.'}{n.error&&<button onClick={n.refresh}>Retry</button>}</div></>}</section>;}
export function NotificationBell({onLeague}:any){
 const n=useNotifications(),[open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 useEffect(()=>{if(!n.signedIn)setOpen(false);},[n.signedIn]);
 if(!n.signedIn)return null;
 return <><button className="notification-bell" type="button" aria-label={`Notifications${n.unread?', '+n.unread+' unread':''}`} title="Notifications" onClick={()=>{setOpen(true);n.refresh();}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{n.unread>0&&<span>{n.unread>9?'9+':n.unread}</span>}</button><dialog ref={dialog} className="notifications-dialog" aria-labelledby="notifications-title" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}><div className="notifications-heading"><h2 id="notifications-title">Notifications</h2><button aria-label="Close notifications" onClick={()=>setOpen(false)}>×</button></div><div className="notifications-toolbar"><span>{n.unread} unread</span><button disabled={!n.unread||n.busy} onClick={()=>n.write({action:'readAll'})}>Mark all read</button></div>{n.error&&<p role="alert">{n.error} <button onClick={n.refresh}>Retry</button></p>}{!n.loaded&&!n.error?<p>Loading notifications…</p>:!n.items.length?<p className="notifications-empty">You’re all caught up. Draft, trade and race updates will appear here.</p>:<ul>{n.items.map((item:any)=><li key={item.id} className={item.read?'':'notification-unread'}><button className="notification-item" onClick={()=>{n.write({action:'read',id:item.id});setOpen(false);onLeague(item.leagueId);}}><span className="notification-meta"><span>{item.leagueName}</span><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time></span><b>{item.title}{!item.read&&<span className="notification-dot" aria-label="Unread"/>}</b><span className="notification-body">{item.body}</span><span className="notification-link">View league →</span></button></li>)}</ul>}</dialog></>;
}
