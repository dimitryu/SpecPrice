import { addDoc, collection, db, getDocs, limit, orderBy, query, serverTimestamp, where } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── audit_logs ────────────────────────────────────────────────────────────────
// The append-only trail behind Admin > Logs and the Statistics screen.
// Writing is fire-and-forget at the call site (core/audit.js); this module only
// knows where the trail lives and how it is read.

// One entry. `timestamp` is stamped here, by the server clock.
export async function addAuditEntry(entry){
  return addDoc(collection(db,'companies',companyId,'audit_logs'), { ...entry, timestamp: serverTimestamp() });
}
// Newest first, at most `max` entries (Admin > Logs).
export async function listRecentAuditEntries(max){
  const snap=await getDocs(query(collection(db,'companies',companyId,'audit_logs'),orderBy('timestamp','desc'),limit(max)));
  return snap.docs.map(d=>({_id:d.id, ...d.data()}));
}
// Entries between two dates, inclusive, newest first, at most `max` (Statistics).
export async function listAuditEntriesBetween(from, to, max){
  const snap=await getDocs(query(collection(db,'companies',companyId,'audit_logs'),
    where('timestamp','>=',from), where('timestamp','<=',to), orderBy('timestamp','desc'), limit(max)));
  return snap.docs.map(d=>d.data());
}
