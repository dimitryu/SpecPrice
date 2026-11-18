import { collection, db, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';
import { isTrashed, restoreFields, trashFields } from './trash.js';

// ── companies/{cid}/cut_strip_specs ───────────────────────────────────────────
// Cut & strip specifications AND manufacturing instructions share this
// collection (kind:'mfg', id prefixed mfg_) — it is the one collection whose
// security rule already grants what both need. Callers tell them apart.

// Every document, newest first, as {_id, …fields}.
export async function listSpecDocs(){
  const snap=await getDocs(query(collection(db,'companies',companyId,'cut_strip_specs'),orderBy('updatedAt','desc')));
  return snap.docs.map(d=>({_id:d.id, ...d.data()})).filter(s=>!isTrashed(s));
}
// Specs and instructions in the recycle bin (Admin > Recycle Bin).
export async function listDeletedSpecDocs(){
  const snap=await getDocs(collection(db,'companies',companyId,'cut_strip_specs'));
  return snap.docs.map(d=>({_id:d.id, ...d.data()})).filter(isTrashed);
}
// Replaces the whole document (never a merge: a field the user removed must
// really go). `updatedAt` is stamped here.
export async function writeSpecDoc(id, body){
  return setDoc(doc(db,'companies',companyId,'cut_strip_specs',id), {...body, updatedAt:serverTimestamp()}, {merge:false});
}
// To the recycle bin; an admin restores it or deletes it for good.
export async function deleteSpecDoc(id){
  return updateDoc(doc(db,'companies',companyId,'cut_strip_specs',id), trashFields());
}
export async function restoreSpecDoc(id){
  return updateDoc(doc(db,'companies',companyId,'cut_strip_specs',id), restoreFields());
}
export async function purgeSpecDoc(id){
  return deleteDoc(doc(db,'companies',companyId,'cut_strip_specs',id));
}
