import { addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from '../core/firebase.js';
import { companyId } from '../core/session.js';

// ── companies/{cid}/projects  (RFQs) and their drawings ──────────────────────
const projectsCol=()=>collection(db,'companies',companyId,'projects');
const drawingsCol=projectId=>collection(db,'companies',companyId,'projects',projectId,'drawings');
const drawingRef=(projectId,dwgId)=>doc(db,'companies',companyId,'projects',projectId,'drawings',dwgId);

// Every RFQ as {_id, …fields}, in whatever order the database returns.
export async function listProjects(){
  const snap=await getDocs(projectsCol());
  return snap.docs.map(d=>({_id:d.id,...d.data()}));
}
// Newest first. A database that cannot sort (a project without updatedAt, a
// missing index) falls back to reading everything and sorting here — the list
// must still open.
export async function listProjectsNewestFirst(){
  try{
    const snap=await getDocs(query(projectsCol(),orderBy('updatedAt','desc')));
    return snap.docs.map(d=>({_id:d.id,...d.data()}));
  }catch{
    const projects=await listProjects();
    projects.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    return projects;
  }
}
export async function countProjects(){
  return (await getDocs(projectsCol())).size;
}
// Returns the new RFQ's id.
export async function createProject(fields){
  const ref=await addDoc(projectsCol(), { ...fields, updatedAt:serverTimestamp(), createdAt:serverTimestamp() });
  return ref.id;
}
// An RFQ and every drawing under it.
export async function deleteProject(id){
  const snap=await getDocs(drawingsCol(id));
  await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
  await deleteDoc(doc(db,'companies',companyId,'projects',id));
}
export async function touchProject(projectId){
  return updateDoc(doc(db,'companies',companyId,'projects',projectId),{updatedAt:serverTimestamp()});
}

// Drawings of one RFQ as {_id, …fields}.
export async function listDrawings(projectId){
  const snap=await getDocs(drawingsCol(projectId));
  return snap.docs.map(d=>({_id:d.id,...d.data()}));
}
export async function deleteDrawing(projectId, dwgId){
  return deleteDoc(drawingRef(projectId,dwgId));
}
// Removes rows (by index) from a drawing's items; a drawing left with no rows
// is deleted rather than kept empty.
export async function removeDrawingItems(projectId, dwgId, indexes){
  const ref=drawingRef(projectId,dwgId);
  const snap=await getDoc(ref);
  const items=[...(snap.data()?.items||[])];
  [...indexes].sort((a,b)=>b-a).forEach(idx=>{ if(idx>=0 && idx<items.length) items.splice(idx,1); });
  if(items.length===0) await deleteDoc(ref);
  else await updateDoc(ref,{items, updatedAt:serverTimestamp()});
}
// Adds BOM rows to the drawing of this name under the RFQ, creating it if
// there is none, and marks the RFQ as updated.
export async function appendRowsToDrawing(projectId, drawingName, rows){
  const col=drawingsCol(projectId);
  const existSnap=await getDocs(col);
  const existing=existSnap.docs.find(d=>(d.data().name||'')===(drawingName));
  if(existing){
    const oldItems=existing.data().items||[];
    await updateDoc(existing.ref,{items:[...oldItems,...rows], updatedAt:serverTimestamp()});
  } else {
    await addDoc(col,{name:drawingName, items:rows, updatedAt:serverTimestamp()});
  }
  await touchProject(projectId);
}
