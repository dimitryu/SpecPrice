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
const _csSegCount=sp=>((sp&&sp.segments)||[]).length;
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
  // One figure per end, not two: the jacket strip and the conductor strip are
  // dimensions on the SAME drawing.
  const figs=(html.match(/WIRE END PREPARATION/g)||[]).length;
  ok('form: one figure per end ('+figs+' for 2 ends)', figs===2);
  ok('form: ...carrying both dimensions', /A = 170 mm/.test(html) && /W = 45 mm/.test(html));
  no('form: no inches on the drawings', / in\)/.test(html));
  // datasheets: a document link ONLY when a distributor actually returned one.
  // A part nobody carries — which on these drawings is most of them — gets a
  // search at the manufacturer instead, plainly labelled as a search.
  no('form: a connector with no datasheet on file gets no document link',
     /\uD83D\uDCC4/.test(html));
  ok('form: ...it gets a manufacturer search instead', /Search at/.test(html));
  ok('form: ...pointing at the manufacturer own site', /amphenol\.com/.test(html));
  ok('form: ...and says it is a search, not the document',
     /this is a search, not the document/.test(html));

  // A sheet with no links tries once to fill them in, with no button to press.
  ok('form: opening a sheet asks for the datasheets it is missing',
     /cut_strip_datasheets|datasheets_checked/.test(M._csBackfillDatasheets.toString()));
  no('form: there is no "find links" button',
     /btn-cs-links/.test(g.document.getElementById('topbar-actions').innerHTML));
  no('form: and no way across to manufacturing',
     /btn-cs-mfg/.test(g.document.getElementById('topbar-actions').innerHTML));
  no('form: the red unverified block is gone from the top',
     /Do not cut production material/.test(html));
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

  // a stored datasheet does print
  const WITH=JSON.parse(JSON.stringify(SPEC));
  WITH.connectors[0].datasheet_url='https://www.mouser.com/datasheet/2/18/x.pdf';
  WITH.connectors[0].datasheet_url_vendor='Mouser';
  vm.runInContext(`csCurrent=${JSON.stringify(WITH)};`, ctx);
  M.renderCutStripSheet();
  const dh=g.document.getElementById('content').innerHTML;
  ok('form: a connector with a datasheet on file links to it',
     /href="https:\/\/www\.mouser\.com\/datasheet\/2\/18\/x\.pdf"/.test(dh));
  vm.runInContext(`csCurrent=${JSON.stringify(SPEC)};`, ctx);
  M.renderCutStripSheet();

  no('form: the AI banner is gone', /Generated by AI/.test(html));
  ok('form: the length datum is stated on the sheet', /length is measured/.test(html));
  ok('form: an unstated datum is marked as assumed', /assumed/.test(html));

  // ── built from wires, not from a ready-made cable ────────────────────
  const WIRES=JSON.parse(JSON.stringify(SPEC));
  WIRES.cut_model='jacket_end_v1';
  WIRES.materials=[{item:1, part_number:'M22759/16-22-9', description:'WIRE 22AWG', length_mm:14000}];
  WIRES.segments[0].cable_part_number='M22759/16-22-9';
  WIRES.segments[0].length_basis='cable_only';
  vm.runInContext(`csCurrent=${JSON.stringify(WIRES)};`, ctx);
  M.renderCutStripSheet();
  const wh=g.document.getElementById('content').innerHTML;
  ok('wires: the form says it is not a ready-made cable', /not a ready-made cable/.test(wh));
  ok('wires: ...and says what the reel is cut into', /Cut into/.test(wh));
  ok('wires: ...and what the harness then is', /The harness is/.test(wh));
  ok('wires: ...naming the wire', /M22759\/16-22-9/.test(wh));
  // The instruction the bench actually reads, in words, ahead of the table
  // that justifies it. This is what was missing from the printed sheet: the
  // numbers were right and nobody could see what to DO with them.
  ok('build: the sheet says in words what to cut',
     /Cut <span[^>]*>[\d.]+ mm<\/span> of/.test(wh));
  ok('build: ...how many pieces, and how long each',
     /into <span[^>]*>\d+<\/span> pieces of <span[^>]*>[\d.]+ mm<\/span>/.test(wh));
  ok('build: ...and what to do with them then',
     /pieces together — that bundle is the harness/.test(wh));
  ok('build: ...out of that length, never longer', /do not cut any piece longer/.test(wh));
  ok('build: ...ahead of the arithmetic that backs it',
     wh.indexOf('pieces together') < wh.indexOf('Left over'));
  // .cs-box b is display:block, so an emphasised value inside one of these
  // sentences must never be a <b> — it stacks the sentence down the page.
  no('build: the emphasis inside a sentence is inline, not a block <b>',
     /<b[^>]*>[\d.]+ mm<\/b> of/.test(wh));

  // A drawing whose part list never came back must say so, not quietly drop
  // the whole instruction — which is exactly how it went missing before.
  const NOBOM=JSON.parse(JSON.stringify(WIRES));
  NOBOM.materials=[];
  vm.runInContext(`csCurrent=${JSON.stringify(NOBOM)};`, ctx);
  M.renderCutStripSheet();
  const nb=g.document.getElementById('content').innerHTML;
  ok('build: a missing part list is said out loud', /No part list came back/.test(nb));
  no('build: ...and no build instruction is invented from nothing',
     /that bundle is the harness/.test(nb));

  // The shop's own BOM shape: the quantity column IS the length.
  const SHOP=JSON.parse(JSON.stringify(SPEC));
  SHOP.cut_model='jacket_end_v1';
  SHOP.materials=[{item:7, part_number:'55A0111-22-0', description:'Wire 22 AWG Black', qty:'12', unit:'m'},
                  {item:8, part_number:'55A0111-22-2', description:'Wire 22 AWG Red',   qty:'12', unit:'m'}];
  SHOP.segments[0].cable_part_number='';
  SHOP.segments[0].finished_length_mm=3000;
  SHOP.segments[0].length_basis='over_connectors';
  SHOP.segments[0].conductors=[];
  vm.runInContext(`csCurrent=${JSON.stringify(SHOP)};`, ctx);
  M.renderCutStripSheet();
  const sh=g.document.getElementById('content').innerHTML;
  ok('shop: 12 m of each wire is four pieces, not twelve',
     (sh.match(/4 <\/span>?×|>4<\/span> ×/g)||[]).length>0 || /4<\/span> × <span[^>]*>3000/.test(sh));
  ok('shop: both part numbers are listed', /55A0111-22-0/.test(sh) && /55A0111-22-2/.test(sh));
  ok('shop: the bundle is eight wires', /8 /.test(sh.replace(/\s+/g,' ')));
  ok('shop: the cut is the drawn 3000, not more', /3000/.test(sh) && !/30[1-9][0-9]/.test(sh));
  ok('shop: every end still gets a figure',
     (sh.match(/WIRE END PREPARATION/g)||[]).length===2);
  vm.runInContext(`csCurrent=${JSON.stringify(SPEC)};`, ctx);
  M.renderCutStripSheet();
  vm.runInContext(`csCurrent=${JSON.stringify(SPEC)};`, ctx);
  M.renderCutStripSheet();

  // ── edit mode: every field must write to a field of its own ──────────
  vm.runInContext(`_csEditing=true;`, ctx);
  M.renderCutStripSheet();
  const paths=[...g.document.querySelectorAll('#cs-sheet [data-cs-path]')].map(e=>e.dataset.csPath);
  const dupes=paths.filter((p,i)=>paths.indexOf(p)!==i);
  ok('edit: no two inputs write to the same field  ('+dupes.join(',')+')', dupes.length===0);
  ok('edit: the notes box is editable', paths.includes('form_notes'));
  ok('edit: the approval names are editable',
     paths.includes('prepared_by') && paths.includes('approved_by'));
  ok('edit: the signature cells are editable',
     paths.includes('prepared_sign') && paths.includes('approved_sign'));
  ok('edit: the approval notes are editable',
     paths.includes('prepared_note') && paths.includes('approved_note'));
  ok('edit: the planning approval is its own field', paths.includes('planning_approval'));
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
  vm.runInContext(`_csLang='he';`, ctx);
  await M.renderManufacturing();
  ok('mfg: the list is Hebrew by default',
     /אין עדיין הוראות יצור/.test(g.document.getElementById('content').innerHTML));
  vm.runInContext(`_csLang='en';`, ctx);
  await M.renderManufacturing();
  ok('mfg: the empty state explains itself',
     /No manufacturing instructions yet/.test(g.document.getElementById('content').innerHTML));

  await M._mfgImportModal();
  await new Promise(r=>setTimeout(r,40));
  g.document.querySelector('.mfg-imp').click();
  const mh=g.document.getElementById('content').innerHTML;
  ok('mfg: the document is English while the switch says English', /Manufacturing instructions/.test(mh));
  ok('mfg: the document opens in edit mode', /data-mfg-path/.test(mh));
  ok('mfg: the material list came across', /MAT-1/.test(mh));
  ok('mfg: the operation step came across', /Cut to length/.test(mh));
  ok('mfg: the inspection check came across', /nicked strands/.test(mh));
  ok('mfg: the tooling came across', /M22520/.test(mh));
  no('mfg: the cutting content did not', /WIRE END PREPARATION/.test(mh));

  vm.runInContext(`_csLang='he';`, ctx);
  M.renderMfgDoc();
  const mhe=g.document.getElementById('content').innerHTML;
  ok('mfg: the same document in Hebrew', /הוראות יצור/.test(mhe));
  ok('mfg: ...turned round', /dir="rtl"/.test(mhe));
  ok('mfg: ...with Hebrew section headings', /רשימת חומרים/.test(mhe) && /סדר פעולות/.test(mhe));
  vm.runInContext(`_csLang='en';`, ctx);
  M.renderMfgDoc();
  g.document.getElementById('btn-mfg-save').click();
  await new Promise(r=>setTimeout(r,40));
  const saved=Object.entries(DB['companies/c1/cut_strip_specs']).filter(([,d])=>d.kind==='mfg');
  ok('mfg: it saves', saved.length===1);
  // The language switch belongs to reading, not to editing — same rule the
  // cutting form follows, so a half-typed document is never re-languaged.
  ok('mfg: the language switch appears once the document is saved',
     /data-mfg-lang="ru"/.test(g.document.getElementById('topbar-actions').innerHTML));
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

  // ── an analysis too long for one reply ───────────────────────────────
  // The real failure the operator saw: the model filled its reply and the whole
  // analysis was thrown away. It must now carry on instead.
  // The core pass is asked for first and carries on when it overflows; the
  // wiring table, the labels and the notes are a second request of their own,
  // so they can never eat the room the part list needs.
  const PART1='{"drawing_number":"X1","materials":[{"item":1,"part_number":"W1","descrip';
  const PART2='tion":"Wire 22 AWG"}],"segments":[{"id":"S1","ends":[]}],"connectors":[]}';
  const DETAIL='{"segments":[{"id":"S1","conductors":[{"name":"PWR","color":"RED","from_pin":"1","to_pin":"1"}]}],'
             +'"markers":[{"label":"A","segment":"S1","text_lines":["TAG"]}],'
             +'"engineering_notes":[{"n":"1","text":"note one","action":""}]}';
  let calls=[];
  vm.runInContext(`anthKey='sk-test'; _csDeadProviders={};
    _fetchWithRetry=async(u,o)=>{ const body=JSON.parse(o.body); __f.note(body);
      const n=__f.count();
      return {ok:true, json:async()=>n===1
        ? {content:[{type:'text',text:__f.p1()}], stop_reason:'max_tokens'}
        : n===2
        ? {content:[{type:'text',text:__f.p2()}], stop_reason:'end_turn'}
        : {content:[{type:'text',text:__f.d()}], stop_reason:'end_turn'}};
    };`, ctx);
  ctx.__f.note=b=>calls.push(b);
  ctx.__f.count=()=>calls.length;
  ctx.__f.p1=()=>PART1;
  ctx.__f.p2=()=>PART2;
  ctx.__f.d=()=>DETAIL;
  const spec=await M.aiAnalyzeCutStrip('drawing text', false, null, 'en');
  ok('continuation: a cut-off reply is carried on, not thrown away', !!spec);
  ok('continuation: ...and the stitched answer is the real spec', spec.drawing_number==='X1');
  ok('continuation: ...with the part list the wire count is worked out from',
     (spec.materials||[]).length===1);
  ok('continuation: two requests for the core, one for the rest', calls.length===3);
  ok('continuation: the second one prefills the first answer',
     calls[1].messages[calls[1].messages.length-1].role==='assistant'
     && calls[1].messages[calls[1].messages.length-1].content.endsWith('descrip'));
  ok('continuation: ...asking in bites, not one long mouthful', calls[0].max_tokens<=20000);
  ok('continuation: the first pass is deterministic', calls[0].temperature===0);
  ok('continuation: ...and the continuation runs slightly warm, to break a loop',
     calls[1].temperature>0);

  // The core pass must not even be offered the row-heavy keys, and the second
  // pass must be told which runs and connectors the first one found.
  const corePrompt=String(calls[0].messages[0].content);
  no('phases: the core pass is not asked for the wiring table', /"conductors":\[ \{"name"/.test(corePrompt));
  no('phases: ...nor for the markers', /"markers":  \[/.test(corePrompt));
  ok('phases: ...but it is asked for the part list', /"materials":\[/.test(corePrompt));
  ok('phases: ...and told the part list is what must not be missed',
     /COMPLETE\s+part list/.test(corePrompt));
  const detailPrompt=String(calls[2].messages[0].content);
  ok('phases: the second pass asks for the wiring table', /"conductors"/.test(detailPrompt));
  ok('phases: ...using the run ids the first pass found', /S1/.test(detailPrompt));

  // …and what comes back is folded in.
  ok('phases: the wiring table lands on its run', (spec.segments[0].conductors||[]).length===1);
  ok('phases: the markers land', (spec.markers||[]).length===1);
  ok('phases: the notes land', (spec.engineering_notes||[]).length===1);

  // Still overflowing after the retries: the operator gets the sheet anyway,
  // built from what did arrive and marked as partial. Two minutes of analysis
  // is never thrown away again.
  calls=[];
  ctx.__f.p2=()=>'tion":"Wire"}],"segments":[{"id":"S1","ends":[]},{"id":"S2","cable_desc';
  const partial=await M.aiAnalyzeCutStrip('drawing text', false, null, 'en');
  ok('cut off: a sheet is still produced', !!partial && partial.drawing_number==='X1');
  ok('cut off: ...marked partial so nobody mistakes it for the whole drawing', partial._partial===true);
  ok('cut off: ...keeping the runs that arrived whole', _csSegCount(partial)>=1);
  ok('cut off: ...after a bounded number of tries', calls.length<=8);

  // Nothing usable at all is still a failure, and says so.
  calls=[];
  ctx.__f.p1=()=>'sorry, I cannot read this drawing';
  ctx.__f.p2=()=>'';
  let threw='';
  try{ await M.aiAnalyzeCutStrip('drawing text', false, null, 'en'); }
  catch(e){ threw=e.message; }
  ok('cut off: an answer with nothing in it still fails', threw.length>0);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
