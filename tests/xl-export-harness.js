/* Sales Desk → Excel: the quotation is a live workbook. Every money figure is a
   formula over the parts table (so editing a price or QTY in Excel moves Part
   Cost and every total), and each formula carries the app's own result. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom'), ExcelJS=require('exceljs');
const dom=new JSDOM(`<!doctype html><html><body><div id="content"></div><div id="topbar-actions"></div>
  <button id="btn-sd-export"></button><div id="toast-el"></div></body></html>`,{url:'https://x.test'});
const g=dom.window; g.HTMLAnchorElement.prototype.click=function(){};
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
  isFinite, parseFloat, parseInt, confirm:()=>true,
  Blob:function(parts){ this.parts=parts; },
  URL:{createObjectURL:b=>{ ctx.__f.blob=b; return 'blob:x'; }, revokeObjectURL(){}},
  __ExcelJS:ExcelJS};
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;
let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const near=(a,b)=>Math.abs((+a||0)-(+b||0))<1e-6;

(async()=>{
  vm.runInContext(`loadExcelJS=async()=>__ExcelJS; logSystemAudit=async()=>{}; toast=()=>{};
    currentUserEmail='u@x'; companyLogoB64=''; allParts=[]; _sdDwgSettings={};
    sdItems=[
      {drawing_number:'D1', part_number:'CAB-1', description:'CABLE 14AWG', qty:2000, unit:'mm',
       mouser_price:2.15, digikey_price:2.32, priority_price:2.05},
      {drawing_number:'D1', part_number:'CON-1', description:'PLUG 4P', qty:1, unit:'pc',
       mouser_price:12.4, digikey_price:13.1, priority_price:''},
      {drawing_number:'D1', part_number:'LAB-1', description:'LABEL', qty:2, unit:'pc', manual_total:'3'},
      {drawing_number:'D1', part_number:'TL-1', description:'CRIMP TOOL for CON-1', qty:1, unit:'pc', est_price:185, tool_for:'CON-1'},
      {drawing_number:'D2', part_number:'CON-2', description:'RECEPTACLE', qty:1, unit:'pc', digikey_price:17.75},
      {drawing_number:'D2', part_number:'TL-2', description:'INSERTION TOOL for CON-2', qty:1, unit:'pc', tool_for:'CON-2',
       est_price:120, mouser_price:96.5, mouser_brk:1, mouser_url:'https://www.mouser.com/ProductDetail/TL-2'},
    ];
    sdItems.forEach(_sdRecalcRow);
    _sdApplyUnits('D1',10); _sdDwgSet('D1').laborMinutes=12; _sdDwgSet('D1').laborRateMin=0.5; _sdDwgSet('D1').profitPct=30;`, ctx);
  const S=vm.runInContext('_sdComputeSummary()', ctx);
  const items=vm.runInContext('sdItems', ctx);
  await M.exportSalesDeskExcel();
  ok('export: a workbook was produced', !!ctx.__f.blob);
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(ctx.__f.blob.parts[0]);
  const ws=wb.getWorksheet('Quotation');
  const zip=await require('jszip').loadAsync(ctx.__f.blob.parts[0]);
  ok('live: the workbook recalculates on open', /<calcPr[^>]*fullCalcOnLoad="1"/.test(await zip.file('xl/workbook.xml').async('string')));

  const cells=[]; ws.eachRow(r=>r.eachCell(c=>cells.push(c)));
  const find=re=>cells.find(c=>typeof c.value==='string' && re.test(c.value));
  const label=re=>cells.find(c=>c.col===1 && typeof c.value==='string' && re.test(c.value));
  const right=(cell)=>ws.getCell(cell.row, 13);           // values sit in column M
  const head=find(/^Mouser Price$/);
  ok('columns: the price columns are per-unit prices', !!head && !!find(/^Priority Price$/) && !find(/^Mouser Cost$/));
  ok('columns: the header explains feet / metres', /per FOOT/.test((head||{}).note?.texts?.map(t=>t.text).join('')||head?.note||''));

  const rowOf=pn=>cells.find(c=>c.col===3 && c.value===pn).row;
  const pc=pn=>ws.getCell(rowOf(pn),13).value;
  const item=pn=>items.find(r=>r.part_number===pn);
  ['CAB-1','CON-1','LAB-1','TL-1','CON-2'].forEach(pn=>{
    const v=pc(pn);
    ok(`part cost ${pn}: a formula`, v && typeof v.formula==='string');
    ok(`part cost ${pn}: carries the app's figure`, v && near(v.result, item(pn).total));
  });
  const cab=rowOf('CAB-1');
  ok('cable: QTY and the per-foot / per-metre prices feed the formula',
     /F\d+/.test(pc('CAB-1').formula) && /304\.8/.test(pc('CAB-1').formula) && /1000/.test(pc('CAB-1').formula));
  ok('cable: Mouser shows "/ft", Priority "/m"', /\/ft/.test(ws.getCell(cab,8).numFmt) && /\/m/.test(ws.getCell(cab,12).numFmt));
  ok('cable: the unit price itself is in the cell, not the line cost', near(ws.getCell(cab,8).value, 2.15));
  ok('manual price: follows QTY as a per-unit price', /^0\.15\*F\d+$/.test(pc('LAB-1').formula));
  ok('tool: priced from its estimate when no source has it', /185\*F/.test(pc('TL-1').formula));

  const d1=S.groups.find(x=>x.dwg==='D1'), d2=S.groups.find(x=>x.dwg==='D2');
  const parts=label(/^Parts {2}\(per cable — parts table ÷ 10\)$/);
  ok('parts: sum of the table less the tool, per cable', parts && /SUM\(M\d+:M\d+\)-\(M\d+\)\)\/10/.test(right(parts).value.formula)
     && near(right(parts).value.result, d1.partsTotalPerUnit));
  const minutes=label(/^Labor time/), rate=label(/^Labor rate/), pct=label(/^Profit %$/);
  ok('inputs: minutes, rate and profit are plain editable values',
     right(minutes).value===12 && right(rate).value===0.5 && near(right(pct).value,0.3));
  const labor=label(/^Labor {2}\(minutes × rate/);
  ok('labor: minutes × rate', right(labor).value.formula===`${right(minutes).address}*${right(rate).address}` && near(right(labor).value.result,6));
  const unit=label(/^Unit Price — D1$/);
  ok('unit price: formula with the app figure', /\+/.test(right(unit).value.formula) && near(right(unit).value.result, d1.finalPerUnit));
  const order=label(/^Price per 10 units$/);
  ok('order: unit price × units', right(order).value.formula===`${right(unit).address}*10` && near(right(order).value.result, d1.final));
  const total=label(/^TOTAL FINAL PRICE$/);
  ok('grand total: sums the drawings', /\+/.test(right(total).value.formula) && near(right(total).value.result, S.final));
  const tools=label(/^TOOLS TOTAL — D1/);
  ok('tools: their own total, outside the price', !!tools && near(right(tools).value.result, 185));
  ok('summary: D2 row points at its block', cells.some(c=>c.row<rowOf('CON-1') && c.col===8 && c.value && c.value.formula && near(c.value.result, d2.finalPerUnit)));

  // Tools: which connector, where the price came from, and a link to it.
  const toolRow=pn=>cells.filter(c=>c.col===2 && c.value===pn).map(c=>c.row).pop();
  const t1=toolRow('TL-1'), t2=toolRow('TL-2');
  ok('tool list: has its column heads', !!label && cells.some(c=>c.value==='For connector') && cells.some(c=>c.value==='Price from'));
  ok('tool 1: for its connector', ws.getCell(t1,7).value==='CON-1');
  ok('tool 1: priced by the AI estimate, and says so', ws.getCell(t1,9).value==='AI estimate — not verified');
  ok('tool 1: links a Mouser search to check it', /mouser\.com\/c\/\?q=TL-1/.test(ws.getCell(t1,11).value.hyperlink||''));
  ok('tool 2: priced from Mouser', ws.getCell(t2,9).value==='Mouser' && near(ws.getCell(t2,13).value.result,96.5));
  ok('tool 2: links the product page the price came from', ws.getCell(t2,11).value.hyperlink==='https://www.mouser.com/ProductDetail/TL-2');
  const S2=x=>vm.runInContext(`_sdPriceSource(sdItems.find(r=>r.part_number==='${x}'))`, ctx);
  ok('source: the cheapest verified price wins over the estimate', S2('TL-2').kind==='mouser' && S2('TL-1').kind==='ai');
  ok('source: a manual price is reported as such', S2('LAB-1').kind==='manual');
  ok('source: only https links are trusted', vm.runInContext(`_sdSafeUrl('javascript:alert(1)')===''&&_sdSafeUrl('https://a.b/c')==='https://a.b/c'`, ctx));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
