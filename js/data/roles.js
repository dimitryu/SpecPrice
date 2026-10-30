import { collection, db, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from '../core/firebase.js';

// ── roles ─────────────────────────────────────────────────────────────────────
// One document per role ({name, views, disabledViews}), plus the bookkeeping
// document ROLES_META_DOC that records the one-time seed.

// Every document in the collection, as {id, data} — the caller tells roles
// from the bookkeeping document.
export async function listRoleDocs(){
  const snap=await getDocs(collection(db,'roles'));
  return snap.docs.map(d=>({id:d.id, data:d.data()}));
}
export async function createRole(key, fields){
  return setDoc(doc(db,'roles',key), { ...fields, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
}
export async function updateRole(key, fields){
  return setDoc(doc(db,'roles',key), { ...fields, updatedAt:serverTimestamp() }, {merge:true});
}
export async function deleteRole(key){
  return deleteDoc(doc(db,'roles',key));
}
// The one-time marker that the seed roles were written.
export async function markRolesSeeded(metaDocId, byEmail){
  return setDoc(doc(db,'roles',metaDocId), {seeded:true, seededAt:serverTimestamp(), seededBy:byEmail||''});
}
