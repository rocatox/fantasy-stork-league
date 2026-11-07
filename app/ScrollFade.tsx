import {useEffect,useRef,type HTMLAttributes} from 'react';

/** Fade only while more content remains below; never obscure the final row. */
export default function ScrollFade({as='div',children,className='',...props}:HTMLAttributes<HTMLElement>&{as?:'div'|'ol'}){
 const ref=useRef<HTMLDivElement & HTMLOListElement>(null);
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  const update=()=>{el.dataset.moreBelow=String(el.scrollHeight-el.clientHeight-el.scrollTop>2);};
  const observer=new ResizeObserver(update);
  observer.observe(el);Array.from(el.children).forEach(child=>observer.observe(child));
  el.addEventListener('scroll',update,{passive:true});update();
  return()=>{observer.disconnect();el.removeEventListener('scroll',update);};
 },[children]);
 const Tag=as;
 return <Tag {...props} ref={ref} className={'scroll-fade '+className}>{children}</Tag>;
}
