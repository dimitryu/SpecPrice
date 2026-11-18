import { auth, collection, db, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from '../core/firebase.js';

// Creating, changing, disabling and deleting users goes through the userAdmin
// Cloud Function (Admin SDK): only it can create a sign-in account, disable it
// and end its sessions, and the Firestore rules let no one but an admin write
// a profile. The browser no longer calls Firebase's public sign-up endpoint.
export const USER_ADMIN_URL='https://us-central1-specprice-236a2.cloudfunctions.net/userAdmin';
export async function userAdminCall(body){
  if(!auth.currentUser) throw new Error('Not signed in');
  const token=await auth.currentUser.getIdToken();
  let resp;
  try{
    resp=await fetch(USER_ADMIN_URL,{method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(60000)});
  }catch(e){ throw new Error('The user service is not reachable — deploy the server functions (firebase deploy --only functions)'); }
  let data=null; try{ data=await resp.json(); }catch{}
  if(resp.status===404 && !data) throw new Error('The user service is not deployed yet — run: firebase deploy --only functions');
  if(!resp.ok) throw new Error((data&&data.error)||`HTTP ${resp.status}`);
  return data;
}

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
