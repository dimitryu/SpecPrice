import { collection, db, deleteField, doc, getDoc, getDocs, setDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── users/{uid} (own profile) and companies/{id} ─────────────────────────────

// The signed-in user's profile: company, role, disabled flag. {} when none.
export async function getUserProfile(uid){
  const snap=await getDoc(doc(db,'users',uid));
  return snap.data() || {};
}
// Every company — only needed when a user has none assigned.
export async function listCompanies(){
  const snap=await getDocs(collection(db,'companies'));
  return snap.docs.map(d=>({id:d.id, data:d.data()}));
}
// One company's settings document. {} when missing.
export async function getCompany(id){
  const snap=await getDoc(doc(db,'companies',id));
  return snap.data() || {};
}
// The company document is readable by every signed-in user (the first-login
// company picker lists them), so it is no place for an AI key. Called once the
// key has been moved to the server.
export async function clearCompanyAiKeys(){
  return setDoc(doc(db,'companies',companyId), {anthropic_key:deleteField(), gemini_key:deleteField()}, {merge:true});
}
// Merge fields into the current company's document (labor rate, logo, trash days …).
export async function updateCompany(patch){
  return setDoc(doc(db,'companies',companyId), patch, {merge:true});
}
