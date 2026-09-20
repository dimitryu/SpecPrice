/* Support-flow smoke test: the real app functions, a real DOM, a fake Firestore.
   Verifies the parts unit tests cannot reach — the modal, the admin table, the
   unread markers and the round trip of posting a reply. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');

const dom=new JSDOM(`<!doctype html><html><body>
  <div id="shell"><div class="topbar"><div id="topbar-actions"></div><div id="topbar-info"></div></div>
  <div id="content"></div></div>
  <button id="btn-support-fab" title="Support — send a request or report a problem"></button>
  <div id="toast-el"></div></body></html>`,{url:'https://x.test'});

// ── fake Firestore ─────────────────────────────────────────────────────────
const DB={};                                   // path -> {id: data}
let idSeq=0;
const pathOf=a=>a.join('/');
const collection=(...a)=>({__col:pathOf(a.slice(1))});
const doc=(...a)=>({__doc:pathOf(a.slice(1,-1)), id:a[a.length-1]});
const query=(col,...cl)=>({...col, __where:cl.filter(c=>c.__w), __order:cl.find(c=>c.__o)});
const where=(f,op,v)=>({__w:true,f,op,v});
const orderBy=(f,d)=>({__o:true,f,d});
const limit=n=>({__l:n});
const serverTimestamp=()=>new Date();
const arrayUnion=(...v)=>({__au:v});
async function getDocs(q){
  const col=DB[q.__col]||{};
  let rows=Object.entries(col).map(([id,data])=>({id,data:()=>data, exists:()=>true}));
  if(q.__order){ const f=q.__order.f;
    rows=rows.filter(r=>r.data()[f]!=null)                    // Firestore: orderBy hides docs missing the field
             .sort((a,b)=>new Date(b.data()[f])-new Date(a.data()[f])); }
  for(const w of (q.__where||[])) rows=rows.filter(r=>r.data()[w.f]===w.v);
  return {docs:rows, size:rows.length, empty:!rows.length};
}
async function getDoc(ref){ const d=(DB[ref.__doc]||{})[ref.id];
  return {exists:()=>!!d, data:()=>d, id:ref.id}; }
async function addDoc(col, data){ const id='id'+(++idSeq);
  (DB[col.__col]=DB[col.__col]||{})[id]={...data}; return {id}; }
async function updateDoc(ref, patch){
  const cur=(DB[ref.__doc]||{})[ref.id]; if(!cur) throw new Error('no doc '+ref.id);
  for(const [k,v] of Object.entries(patch)){
    if(v && v.__au){ cur[k]=[...(cur[k]||[]), ...v.__au]; } else cur[k]=v;
  }
}
const writeBatch=()=>{ const ops=[];
  return {update:(ref,p)=>ops.push([ref,p]), commit:async()=>{ for(const [r,p] of ops) await updateDoc(r,p); }}; };

// ── globals the app expects ────────────────────────────────────────────────
const g=dom.window;
global.window=g; global.document=g.document; global.navigator=g.navigator;
global.Image=g.Image; global.FileReader=g.FileReader; global.Blob=g.Blob;
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.setInterval=()=>0; global.clearInterval=()=>{};

const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=__f.collection, doc=__f.doc, query=__f.query, where=__f.where, orderBy=__f.orderBy,
    limit=__f.limit, serverTimestamp=__f.serverTimestamp, arrayUnion=__f.arrayUnion,
    getDocs=__f.getDocs, getDoc=__f.getDoc, addDoc=__f.addDoc, updateDoc=__f.updateDoc,
    writeBatch=__f.writeBatch, setDoc=async()=>{}, deleteDoc=async()=>{}, deleteField=()=>null,
    signOut=async()=>{}, onAuthStateChanged=()=>{}, getFirestore=()=>({}), getAuth=()=>({});
`;
const ctx={module:{exports:{}}, console, __f:{collection,doc,query,where,orderBy,limit,
  serverTimestamp,arrayUnion,getDocs,getDoc,addDoc,updateDoc,writeBatch},
  window:g, document:g.document, navigator:g.navigator, Image:g.Image, FileReader:g.FileReader,
  localStorage:global.localStorage, setInterval:()=>0, clearInterval:()=>{}, setTimeout, clearTimeout,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map, isFinite, parseFloat, parseInt};
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;

let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const eq=(n,a,b)=>ok(n+`  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, JSON.stringify(a)===JSON.stringify(b));

(async()=>{
  // The module-level identity variables are internal, so drive the app through
  // the same setters the real login path uses.
  vm.runInContext(`companyId='c1'; currentUserEmail='dima@x'; currentUserRole='agent';
    roleViewsMap={agent:{name:'Agent',views:['rfq']}, admin:{name:'Admin',views:['admin','settings']}};`, ctx);

  // ── a user files a request ───────────────────────────────────────────────
  await M.openSupportModal();
  await new Promise(r=>setTimeout(r,20));
  ok('modal opens', !!g.document.getElementById('support-modal-body'));
  ok('composer is there', !!g.document.getElementById('support-new-msg'));
  ok('a file can be attached to a new request', !!g.document.getElementById('support-new-files'));
  g.document.getElementById('support-new-msg').value='The export is corrupt';
  g.document.getElementById('btn-support-send').click();
  await new Promise(r=>setTimeout(r,50));
  const tickets=()=>Object.entries(DB['companies/c1/support_tickets']||{})
                          .map(([id,d])=>({_id:id,...d})).filter(t=>!t.kind);
  eq('the ticket is filed', tickets().length, 1);
  const t1=tickets()[0];
  eq('...as open', t1.status, 'open');
  eq('...flagged for the admin', t1.adminUnread, true);
  eq('...and not for the person who wrote it', t1.userUnread, false);

  // ── the admin answers ────────────────────────────────────────────────────
  vm.runInContext(`currentUserEmail='admin@x'; currentUserRole='admin';`, ctx);
  g.document.getElementById('content').innerHTML='<div id="adm-tickets-body"></div>';
  await M.renderAdminTicketsSection();
  await new Promise(r=>setTimeout(r,20));
  const tbody=g.document.getElementById('adm-tickets-tbody');
  ok('the admin table lists the ticket', tbody && tbody.querySelectorAll('tr[data-id]').length===1);
  ok('it is marked as new', /background:#E53E3E/.test(tbody.innerHTML));
  eq('opening the screen clears the admin flag', tickets()[0].adminUnread, false);

  M.openAdminReplyModal(t1._id);
  ok('the reply dialog shows the thread', /The export is corrupt/.test(g.document.getElementById('adm-reply-thread').innerHTML));
  ok('...labelled with who wrote it, not "You"', !/You/.test(g.document.getElementById('adm-reply-thread').innerHTML));
  ok('...and can attach a file', !!g.document.getElementById('adm-reply-files'));
  g.document.getElementById('adm-reply-inp').value='Fixed in 1.38';
  g.document.getElementById('adm-reply-status').value='done';
  g.document.getElementById('btn-adm-reply-save').click();
  await new Promise(r=>setTimeout(r,60));
  const t2=tickets()[0];
  eq('the reply is in the thread', (t2.thread||[]).length, 1);
  eq('...from the admin', t2.thread[0].role, 'admin');
  eq('...the chosen status wins over the default', t2.status, 'done');
  eq('...and the user is told', t2.userUnread, true);

  // ── the badge the user sees ──────────────────────────────────────────────
  vm.runInContext(`currentUserEmail='dima@x'; currentUserRole='agent';`, ctx);
  await M._supRefreshBadges();
  const badge=g.document.getElementById('sup-fab-badge');
  ok('the Support button carries a marker', badge && badge.textContent==='1');
  ok('a non-admin gets no admin chip', !g.document.getElementById('btn-adm-alert'));

  // ── the user replies to a closed ticket ──────────────────────────────────
  await M.openSupportModal();
  await new Promise(r=>setTimeout(r,40));
  const body=g.document.getElementById('support-modal-body');
  ok('their ticket is listed', /The export is corrupt/.test(body.innerHTML));
  ok('the admin answer is shown', /Fixed in 1\.38/.test(body.innerHTML));
  eq('opening Support clears their marker', tickets()[0].userUnread, false);
  const inp=body.querySelector('.sup-reply-inp');
  ok('a reply box is offered on the ticket', !!inp);
  inp.value='Still broken';
  body.querySelector('.sup-reply-send').click();
  await new Promise(r=>setTimeout(r,60));
  const t3=tickets()[0];
  eq('the reply lands in the same conversation', (t3.thread||[]).length, 2);
  eq('a reply re-opens a Done ticket', t3.status, 'open');
  eq('...and pulls the admin back in', t3.adminUnread, true);

  // ── the admin badge ──────────────────────────────────────────────────────
  vm.runInContext(`currentUserEmail='admin@x'; currentUserRole='admin';`, ctx);
  await M._supRefreshBadges();
  const chip=g.document.getElementById('btn-adm-alert');
  ok('the admin sees a chip in the top bar', chip && /1 support/.test(chip.textContent));
  eq('...and no marker on their own Support button', g.document.getElementById('sup-fab-badge'), null);

  // ── attachments are stored out of the way of the list ────────────────────
  await M._supUploadFiles(t1._id, [{name:'shot.png',type:'image/png',size:1234,data:'data:image/png;base64,AAAA'}]);
  const all=Object.values(DB['companies/c1/support_tickets']);
  eq('the attachment is its own document', all.filter(d=>d.kind==='file').length, 1);
  ok('...with no createdAt, so ticket lists never fetch it',
     all.filter(d=>d.kind==='file').every(d=>d.createdAt===undefined));
  const listed=await getDocs(query(collection(null,'companies','c1','support_tickets'),orderBy('createdAt','desc')));
  eq('a ticket listing returns tickets only', listed.docs.length, 1);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
