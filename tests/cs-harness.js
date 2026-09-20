/* Cut & Strip form + Manufacturing Instructions: renders both screens for real
   in a DOM, against a fake Firestore, and checks what is on them — and, just
   as importantly, what is no longer on them. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');

const dom=new JSDOM(`<!doctype html><html><body>
  <div id="shell"><div class="topbar"><button id="btn-home" style="display:none"></button>
  <h2 id="page-title"></h2><div id="topbar-actions"></div><div id="topbar-info"></div></div>
  <div id="content"></div></div>
  <button id="btn-support-fab"></button><div id="toast-el"></div></body></html>`,{url:'https://x.test'});

const DB={}; let idSeq=0;
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
  let rows=Object.entries(col).map(([id,data])=>({id,data:()=>data,exists:()=>true}));
  if(q.__order){ const f=q.__order.f; rows=rows.filter(r=>r.data()[f]!=null); }
  for(const w of (q.__where||[])) rows=rows.filter(r=>r.data()[w.f]===w.v);
  return {docs:rows, size:rows.length, empty:!rows.length};
}
async function getDoc(ref){ const d=(DB[ref.__doc]||{})[ref.id]; return {exists:()=>!!d, data:()=>d, id:ref.id}; }
async function addDoc(col,data){ const id='id'+(++idSeq); (DB[col.__col]=DB[col.__col]||{})[id]={...data}; return {id}; }
async function setDoc(ref,data){ (DB[ref.__doc]=DB[ref.__doc]||{})[ref.id]={...data}; }
async function updateDoc(ref,p){ const c=(DB[ref.__doc]||{})[ref.id]; if(!c) throw new Error('no doc');
  for(const [k,v] of Object.entries(p)) c[k]= (v&&v.__au)?[...(c[k]||[]),...v.__au]:v; }
async function deleteDoc(ref){ delete (DB[ref.__doc]||{})[ref.id]; }
const writeBatch=()=>({update(){},commit:async()=>{}});

const g=dom.window;
global.window=g; global.document=g.document; global.navigator=g.navigator;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=__f.collection, doc=__f.doc, query=__f.query, where=__f.where, orderBy=__f.orderBy,
    limit=__f.limit, serverTimestamp=__f.serverTimestamp, arrayUnion=__f.arrayUnion,
    getDocs=__f.getDocs, getDoc=__f.getDoc, addDoc=__f.addDoc, updateDoc=__f.updateDoc,
    setDoc=__f.setDoc, deleteDoc=__f.deleteDoc, writeBatch=__f.writeBatch,
    deleteField=()=>null, signOut=async()=>{};
var _csLang='en', _csCache={en:{},he:{},ru:{}};   // the only ones the extractor cannot lift (it reads localStorage)
`;
const ctx={module:{exports:{}}, console,
  __f:{collection,doc,query,where,orderBy,limit,serverTimestamp,arrayUnion,getDocs,getDoc,addDoc,updateDoc,setDoc,deleteDoc,writeBatch},
  window:g, document:g.document, navigator:g.navigator, localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;

let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const no=(n,c)=>ok(n,!c);

const SPEC={_id:'CBL-1', kind:undefined, drawing_number:'CBL-1', drawing_name:'Power harness 3C',
  revision:'2', project:'Politex', spec_no:'CS-CBL-1-01', standard:'IPC/WHMA-A-620',
  materials:[{item:1, part_number:'MAT-1', description:'Backshell', qty:2, ref:'P1'}],
  connectors:[{ref:'P1', kind:'connector', part_number:'TV06RW1135SF472A', contact_pn:'55A0111-22-0', termination:'crimp'},
              {ref:'P2', kind:'open_wires', part_number:''}],
  segments:[{id:'S1', from:'P1', to:'P2', cable_part_number:'STJ14X3-622-4',
    cable_description:'14AWG x 3C', finished_length_mm:4000,
    conductor_strip_mm:45, conductor_strip_confirmed:true,
    conductors:[{from_pin:'1',to_pin:'A',color:'RED',awg:'14'},{from_pin:'2',to_pin:'B',color:'BLK',awg:'14'}],
    ends:[{ref:'P1', strip:[{code:'A', label:'Jacket', value_mm:170, confirmed:true}]},
          {ref:'P2', strip:[{code:'A', label:'Jacket', value_mm:170, confirmed:true}]}]}],
  steps:[{n:1,title:'Cut to length',body:'Cut square',critical:'No nicks'}],
  inspection:['No nicked strands','Crimp height within spec'],
  tools:[{tool:'Crimper M22520/1-01', setting:'4', note:'Calibrated'}],
  markers:[{label:'1', part_number:'LBL-1', text_lines:['CBL-1'], distance_mm:100, from_end:'P1', confirmed:true}],
  updatedAt:new Date()};

(async()=>{
  vm.runInContext(`companyId='c1'; currentUserEmail='dima@x'; currentUserRole='admin';
    companyName='Radion Engineering'; companyLogoB64='';`, ctx);
  DB['companies/c1/cut_strip_specs']={'CBL-1':JSON.parse(JSON.stringify(SPEC))};

  // ── the cutting form ─────────────────────────────────────────────────
  vm.runInContext(`csCurrent=${JSON.stringify(SPEC)};`, ctx);
  M.renderCutStripSheet();
  const html=g.document.getElementById('content').innerHTML;

  ok('form: it renders', /cs-sheet/.test(html));
  ok('form: titled as the works\' form', /cutting and stripping form/i.test(html));
  ok('form: 1 Planning', /Planning<\/h2>/.test(html));
  ok('form: 2 Harness layout — moved to the front', /Harness layout/.test(html));
  ok('form: layout comes BEFORE the cut table',
     html.indexOf('Harness layout') < html.indexOf('Execution'));
  ok('form: 3 Execution — cut & strip', /Execution — cut &amp; strip|Execution — cut & strip/.test(html));
  ok('form: the cut length is on it', /4560|45[0-9]0/.test(html) || /Length \[mm\]/.test(html));
  ok('form: the strip column is on it', /Strip \[mm\]/.test(html));
  ok('form: the operator and date columns are there to fill in by hand',
     /Operator<\/th>/.test(html));
  ok('form: 4 Connectors kept', /Connectors<\/h2>/.test(html));
  ok('form: 5 Schematic', /Schematic/.test(html));
  ok('form: the wire-end figure is drawn', /WIRE END PREPARATION/.test(html));
  ok('form: 6 Notes', /Notes<\/h2>/.test(html));
  ok('form: 7 Approval with a signature column', /Approval<\/h2>/.test(html) && /Signature/.test(html));

  // what must no longer be here
  no('form: no material list', /Material list/.test(html));
  no('form: no operation sequence', /Operation sequence/.test(html));
  no('form: no inspection section', /Inspection<\/h2>/.test(html));
  no('form: no tools section', /Tools &amp; consumables/.test(html));
  no('form: no label table', /Label table/.test(html));
  no('form: no wiring table', /Wiring table/.test(html));
  no('form: no "read this first" summary page', /read this first/.test(html));

  ok('form: it offers the way across to manufacturing', /btn-cs-mfg/.test(html)
     || /To Manufacturing/.test(g.document.getElementById('topbar-actions').innerHTML));

  // ── edit mode: every field must write to a field of its own ──────────
  vm.runInContext(`_csEditing=true;`, ctx);
  M.renderCutStripSheet();
  const paths=[...g.document.querySelectorAll('#cs-sheet [data-cs-path]')].map(e=>e.dataset.csPath);
  const dupes=paths.filter((p,i)=>paths.indexOf(p)!==i);
  ok('edit: no two inputs write to the same field  ('+dupes.join(',')+')', dupes.length===0);
  ok('edit: the notes box is editable', paths.includes('form_notes'));
  ok('edit: the approval names are editable',
     paths.includes('prepared_by') && paths.includes('approved_by'));
  vm.runInContext(`_csEditing=false;`, ctx);

  // ── Hebrew ───────────────────────────────────────────────────────────
  vm.runInContext(`_csLang='he';`, ctx);
  M.renderCutStripSheet();
  const he=g.document.getElementById('content').innerHTML;
  ok('hebrew: the sheet turns round', /dir="rtl"/.test(he));
  ok('hebrew: the form carries its Hebrew title', /טופס חיתוך ופריסות חוטים וכבלים/.test(he));
  ok('hebrew: the execution columns are the paper form\'s', /אורך \[מ״מ\]/.test(he) && /חשיפה \[מ״מ\]/.test(he));
  ok('hebrew: ...including who did it', /שם המבצע/.test(he));
  ok('hebrew: the figure speaks Hebrew too', /הכנת קצה חוט/.test(he));
  vm.runInContext(`_csLang='en';`, ctx);

  // ── manufacturing instructions ───────────────────────────────────────
  await M.renderManufacturing();
  ok('mfg: the empty state explains itself',
     /No manufacturing instructions yet/.test(g.document.getElementById('content').innerHTML));

  M._mfgFromCurrentSpec();
  const mh=g.document.getElementById('content').innerHTML;
  ok('mfg: the document opens in edit mode', /data-mfg-path/.test(mh));
  ok('mfg: the material list came across', /MAT-1/.test(mh));
  ok('mfg: the operation step came across', /Cut to length/.test(mh));
  ok('mfg: the inspection check came across', /nicked strands/.test(mh));
  ok('mfg: the tooling came across', /M22520/.test(mh));
  no('mfg: the cutting content did not', /WIRE END PREPARATION/.test(mh));

  g.document.getElementById('btn-mfg-save').click();
  await new Promise(r=>setTimeout(r,40));
  const saved=Object.entries(DB['companies/c1/cut_strip_specs']).filter(([,d])=>d.kind==='mfg');
  ok('mfg: it saves', saved.length===1);
  ok('mfg: ...under an id of its own kind', saved[0][0].startsWith('mfg_'));
  ok('mfg: ...without touching the specification',
     DB['companies/c1/cut_strip_specs']['CBL-1'].kind===undefined);

  // The two lists must not show each other's documents.
  const specs=await M.loadCutStripSpecs(true);
  ok('lists: the cut & strip list shows only specifications',
     specs.length===1 && specs[0]._id==='CBL-1');
  const mdocs=await M.loadMfgDocs(true);
  ok('lists: the instruction list shows only instructions',
     mdocs.length===1 && mdocs[0].kind==='mfg');

  await M.renderManufacturing();
  ok('mfg: the saved document is listed',
     /Power harness 3C/.test(g.document.getElementById('content').innerHTML));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
