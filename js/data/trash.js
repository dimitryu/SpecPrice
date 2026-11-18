import { S } from '../core/state.js';
import { auth, deleteField, serverTimestamp } from '../core/firebase.js';

// ── Recycle bin fields ────────────────────────────────────────────────────────
// RFQs, drawings, customers and Cut & Strip / manufacturing documents are not
// deleted by the people who work with them: they are marked deleted and leave
// every list, and only an admin restores them or deletes them for good
// (Admin > Recycle Bin). The Firestore rules refuse a real delete from anyone
// but an admin, and refuse a deletedAtMs that is not "now" — so nobody can
// back-date an item to make it look due for purging.
export function trashFields(){
  return { deleted:true, deletedAtMs:Date.now(), deletedAt:serverTimestamp(),
           deletedBy:S.currentUserEmail||auth.currentUser?.email||'' };
}
export function restoreFields(){
  return { deleted:false, deletedAtMs:deleteField(), deletedAt:deleteField(), deletedBy:deleteField() };
}
export const isTrashed = d => !!d && d.deleted===true;
