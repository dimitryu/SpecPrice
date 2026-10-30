import { collection, db, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from '../core/firebase.js';

// ── users ─────────────────────────────────────────────────────────────────────
// Profiles (company, role, disabled). The sign-in account itself lives in
// Firebase Auth; these documents are what the app reads to decide access.

export async function listUsers(){
  const snap=await getDocs(collection(db,'users'));
  return snap.docs.map(d=>({_id:d.id, ...d.data()}));
}
export async function createUserProfile(uid, fields){
  return setDoc(doc(db,'users',uid), { ...fields, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
}
export async function updateUserProfile(uid, patch){
  return updateDoc(doc(db,'users',uid), { ...patch, updatedAt:serverTimestamp() });
}
export async function deleteUserProfile(uid){
  return deleteDoc(doc(db,'users',uid));
}
// How many users have this role — a role still in use must not be deleted.
export async function countUsersWithRole(key){
  const snap=await getDocs(query(collection(db,'users'), where('role','==',key)));
  return snap.size;
}
