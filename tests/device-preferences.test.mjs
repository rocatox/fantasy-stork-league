import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchDevicePreferences,resolvedPreferences} from '../lib/device-preferences.mjs';
test('system appearance is resolved on each device, never copied from another device',()=>{
 const value={appearance:'system',motion:'system'};
 assert.deepEqual(resolvedPreferences(value,{dark:false,reduced:false}),{dark:false,reduced:false});
 assert.deepEqual(resolvedPreferences(value,{dark:true,reduced:true}),{dark:true,reduced:true});
 assert.deepEqual(resolvedPreferences({appearance:'light',motion:'full'},{dark:true,reduced:true}),{dark:false,reduced:false});
 assert.deepEqual(resolvedPreferences({appearance:'dark',motion:'reduce'},{dark:false,reduced:false}),{dark:true,reduced:true});
});
test('resume catches missed device changes and unmount removes listeners',()=>{
 const win=new EventTarget(),doc=new EventTarget(),dark=new EventTarget(),motion=new EventTarget();
 dark.matches=true;motion.matches=false;
 win.matchMedia=q=>q.includes('color')?dark:motion;
 const states=[],stop=watchDevicePreferences(win,doc,s=>states.push(s));
 assert.deepEqual(states.at(-1),{dark:true,reduced:false});
 dark.matches=false;motion.matches=true;doc.dispatchEvent(new Event('visibilitychange'));
 assert.deepEqual(states.at(-1),{dark:false,reduced:true});
 dark.matches=true;win.dispatchEvent(new Event('pageshow'));
 assert.equal(states.at(-1).dark,true);
 dark.matches=false;dark.dispatchEvent(new Event('change'));
 assert.equal(states.at(-1).dark,false);
 stop();const count=states.length;
 for(const [target,event] of [[win,'focus'],[win,'pageshow'],[doc,'visibilitychange'],[dark,'change'],[motion,'change']])target.dispatchEvent(new Event(event));
 assert.equal(states.length,count);
});
