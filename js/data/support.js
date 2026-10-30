import { addDoc, arrayUnion, collection, db, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── companies/{cid}/support_tickets ───────────────────────────────────────────
// Tickets and their attachments share the collection. An attachment is a
// document with kind:'file' and NO createdAt, so every ticket list (ordered by
// createdAt) leaves them out without a rules change; `kind` is checked as well.
const ticketsCol=()=>collection(db,'companies',companyId,'support_tickets');
const ticketRef=id=>doc(db,'companies',companyId,'support_tickets',id);

// Every ticket (not attachments), newest first, as {_id, …fields}.
export async function listTickets(){
  const snap=await getDocs(query(ticketsCol(),orderBy('createdAt','desc')));
  return snap.docs.map(d=>({_id:d.id,...d.data()})).filter(t=>!t.kind);
}
// Returns the new ticket's id.
export async function createTicket(fields){
  const ref=await addDoc(ticketsCol(), { ...fields, createdAt:serverTimestamp(), lastMsgAt:serverTimestamp() });
  return ref.id;
}
// Plain field update (no timestamps added).
export async function setTicketFields(id, patch){
  return updateDoc(ticketRef(id), patch);
}
// One more turn in the conversation.
export async function appendTicketTurn(id, entry, fields){
  return updateDoc(ticketRef(id), { ...fields, thread:arrayUnion(entry), lastMsgAt:serverTimestamp(), updatedAt:serverTimestamp() });
}
// A status change by the admin.
export async function setTicketStatus(id, status){
  return updateDoc(ticketRef(id), {status, userUnread:true, statusChangedAt:serverTimestamp(), updatedAt:serverTimestamp()});
}
// Clears one side's unread marker on several tickets at once.
export async function markTicketsRead(ids, asAdmin){
  const batch=writeBatch(db);
  ids.forEach(id=>batch.update(ticketRef(id), asAdmin?{adminUnread:false}:{userUnread:false}));
  await batch.commit();
}
// How many of this user's tickets have news for them.
export async function countUnreadForUser(email){
  const snap=await getDocs(query(ticketsCol(), where('user','==',email), where('userUnread','==',true)));
  return snap.size;
}
// Tickets with news for the admin, as plain data.
export async function listUnreadForAdmin(){
  const snap=await getDocs(query(ticketsCol(), where('adminUnread','==',true)));
  return snap.docs.map(d=>d.data());
}
// An attachment: stored as its own document; returns its id.
export async function addTicketFile(fields){
  const ref=await addDoc(ticketsCol(), fields);
  return ref.id;
}
// The attachment's document, or null when it is gone.
export async function getTicketFile(id){
  const snap=await getDoc(ticketRef(id));
  return snap.exists() ? snap.data() : null;
}
