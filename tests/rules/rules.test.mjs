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
  await setDoc(doc(db,'roles/auditor'),{name:'Auditor',read_only:true});
  await setDoc(doc(db,'users/agent1'),{role:'agent',company_id:'c1'});
  await setDoc(doc(db,'users/auditor1'),{role:'auditor',company_id:'c1'});
  await setDoc(doc(db,'users/admin2'),{role:'admin',company_id:'c2'});
  await setDoc(doc(db,'users/c2user'),{role:'sales',company_id:'c2'});
  await setDoc(doc(db,'companies/c1/cut_strip_specs/s1'),{drawing_number:'D1'});
  await setDoc(doc(db,'companies/c1/customers/cu1'),{name:'Acme'});
  await setDoc(doc(db,'companies/c1/projects/r1'),{name:'RFQ 1'});
  await setDoc(doc(db,'companies/c1/projects/r1/drawings/d1'),{name:'D1',items:[]});
  await setDoc(doc(db,'companies/c1/support_tickets/t1'),{user:'s@x',message:'help'});
  await setDoc(doc(db,'companies/c1/parts_cache/old'),{part_number:'OLD',deleted:true,deletedAtMs:Date.now()-5*86400000});
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

// H1 — roles are enforced by the rules, not only by the screen
await env.withSecurityRulesDisabled(async c=>{ await updateDoc(doc(c.firestore(),'users/sales1'),{role:'sales'}); });
const agent=as('agent1'), auditor=as('auditor1'), adm2=as('admin2');
await t('viewer cannot change a part', assertFails(updateDoc(doc(viewer,'companies/c1/parts_cache/p1'),{x:9})));
await t('viewer cannot add a part', assertFails(setDoc(doc(viewer,'companies/c1/parts_cache/p9'),{part_number:'P9'})));
await t('viewer cannot write a Cut & Strip sheet', assertFails(setDoc(doc(viewer,'companies/c1/cut_strip_specs/s2'),{drawing_number:'D2'})));
await t('viewer cannot write a customer', assertFails(updateDoc(doc(viewer,'companies/c1/customers/cu1'),{name:'x'})));
await t('viewer cannot write an RFQ', assertFails(updateDoc(doc(viewer,'companies/c1/projects/r1'),{name:'x'})));
await t('viewer cannot write a drawing', assertFails(updateDoc(doc(viewer,'companies/c1/projects/r1/drawings/d1'),{items:[1]})));
await t('viewer CAN read Cut & Strip sheets', assertSucceeds(getDoc(doc(viewer,'companies/c1/cut_strip_specs/s1'))));
await t('viewer CAN open a support ticket', assertSucceeds(addDoc(collection(viewer,'companies/c1/support_tickets'),{message:'help'})));
await t('viewer CAN write the audit log (screen opens)', assertSucceeds(addDoc(collection(viewer,'companies/c1/audit_logs'),{action:'open'})));
await t('a read-only custom role cannot write', assertFails(updateDoc(doc(auditor,'companies/c1/parts_cache/p1'),{x:9})));
await t('a read-only custom role can read', assertSucceeds(getDoc(doc(auditor,'companies/c1/parts_cache/p1'))));
await t('agent writes a Cut & Strip sheet', assertSucceeds(setDoc(doc(agent,'companies/c1/cut_strip_specs/s2'),{drawing_number:'D2'})));
await t('agent writes a customer', assertSucceeds(updateDoc(doc(agent,'companies/c1/customers/cu1'),{name:'Acme Ltd'})));
await t('agent writes an RFQ drawing', assertSucceeds(updateDoc(doc(agent,'companies/c1/projects/r1/drawings/d1'),{items:[{a:1}]})));
// H2 — permanent delete is the company admin's alone
await t('agent cannot delete a Cut & Strip sheet for good', assertFails(deleteDoc(doc(agent,'companies/c1/cut_strip_specs/s1'))));
await t('agent cannot delete a customer for good', assertFails(deleteDoc(doc(agent,'companies/c1/customers/cu1'))));
await t('agent cannot delete an RFQ for good', assertFails(deleteDoc(doc(agent,'companies/c1/projects/r1'))));
await t('agent cannot delete a drawing for good', assertFails(deleteDoc(doc(agent,'companies/c1/projects/r1/drawings/d1'))));
await t('sales cannot delete a support ticket', assertFails(deleteDoc(doc(sales,'companies/c1/support_tickets/t1'))));
await t('agent CAN move a customer to the bin (now)', assertSucceeds(updateDoc(doc(agent,'companies/c1/customers/cu1'),{deleted:true,deletedAtMs:Date.now()})));
await t('agent CAN restore it', assertSucceeds(updateDoc(doc(agent,'companies/c1/customers/cu1'),{deleted:false})));
// H3 — the bin time cannot be forged
await t('back-dated delete refused (deletedAtMs: 0)', assertFails(updateDoc(doc(sales,'companies/c1/parts_cache/p1'),{deleted:true,deletedAtMs:0})));
await t('delete dated a month ago refused', assertFails(updateDoc(doc(sales,'companies/c1/parts_cache/p1'),{deleted:true,deletedAtMs:Date.now()-30*86400000})));
await t('delete without a time refused', assertFails(updateDoc(doc(sales,'companies/c1/parts_cache/p1'),{deleted:true})));
await t('delete dated now accepted', assertSucceeds(updateDoc(doc(sales,'companies/c1/parts_cache/p1'),{deleted:true,deletedAtMs:Date.now()})));
await t('an item in the bin cannot be back-dated', assertFails(updateDoc(doc(sales,'companies/c1/parts_cache/old'),{deletedAtMs:1})));
await t('an item in the bin can be edited keeping its time', assertSucceeds(updateDoc(doc(sales,'companies/c1/parts_cache/old'),{note:'x'})));
await t('back-dated RFQ delete refused', assertFails(updateDoc(doc(agent,'companies/c1/projects/r1'),{deleted:true,deletedAtMs:5})));
await t('sales cannot purge a part', assertFails(deleteDoc(doc(sales,'companies/c1/parts_cache/old'))));
await t('admin purges a part', assertSucceeds(deleteDoc(doc(adm,'companies/c1/parts_cache/old'))));
await t('admin purges a drawing', assertSucceeds(deleteDoc(doc(adm,'companies/c1/projects/r1/drawings/d1'))));
// H4 — company settings
await t('sales cannot change the labor rate', assertFails(updateDoc(doc(sales,'companies/c1'),{labor_rate_min:0.01})));
await t('agent cannot change the recycle-bin retention', assertFails(updateDoc(doc(agent,'companies/c1'),{trash_days:7})));
await t('admin changes the labor rate', assertSucceeds(updateDoc(doc(adm,'companies/c1'),{labor_rate_min:0.8})));
// H5 — an admin is the admin of their own company only
await t('admin of c2 cannot read c1 parts', assertFails(getDoc(doc(adm2,'companies/c1/parts_cache/p1'))));
await t('admin of c2 cannot change c1 settings', assertFails(updateDoc(doc(adm2,'companies/c1'),{labor_rate_min:9})));
await t('admin of c2 cannot purge c1 data', assertFails(deleteDoc(doc(adm2,'companies/c1/cut_strip_specs/s1'))));
await t('admin of c2 cannot read c1 audit logs', assertFails(getDocs(collection(adm2,'companies/c1/audit_logs'))));
await t('admin of c2 cannot move a c1 user', assertFails(updateDoc(doc(adm2,'users/sales1'),{role:'admin'})));
await t('admin of c2 cannot create a c1 user', assertFails(setDoc(doc(adm2,'users/x9'),{role:'admin',company_id:'c1'})));
await t('admin of c1 cannot move a user into c2', assertFails(updateDoc(doc(adm,'users/sales1'),{company_id:'c2'})));
await t('admin of c1 cannot touch a c2 user', assertFails(updateDoc(doc(adm,'users/c2user'),{role:'viewer'})));
console.log(`rules: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail?1:0);
