import { addDoc, collection, db, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';
import { isTrashed, restoreFields, trashFields } from './trash.js';

// ── companies/{cid}/customers ─────────────────────────────────────────────────
const customersCol=()=>collection(db,'companies',companyId,'customers');

// By name, as {_id, …fields}.
export async function listCustomers(){
  const snap=await getDocs(query(customersCol(),orderBy('name')));
  return snap.docs.map(d=>({_id:d.id,...d.data()})).filter(c=>!isTrashed(c));
}
export async function listDeletedCustomers(){
  const snap=await getDocs(customersCol());
  return snap.docs.map(d=>({_id:d.id,...d.data()})).filter(isTrashed);
}
export async function countCustomers(){
  return (await getDocs(customersCol())).docs.filter(d=>!isTrashed(d.data())).length;
}
export async function createCustomer(fields){
  return addDoc(customersCol(), { ...fields, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
}
export async function updateCustomer(id, fields){
  return updateDoc(doc(db,'companies',companyId,'customers',id), { ...fields, updatedAt:serverTimestamp() });
}
// To the recycle bin; an admin restores it or deletes it for good.
export async function removeCustomerDoc(id){
  return updateDoc(doc(db,'companies',companyId,'customers',id), trashFields());
}
export async function restoreCustomer(id){
  return updateDoc(doc(db,'companies',companyId,'customers',id), restoreFields());
}
export async function purgeCustomer(id){
  return deleteDoc(doc(db,'companies',companyId,'customers',id));
}
