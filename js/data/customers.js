import { addDoc, collection, db, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── companies/{cid}/customers ─────────────────────────────────────────────────
const customersCol=()=>collection(db,'companies',companyId,'customers');

// By name, as {_id, …fields}.
export async function listCustomers(){
  const snap=await getDocs(query(customersCol(),orderBy('name')));
  return snap.docs.map(d=>({_id:d.id,...d.data()}));
}
export async function countCustomers(){
  return (await getDocs(customersCol())).size;
}
export async function createCustomer(fields){
  return addDoc(customersCol(), { ...fields, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
}
export async function updateCustomer(id, fields){
  return updateDoc(doc(db,'companies',companyId,'customers',id), { ...fields, updatedAt:serverTimestamp() });
}
export async function removeCustomerDoc(id){
  return deleteDoc(doc(db,'companies',companyId,'customers',id));
}
