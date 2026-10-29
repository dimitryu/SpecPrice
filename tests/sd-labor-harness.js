/* Sales Desk "From File": the labor minutes the process analysis ties to each
   BOM row must land on that row once — not on every row that happens to share
   its part number. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body>
  <div id="modal-bg"><div class="modal"><div id="sd-modal-body"></div><div class="modal-foot"></div></div></div>
  <div id="shell"><div class="topbar"><button id="btn-home"></button><h2 id="page-title"></h2><div id="topbar-actions"></div><div id="topbar-info"></div></div><div id="content"></div></div><div id="toast-el"></div></body></html>`,{url:'https://x.test'});
const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=()=>({}), doc=(...a)=>({id:a[a.length-1]}), addDoc=async()=>({id:'x'}), serverTimestamp=()=>new Date(),
    getDocs=async()=>({docs:[]}), getDoc=async()=>({exists:()=>false,data:()=>({})}), setDoc=async()=>{}, updateDoc=async()=>{},
    query=()=>({}), orderBy=()=>({}), arrayUnion=(...v)=>v, deleteField=()=>null, writeBatch=()=>({update(){},commit:async()=>{}});
var _csLang='en', _csCache={en:{},he:{},ru:{}}, psPageSize=20, _sdCollapsedRows=new Set();
`;
const ctx={module:{exports:{}}, console:{log(){},warn(){},error:console.error}, __f:{},
  window:g, document:g.document, navigator:g.navigator,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;
let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const no=(n,c)=>ok(n,!c);
const tick=()=>new Promise(r=>setTimeout(r,0));

// The sheet as it came back: the same manufacturer number on five lines (four
// wire lines and a misread connector), and twice on two more.
const ROWS=[
  {item:'1',part_number:'2126/19-2',description:'Wire 26 awg RED',qty:'2000',unit:'mm'},
  {item:'2',part_number:'2126/19-2',description:'Wire 26 awg BLACK',qty:'2000',unit:'mm'},
  {item:'3',part_number:'2126/19-2',description:'Wire 26 awg RED',qty:'2000',unit:'mm'},
  {item:'4',part_number:'2126/19-2',description:'Wire 26 awg BLACK',qty:'2000',unit:'mm'},
  {item:'5',part_number:'2126/19-2',description:'Connector D-Sub',qty:'1',unit:'pc'},
  {item:'6',part_number:'2126/19-5',description:'Wire 26 awg Blue',qty:'2000',unit:'mm'},
  {item:'7',part_number:'2126/19-5',description:'Wire 26 awg Blue',qty:'2000',unit:'mm'},
  {item:'8',part_number:'L384/ELV',description:'LED',qty:'1',unit:'pc'},
];
// Steps: one per row, with distinct minutes, plus a general step.
const MINS=[2,2.5,1.5,3,3.4,1,2,1.2];
const STEPS=MINS.map((m,i)=>({operation:'step '+i, row_idx:i, unit_minutes:m, qty_in_drawing:1}))
  .concat([{operation:'final test', row_idx:null, unit_minutes:10, qty_in_drawing:1}]);

ctx.__f.handler=b=>{
  const c=b.messages[0].content;
  const txt=typeof c==='string'?c:c.map(x=>x.text||'').join(' ');
  let out='[]';
  if(/Is there a PARTS LIST/.test(txt)) out='{"found":true,"box":[0,0.7,0.4,1]}';
  else if(/manufacturing process engineer|manufacturing steps/i.test(txt))
    out=JSON.stringify({steps:STEPS, single_unit_minutes:40});
  else if(/Bill of Materials|BOM/i.test(txt)) out=JSON.stringify(ROWS);
  return {ok:true, json:async()=>({content:[{type:'text',text:out}], stop_reason:'end_turn'})};
};
vm.runInContext(`anthKey='sk'; companyId='c1'; currentUserEmail='u@x'; currentUserRole='admin';
  sdItems=[]; allParts=[]; _sdLaborBreakdowns=[]; _sdDrawingNotes=[];
  _fetchWithRetry=async(u,o)=>__f.handler(JSON.parse(o.body));
  logSystemAudit=async()=>{}; logAudit=async()=>{};
  extractPDFPages=async()=>({pageTexts:['schematic only'], pageImages:['P1'], crop:async()=>['B1'], numPages:1});
  loadParts=async()=>{}; saveBOMToPartStock=async()=>0;`, ctx);

(async()=>{
  await M.handleSDFiles([{name:'EL-004695-AC_B.pdf', type:'application/pdf'}]);
  for(let i=0;i<5;i++) await tick();
  const btn=g.document.getElementById('btn-save-bom');
  ok('preview: the rows are shown for review', !!btn);
  btn.click();
  for(let i=0;i<10;i++) await tick();
  const items=vm.runInContext('sdItems', ctx);
  ok('sales desk: all 8 rows were added', items.length===8);
  const lt=items.map(r=>parseFloat(r.labor_time)||0);
  ok('labor: each row carries exactly the minutes of its own step',
     JSON.stringify(lt)===JSON.stringify(MINS));
  ok('labor: rows sharing a part number are not each given the shared total',
     lt[0]===2 && lt[1]===2.5 && lt[4]===3.4);
  const rowSum=items.reduce((s,r)=>s+(r.labor_total||0),0);
  const stepSum=MINS.reduce((a,b)=>a+b,0);
  ok(`labor: the rows add up to the steps (${rowSum.toFixed(1)} = ${stepSum.toFixed(1)})`, Math.abs(rowSum-stepSum)<1e-9);
  const grp=M._sdComputeGroups()[0];
  ok(`summary: Labor Time per cable is rows + general (${grp.laborMinutesPerUnit.toFixed(1)} = ${(stepSum+10).toFixed(1)})`,
     Math.abs(grp.laborMinutesPerUnit-(stepSum+10))<1e-9);
  const b=vm.runInContext('_sdLaborBreakdowns', ctx)[0];
  ok('summary: ...the same number the step breakdown shows', b && Math.abs(b.seriesTotal-grp.laborMinutesPerUnit)<1e-9);

  // ── no per-row Labor Time column; the 📋 breakdown carries it all ──────
  vm.runInContext(`_sdLaborRateMin=0.88;`, ctx);
  try{ await M.renderSalesDesk(); }catch(e){ console.error('render', e.message); }
  const html=g.document.getElementById('content').innerHTML;
  ok('table: the Sales Desk table renders', /MNF P\/N/.test(html) && /Part Cost/.test(html));
  ok('table: there is no Labor Time column in it', !/<th[^>]*>\s*Labor Time\s*</.test(html) && !/sd-labor-time/.test(html));
  ok('table: the summary still shows Labor Time (min / cable) with its 📋 button',
     /Labor Time \(min \/ cable\)/.test(html) && /sd-btn-breakdown/.test(html));
  const dwg=items[0].drawing_number;
  M.openLaborBreakdownModal(dwg);
  const modal=()=>g.document.getElementById('modal-bg')?.innerHTML||'';
  const total=m=>parseFloat((/= Total \(series, per unit\)<\/strong><strong>([\d.]+)/.exec(m)||[])[1]);
  ok(`modal: the breakdown total equals the summary (${total(modal())} = ${grp.laborMinutesPerUnit.toFixed(1)})`,
     Math.abs(total(modal())-grp.laborMinutesPerUnit)<0.06);
  no('modal: ...with nothing unexplained', /Rows without a step analysis/.test(modal()));
  M.closeModal();

  // A row added by hand: its minutes are in the total, and the breakdown says so.
  const extraRow={drawing_number:dwg, part_number:'MANUAL-1', description:'hand-added wire', qty:'500', unit:'mm',
    mouser_price:0,digikey_price:0,priority_price:0,total:0,labor_time:'',labor_total:0};
  M._sdRecalcRow(extraRow); vm.runInContext('sdItems', ctx).push(extraRow);
  const grp2=M._sdComputeGroups()[0];
  M.openLaborBreakdownModal(dwg);
  ok('modal: a hand-added row is listed as minutes without a step analysis', /Rows without a step analysis<\/span><span>1\.0/.test(modal()));
  ok(`modal: ...and the breakdown total still equals the summary (${total(modal())} = ${grp2.laborMinutesPerUnit.toFixed(1)})`,
     Math.abs(total(modal())-grp2.laborMinutesPerUnit)<0.06);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
