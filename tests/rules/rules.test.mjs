// Firestore security rules — who may read and write what. Runs against the
// Firestore emulator (needs Java and firebase-tools), so it is not part of
// `npm test`:
//
//   cd tests/rules && npm i --no-save firebase-tools@15 @firebase/rules-unit-testing@6 firebase@13
//   npx firebase emulators:exec --only firestore --project specprice-rules-test "node rules.test.mjs"
//
// Every "cannot" here was possible before v1.72: any sign-in account could
// write its own profile, role included.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import fs from 'fs';
let pass=0, fail=0;
const t=async(name, p)=>{ try{ await p; pass++; }catch(e){ fail++; console.log('  ✗', name, '-', String(e.message||e).slice(0,160)); } };
const env=await initializeTestEnvironment({ projectId:'specprice-rules-test', firestore:{ rules:fs.readFileSync(process.argv[2]||new URL('../../firestore.rules', import.meta.url),'utf8'), host:'127.0.0.1', port:8085 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async c=>{ const db=c.firestore();
  await setDoc(doc(db,'users/admin1'),{role:'admin',company_id:'c1',email:'a@x'});
  await setDoc(doc(db,'users/sales1'),{role:'sales',company_id:'c1',email:'s@x'});
  await setDoc(doc(db,'users/viewer1'),{role:'viewer',company_id:'c1'});
  await setDoc(doc(db,'users/off1'),{role:'sales',company_id:'c1',disabled:true});
  await setDoc(doc(db,'users/offadmin'),{role:'admin',company_id:'c1',disabled:true});
  await setDoc(doc(db,'companies/c1'),{name:'Demo'}); await setDoc(doc(db,'companies/c2'),{name:'Other'});
  await setDoc(doc(db,'companies/c1/parts_cache/p1'),{part_number:'P1'});
  await setDoc(doc(db,'roles/sales'),{name:'Sales'});
  await setDoc(doc(db,'secure_config/ai_api'),{anthropic_api_key:'k'});
});
const as=uid=>env.authenticatedContext(uid).firestore();
const stranger=as('stranger'), sales=as('sales1'), viewer=as('viewer1'), off=as('off1'), adm=as('admin1'), offAdm=as('offadmin'), anon=env.unauthenticatedContext().firestore();

// C1 — an outsider with a fresh sign-in account
await t('stranger cannot create a profile for themselves', assertFails(setDoc(doc(stranger,'users/stranger'),{role:'admin',company_id:'c1'})));
await t('stranger cannot create a plain profile either', assertFails(setDoc(doc(stranger,'users/stranger'),{email:'x'})));
await t('stranger cannot list companies', assertFails(getDocs(collection(stranger,'companies'))));
await t('stranger cannot read roles', assertFails(getDoc(doc(stranger,'roles/sales'))));
await t('stranger cannot read parts', assertFails(getDoc(doc(stranger,'companies/c1/parts_cache/p1'))));
await t('stranger cannot write audit logs', assertFails(addDoc(collection(stranger,'companies/c1/audit_logs'),{a:1})));
await t('anonymous cannot read anything', assertFails(getDoc(doc(anon,'companies/c1'))));
// C2 — a user changing their own profile
await t('sales cannot make themselves admin', assertFails(updateDoc(doc(sales,'users/sales1'),{role:'admin'})));
await t('sales cannot change their company', assertFails(updateDoc(doc(sales,'users/sales1'),{company_id:'c2'})));
await t('sales cannot set disabled', assertFails(updateDoc(doc(sales,'users/sales1'),{disabled:false})));
await t('sales cannot overwrite their profile with set()', assertFails(setDoc(doc(sales,'users/sales1'),{role:'admin',company_id:'c1'})));
await t('sales cannot sneak role in with ui_prefs', assertFails(updateDoc(doc(sales,'users/sales1'),{'ui_prefs.sd_view':'compact',role:'admin'})));
await t('sales cannot delete their profile', assertFails(deleteDoc(doc(sales,'users/sales1'))));
await t('sales cannot read another profile', assertFails(getDoc(doc(sales,'users/admin1'))));
await t('sales cannot write another profile', assertFails(updateDoc(doc(sales,'users/viewer1'),{role:'admin'})));
await t('sales CAN save their own screen settings', assertSucceeds(updateDoc(doc(sales,'users/sales1'),{'ui_prefs.sd_view':'compact'})));
await t('sales CAN read their own profile', assertSucceeds(getDoc(doc(sales,'users/sales1'))));
await t('viewer cannot make themselves admin', assertFails(updateDoc(doc(viewer,'users/viewer1'),{role:'admin'})));
// C3 — a disabled user
await t('disabled user cannot re-enable themselves', assertFails(updateDoc(doc(off,'users/off1'),{disabled:false})));
await t('disabled user CAN still read that they are disabled', assertSucceeds(getDoc(doc(off,'users/off1'))));
await t('disabled user cannot save screen settings', assertFails(updateDoc(doc(off,'users/off1'),{'ui_prefs.sd_view':'full'})));
await t('disabled user cannot read parts', assertFails(getDoc(doc(off,'companies/c1/parts_cache/p1'))));
await t('disabled user cannot write parts', assertFails(updateDoc(doc(off,'companies/c1/parts_cache/p1'),{x:1})));
await t('disabled user cannot read companies', assertFails(getDoc(doc(off,'companies/c1'))));
await t('disabled admin has no admin rights', assertFails(updateDoc(doc(offAdm,'users/sales1'),{role:'viewer'})));
await t('disabled admin cannot read audit logs', assertFails(getDocs(collection(offAdm,'companies/c1/audit_logs'))));
// unchanged for normal work
await t('sales reads parts', assertSucceeds(getDoc(doc(sales,'companies/c1/parts_cache/p1'))));
await t('sales edits parts', assertSucceeds(updateDoc(doc(sales,'companies/c1/parts_cache/p1'),{x:2})));
await t('sales cannot read another company\'s parts', assertFails(getDoc(doc(sales,'companies/c2/parts_cache/p1'))));
await t('sales reads companies (company picker)', assertSucceeds(getDoc(doc(sales,'companies/c1'))));
await t('sales reads roles', assertSucceeds(getDoc(doc(sales,'roles/sales'))));
await t('sales writes an audit log', assertSucceeds(addDoc(collection(sales,'companies/c1/audit_logs'),{action:'x'})));
await t('sales cannot read audit logs', assertFails(getDocs(collection(sales,'companies/c1/audit_logs'))));
await t('admin manages profiles', assertSucceeds(updateDoc(doc(adm,'users/sales1'),{role:'viewer'})));
await t('admin creates a profile', assertSucceeds(setDoc(doc(adm,'users/newbie'),{role:'sales',company_id:'c1'})));
await t('admin deletes a profile', assertSucceeds(deleteDoc(doc(adm,'users/newbie'))));
await t('admin lists users', assertSucceeds(getDocs(collection(adm,'users'))));
await t('admin reads audit logs', assertSucceeds(getDocs(collection(adm,'companies/c1/audit_logs'))));
await t('nobody reads secure_config, not even admin', assertFails(getDoc(doc(adm,'secure_config/ai_api'))));
console.log(`rules: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail?1:0);
