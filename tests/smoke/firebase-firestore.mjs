// Stand-in for firebase-firestore.js: an in-memory database, enough for every
// screen to load and save.
export const DB = globalThis.__DB = globalThis.__DB || {};
let seq=0;
const p=a=>a.join('/');
export function getFirestore(){ return {}; }
export function collection(db,...a){ return { __col:p(a) }; }
export function doc(db,...a){ if(db&&db.__col){ return { __doc:db.__col, id:a[0]||('id'+(++seq)) }; }
  return { __doc:p(a.slice(0,-1)), id:a[a.length-1] }; }
export function query(col,...cl){ return { ...col, __where:cl.filter(c=>c&&c.__w), __order:cl.find(c=>c&&c.__o) }; }
export function where(f,op,v){ return { __w:true, f, op, v }; }
export function orderBy(f,d){ return { __o:true, f, d }; }
export function limit(n){ return { __l:n }; }
export function serverTimestamp(){ return { toMillis:()=>Date.now(), toDate:()=>new Date(), seconds:Math.floor(Date.now()/1000) }; }
export function arrayUnion(...v){ return { __au:v }; }
export function deleteField(){ return { __del:true }; }
const snap=(path,id,data)=>({ id, exists:()=>data!==undefined, data:()=>data, ref:{ __doc:path, id } });
export async function getDoc(r){ const d=(DB[r.__doc]||{})[r.id]; return snap(r.__doc, r.id, d); }
export async function getDocs(q){ const col=DB[q.__col]||{}; let rows=Object.entries(col).map(([id,d])=>snap(q.__col,id,d));
  for(const w of (q.__where||[])) rows=rows.filter(r=>{ const v=r.data()[w.f]; return w.op==='=='?v===w.v:w.op==='in'?(w.v||[]).includes(v):true; });
  if(q.__order){ const f=q.__order.f; rows=rows.filter(r=>r.data()[f]!=null); }
  return { docs:rows, size:rows.length, empty:!rows.length, forEach:fn=>rows.forEach(fn) }; }
const apply=(c,patch)=>{ for(const [k,v] of Object.entries(patch||{})){ if(v&&v.__del) delete c[k]; else if(v&&v.__au) c[k]=[...(c[k]||[]),...v.__au]; else c[k]=v; } };
export async function setDoc(r,d,o){ const t=(DB[r.__doc]=DB[r.__doc]||{}); if(o&&o.merge&&t[r.id]) apply(t[r.id],d); else { t[r.id]={}; apply(t[r.id],d); } }
export async function addDoc(col,d){ const id='id'+(++seq); (DB[col.__col]=DB[col.__col]||{})[id]={}; apply(DB[col.__col][id],d); return { id }; }
export async function updateDoc(r,patch){ const c=(DB[r.__doc]||{})[r.id]; if(!c) throw new Error('No document to update: '+r.__doc+'/'+r.id); apply(c,patch); }
export async function deleteDoc(r){ delete (DB[r.__doc]||{})[r.id]; }
export function writeBatch(){ const ops=[]; return { update:(r,p)=>ops.push(()=>updateDoc(r,p)), set:(r,d,o)=>ops.push(()=>setDoc(r,d,o)),
  delete:r=>ops.push(()=>deleteDoc(r)), commit:async()=>{ for(const o of ops) await o(); } }; }
