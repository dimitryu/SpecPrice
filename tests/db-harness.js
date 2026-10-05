/* Database screen: recycle bin and admin-only delete, rendered for real in a
   DOM against a fake Firestore that implements batches and deleteField. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body>
  <div id="shell"><div class="topbar"><button id="btn-home" style="display:none"></button>
  <h2 id="page-title"></h2><div id="topbar-actions"></div><div id="topbar-info"></div></div>
  <div id="content"></div></div><div id="toast-el"></div></body></html>`,{url:'https://x.test'});

const DB={}; let idSeq=0;
const DEL={__del:true};
const pathOf=a=>a.join('/');
const collection=(...a)=>({__col:pathOf(a.slice(1))});
const doc=(...a)=>({__doc:pathOf(a.slice(1,-1)), id:a[a.length-1]});
const query=(col,...cl)=>({...col, __order:cl.find(c=>c&&c.__o)});
const orderBy=(f,d)=>({__o:true,f,d});
const serverTimestamp=()=>new Date();
const arrayUnion=(...v)=>({__au:v});
const apply=(c,p)=>{ for(const [k,v] of Object.entries(p)){
  if(v===DEL) delete c[k]; else c[k]=(v&&v.__au)?[...(c[k]||[]),...v.__au]:v; } };
async function getDocs(q){
  const col=DB[q.__col]||{};
  let rows=Object.entries(col).map(([id,data])=>({id,data:()=>data,exists:()=>true,ref:{__doc:q.__col,id}}));
  if(q.__order){ const f=q.__order.f; rows=rows.filter(r=>r.data()[f]!=null); }
  return {docs:rows, size:rows.length, empty:!rows.length};
}
async function getDoc(ref){ const d=(DB[ref.__doc]||{})[ref.id]; return {exists:()=>!!d, data:()=>d, id:ref.id}; }
async function addDoc(col,data){ const id='id'+(++idSeq); (DB[col.__col]=DB[col.__col]||{})[id]=JSON.parse(JSON.stringify(data)); return {id}; }
async function setDoc(ref,data,opt){ const t=(DB[ref.__doc]=DB[ref.__doc]||{});
  if(opt&&opt.merge&&t[ref.id]) apply(t[ref.id],data); else { t[ref.id]={}; apply(t[ref.id],data); } }
async function updateDoc(ref,p){ const c=(DB[ref.__doc]||{})[ref.id]; if(!c) throw new Error('no doc'); apply(c,p); }
async function deleteDoc(ref){ delete (DB[ref.__doc]||{})[ref.id]; }
let batchCommits=0;
const writeBatch=()=>{ const ops=[]; return {
  update(r,p){ ops.push(()=>updateDoc(r,p)); }, set(r,d,o){ ops.push(()=>setDoc(r,d,o)); },
  delete(r){ ops.push(()=>deleteDoc(r)); }, commit:async()=>{ batchCommits++; for(const o of ops) await o(); } }; };

const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=__f.collection, doc=__f.doc, query=__f.query, orderBy=__f.orderBy, where=()=>({}), limit=()=>({}),
    serverTimestamp=__f.serverTimestamp, arrayUnion=__f.arrayUnion,
    getDocs=__f.getDocs, getDoc=__f.getDoc, addDoc=__f.addDoc, updateDoc=__f.updateDoc,
    setDoc=__f.setDoc, deleteDoc=__f.deleteDoc, writeBatch=__f.writeBatch,
    deleteField=()=>__f.DEL, signOut=async()=>{};
var _csLang='en', _csCache={en:{},he:{},ru:{}};
var psPageSize=20;   // read from localStorage by the app, so the extractor skips it
`;
const ctx={module:{exports:{}}, console,
  __f:{collection,doc,query,orderBy,serverTimestamp,arrayUnion,getDocs,getDoc,addDoc,updateDoc,setDoc,deleteDoc,writeBatch,DEL},
  window:g, document:g.document, navigator:g.navigator,
  localStorage:{getItem:()=>'1',setItem(){},removeItem(){}},
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;

let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const no=(n,c)=>ok(n,!c);
const PC='companies/c1/parts_cache', AL='companies/c1/audit_logs';
const audits=a=>Object.values(DB[AL]||{}).filter(x=>x.action===a);
const html=()=>g.document.getElementById('content').innerHTML;
const actions=()=>g.document.getElementById('topbar-actions').innerHTML+html();
const tick=()=>new Promise(r=>setTimeout(r,0));
const DAY=86400000;

(async()=>{
  DB[PC]={
    'P-LIVE-1':{part_number:'P-LIVE-1', description:'Connector 13 pos', manufacturer:'Amphenol'},
    'P-LIVE-2':{part_number:'P-LIVE-2', description:'Wire 22 AWG', manufacturer:'TE'},
    'P-OLD':   {part_number:'P-OLD', description:'Old part', deleted:true, deletedAtMs:Date.now()-40*DAY, deletedBy:'a@x'},
    'P-RECENT':{part_number:'P-RECENT', description:'Recently deleted', deleted:true, deletedAtMs:Date.now()-2*DAY, deletedBy:'a@x'},
  };
  DB['companies']={c1:{name:'Radion'}};

  // ── a regular user: sees only live parts, and cannot delete ─────────────
  vm.runInContext(`companyId='c1'; currentUserEmail='user@x'; currentUserRole='agent';
    allParts=[]; trashParts=[]; _psTrashDays=30;`, ctx);
  await M.renderPartStock('');
  ok('user: the Database lists the live parts', /P-LIVE-1/.test(html()) && /P-LIVE-2/.test(html()));
  no('user: ...and never a deleted one', /P-RECENT|P-OLD/.test(html()));
  no('user: no Delete button', /btn-ps-delsel/.test(actions()));
  no('user: no recycle bin', /btn-ps-trash/.test(actions()));
  ok('user: nothing is purged from a user session', !!DB[PC]['P-OLD']);

  // ── an admin: parts past their retention are purged on opening ──────────
  vm.runInContext(`currentUserEmail='admin@x'; currentUserRole='admin'; allParts=[]; trashParts=[];`, ctx);
  await M.renderPartStock('');
  no('admin: a part deleted 40 days ago is gone for good', !!DB[PC]['P-OLD']);
  ok('admin: ...and the audit log kept its content first',
     audits('database_purge_parts').some(a=>(a.details.items||[]).some(i=>i.part_number==='P-OLD' && i.description==='Old part')));
  ok('admin: a part deleted 2 days ago is still in the bin', DB[PC]['P-RECENT'] && DB[PC]['P-RECENT'].deleted===true);
  ok('admin: Delete Selected is there', /btn-ps-delsel/.test(actions()));
  ok('admin: the bin shows how many it holds', /Deleted items \(1\)/.test(actions()));

  // ── delete = move to the bin ───────────────────────────────────────────
  g.document.querySelector('.ps-check[data-id="P-LIVE-1"]').checked=true;
  g.document.getElementById('btn-ps-delsel').click();
  for(let i=0;i<6;i++) await tick();
  ok('delete: the document is kept', !!DB[PC]['P-LIVE-1']);
  ok('delete: ...marked deleted', DB[PC]['P-LIVE-1'].deleted===true);
  ok('delete: ...with who and when', DB[PC]['P-LIVE-1'].deletedBy==='admin@x' && DB[PC]['P-LIVE-1'].deletedAtMs>0);
  no('delete: ...and it leaves the screen', /P-LIVE-1/.test(html()));
  ok('delete: it is out of every screen\'s list', !vm.runInContext('allParts', ctx).some(p=>p._id==='P-LIVE-1'));
  const da=audits('database_delete_parts').pop();
  ok('audit: the delete records the part itself, not just a count',
     da && da.details.count===1 && da.details.items[0].part_number==='P-LIVE-1'
        && da.details.items[0].description==='Connector 13 pos' && da.details.items[0].manufacturer==='Amphenol');

  // ── the bin: restore ───────────────────────────────────────────────────
  g.document.getElementById('btn-ps-trash').click();
  await tick();
  const body=()=>g.document.getElementById('trash-body').innerHTML;
  ok('bin: lists both deleted parts', /P-LIVE-1/.test(body()) && /P-RECENT/.test(body()));
  ok('bin: says who deleted them', /admin@x/.test(body()));
  ok('bin: and how many days are left', />28</.test(body()) && />30</.test(body()));
  g.document.querySelector('.trash-check[data-id="P-LIVE-1"]').checked=true;
  g.document.getElementById('trash-restore').click();
  for(let i=0;i<6;i++) await tick();
  ok('restore: the part is live again', DB[PC]['P-LIVE-1'].deleted===false);
  no('restore: ...with the deletion stamps removed', 'deletedBy' in DB[PC]['P-LIVE-1'] || 'deletedAtMs' in DB[PC]['P-LIVE-1']);
  ok('restore: ...back in the list every screen reads', vm.runInContext('allParts', ctx).some(p=>p._id==='P-LIVE-1'));
  ok('restore: ...and recorded', audits('database_restore_parts').some(a=>a.details.items[0].part_number==='P-LIVE-1'));

  // ── the bin: delete permanently ────────────────────────────────────────
  g.document.querySelector('.trash-check[data-id="P-RECENT"]').checked=true;
  g.document.getElementById('trash-purge').click();
  for(let i=0;i<6;i++) await tick();
  no('purge: the part is gone for good', !!DB[PC]['P-RECENT']);
  ok('purge: ...after its content went into the audit log',
     audits('database_purge_parts').some(a=>a.details.reason==='manual' && a.details.items[0].description==='Recently deleted'));

  // ── retention is a company setting ─────────────────────────────────────
  const sel=g.document.getElementById('trash-days');
  sel.value='7'; sel.dispatchEvent(new g.Event('change'));
  for(let i=0;i<4;i++) await tick();
  ok('retention: the admin can change it', DB['companies'].c1.trash_days===7 && vm.runInContext('_psTrashDays', ctx)===7);
  ok('retention: unknown values fall back to 30', M._psTrashDaysOf('abc')===30 && M._psTrashDaysOf(90)===90);
  M.closeModal();

  // ── saving a part that is in the bin brings it back ────────────────────
  await M._psSoftDelete(['P-LIVE-2']);
  ok('revive: P-LIVE-2 is in the bin', DB[PC]['P-LIVE-2'].deleted===true);
  await M.saveBOMToPartStock([{part_number:'P-LIVE-2', description:'Wire 22 AWG'}]);
  ok('revive: re-saving it from a BOM brings it back', DB[PC]['P-LIVE-2'].deleted===false);
  ok('revive: ...into the list the screens read', vm.runInContext('allParts', ctx).some(p=>p._id==='P-LIVE-2'));
  no('revive: ...and out of the bin', vm.runInContext('trashParts', ctx).some(p=>p._id==='P-LIVE-2'));

  // ── a big delete is audited in chunks that fit a Firestore document ─────
  const many={}; for(let i=0;i<250;i++) many['M'+i]={part_number:'M'+i, description:'x'.repeat(200)};
  Object.assign(DB[PC], many);
  vm.runInContext(`allParts=[]; trashParts=[];`, ctx); await M.loadParts();
  const before=audits('database_delete_parts').length;
  await M._psSoftDelete(Object.keys(many));
  const chunks=audits('database_delete_parts').slice(before);
  ok('audit: 250 parts are recorded in 3 entries of at most 100', chunks.length===3 && chunks.every(c=>c.details.items.length<=100));
  ok('audit: ...all of them', chunks.reduce((n,c)=>n+c.details.items.length,0)===250);
  ok('audit: ...each well under the 1 MiB document limit', chunks.every(c=>JSON.stringify(c).length<900000));

  // ── a user session cannot reach the delete even by calling it ──────────
  vm.runInContext(`currentUserRole='agent';`, ctx);
  ok('guard: the role check is the admin role', M._psIsAdmin()===false);
  ok('guard: and no auto purge runs for a user', (await M._psAutoPurge())===0);

  // pure helpers
  const now=Date.now();
  ok('days: a fresh delete has the full period left', M._psDaysLeft({deletedAtMs:now},30,now)===30);
  ok('days: 29.5 days in leaves one', M._psDaysLeft({deletedAtMs:now-29.5*DAY},30,now)===1);
  ok('days: past the period it is due', M._psDaysLeft({deletedAtMs:now-31*DAY},30,now)===0);
  ok('days: a server timestamp works too', M._psDeletedMs({deletedAt:{toMillis:()=>123}})===123);
  const cp=M._psAuditCopy({_id:'X', part_number:'X', updatedAt:{toDate:()=>new Date('2026-01-02T03:04:05Z')}});
  ok('audit copy: keeps the id and writes timestamps as ISO', cp.id==='X' && cp.updatedAt==='2026-01-02T03:04:05.000Z' && !('_id' in cp));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
