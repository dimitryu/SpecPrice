import { collection, db, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── companies/{cid}/cut_strip_specs ───────────────────────────────────────────
// Cut & strip specifications AND manufacturing instructions share this
// collection (kind:'mfg', id prefixed mfg_) — it is the one collection whose
// security rule already grants what both need. Callers tell them apart.

// Every document, newest first, as {_id, …fields}.
export async function listSpecDocs(){
  const snap=await getDocs(query(collection(db,'companies',companyId,'cut_strip_specs'),orderBy('updatedAt','desc')));
  return snap.docs.map(d=>({_id:d.id, ...d.data()}));
}
// Replaces the whole document (never a merge: a field the user removed must
// really go). `updatedAt` is stamped here.
export async function writeSpecDoc(id, body){
  return setDoc(doc(db,'companies',companyId,'cut_strip_specs',id), {...body, updatedAt:serverTimestamp()}, {merge:false});
}
export async function deleteSpecDoc(id){
  return deleteDoc(doc(db,'companies',companyId,'cut_strip_specs',id));
}
