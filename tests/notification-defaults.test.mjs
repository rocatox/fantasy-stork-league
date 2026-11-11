import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTIFICATION_CATEGORIES,notificationDefaults,notificationPreferences,newNotificationAccount} from '../lib/notifications.mjs';

test('new accounts default every in-app category on and every email category off',()=>{
 for(const preferences of [notificationDefaults,notificationPreferences(),newNotificationAccount(Date.now()).preferences]){
  for(const [key] of NOTIFICATION_CATEGORIES){
   assert.equal(preferences[key],true,key);
   assert.equal(preferences['email_'+key]===true,false,'email_'+key);
  }
 }
 assert.equal(Object.hasOwn(notificationDefaults,'email_storks'),false);
});

test('defaults preserve existing explicitly saved notification choices',()=>{
 const preferences=notificationPreferences({draft:false,email_draft:true,storks:false});
 assert.equal(preferences.draft,false);assert.equal(preferences.email_draft,true);assert.equal(preferences.storks,false);
});
