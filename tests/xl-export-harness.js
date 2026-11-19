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
      {drawing_number:'D2', part_number:'LAB-2', description:'LABEL, PRINTABLE', qty:3, unit:'pc'},
      {drawing_number:'D2', part_number:'MRK-3', description:'MARKER SLEEVE', qty:2, unit:'pc', mouser_price:0.35},
      {drawing_number:'D2', part_number:'OC-1', description:'TERMINAL', qty:2, unit:'pc', mouser_price:6, onlinecomp_price:4.5, onlinecomp_match:'exact'},
      {drawing_number:'D2', part_number:'FA-1', description:'SPLICE', qty:4, unit:'pc', mouser_price:1, onlinecomp_price:0.9, farnell_price:0.5, farnell_match:'exact'},
      {drawing_number:'D2', part_number:'FA-2', description:'WIRE', qty:2000, unit:'mm', mouser_price:1, farnell_price:1.2, farnell_uom:'M', farnell_match:'exact'},
      {drawing_number:'D2', part_number:'ADH-1', description:'THREADLOCKER ADHESIVE', qty:100, unit:'ml', mouser_price:17.6, mouser_pack_ml:50},
      {drawing_number:'D2', revision:'C', part_number:'CS-4', description:'CABLE FROM CUSTOMER', qty:3, unit:'pc', mouser_price:5, customer_supplied:true},
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

  const sheetXml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  ok('xml: sheetPr is the known-good one (outlinePr would break Excel)', /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/.test(sheetXml));
  const mrg=[...sheetXml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)].map(m=>({r1:+m[2],r2:+m[4],c1:m[1].charCodeAt(0),c2:m[3].charCodeAt(0)}));
  ok('xml: no overlapping merges', !mrg.some((a,i)=>mrg.some((b,j)=>j>i && a.r1<=b.r2 && b.r1<=a.r2 && a.c1<=b.c2 && b.c1<=a.c2)));
  ok('xml: no merge reaches past column H', !mrg.some(m=>m.c2>72));
  const cells=[]; ws.eachRow(r=>r.eachCell(c=>cells.push(c)));
  const find=re=>cells.find(c=>typeof c.value==='string' && re.test(c.value));
  const label=re=>cells.find(c=>c.col===1 && typeof c.value==='string' && re.test(c.value));
  const right=(cell)=>ws.getCell(cell.row, 8);            // values sit in column H
  // v1.80: what the customer pays for, not where it is bought.
  const heads=cells.filter(c=>c.row===cells.find(x=>x.value==='MNF P/N').row).map(c=>c.value);
  ok('columns: only Item … Units and Part Cost', JSON.stringify(heads)===JSON.stringify(['Item','Drawing #','MNF P/N','Description','Manufacturer','QTY','Units','Part Cost']));
  ok('columns: no supplier, Priority or labor-time column anywhere',
     !find(/Mouser Price|Mouser Stock|DigiKey|Online Comp\.|Farnell|Priority Price|Labor Time|Labor rate|Labor time/));
  ok('columns: nothing written right of Part Cost', !cells.some(c=>c.col>8));

  const rowOf=pn=>cells.find(c=>c.col===3 && c.value===pn).row;
  const pc=pn=>ws.getCell(rowOf(pn),8).value;
  const item=pn=>items.find(r=>r.part_number===pn);
  ['CAB-1','CON-1','LAB-1','TL-1','CON-2','LAB-2','MRK-3','OC-1','FA-1','FA-2'].forEach(pn=>{
    const v=pc(pn);
    ok(`part cost ${pn}: a formula over QTY`, v && typeof v.formula==='string' && new RegExp(`F${rowOf(pn)}`).test(v.formula));
    ok(`part cost ${pn}: carries the app's figure`, v && near(v.result, item(pn).total));
  });
  // Evaluate a Part Cost formula at a new QTY — the file must follow QTY.
  const evalAt=(pn,q)=>{ const f=pc(pn).formula.replace(new RegExp(`F${rowOf(pn)}`,'g'),String(q))
      .replace(/MAX\(/g,'Math.max(').replace(/ROUNDUP\(([^,]+),0\)/g,'Math.ceil($1)'); return Function(`return ${f}`)(); };
  ok('cable: the per-metre Priority price that won, ÷1000, and it follows QTY',
     pc('CAB-1').formula===`2.05*F${rowOf('CAB-1')}/1000` && near(evalAt('CAB-1',2*item('CAB-1').qty), 2*item('CAB-1').total));
  ok('cable sold by Farnell by the metre: ÷1000', /^1\.2\*F\d+\/1000$/.test(pc('FA-2').formula));
  ok('piece part: unit price × QTY', pc('CON-1').formula===`12.4*F${rowOf('CON-1')}` && near(evalAt('CON-1',3),12.4*3));
  ok('adhesive (ml): bottles × price per bottle, and more ml buys more bottles',
     /^17\.6\*MAX\(1,ROUNDUP\(F\d+\/50,0\)\)$/.test(pc('ADH-1').formula) && near(pc('ADH-1').result, item('ADH-1').total)
     && near(item('ADH-1').total,35.2) && near(evalAt('ADH-1',120),17.6*3));
  ok('manual price: follows QTY as a per-unit price', /^0\.15\*F\d+$/.test(pc('LAB-1').formula));
  ok('tool: priced from its estimate when no source has it', /^185\*F\d+$/.test(pc('TL-1').formula));
  ok('label: no price → nominal $0.20 × pieces, with a note', /^0\.2\*F\d+$/.test(pc('LAB-2').formula) && near(pc('LAB-2').result,0.6)
     && /Nominal label price/.test(ws.getCell(rowOf('LAB-2'),8).note||''));
  ok('cheapest source: Online Comp. $4.50 and Farnell $0.50 won as constants', /^4\.5\*F\d+$/.test(pc('OC-1').formula) && /^0\.5\*F\d+$/.test(pc('FA-1').formula));
  ok('no supplier named in any note', !cells.some(c=>/Mouser|DigiKey|Farnell|Online Comp|Priority/.test(String(c.note&&c.note.texts?c.note.texts.map(t=>t.text).join(''):c.note||''))));

  const d1=S.groups.find(x=>x.dwg==='D1'), d2=S.groups.find(x=>x.dwg==='D2');
  const parts=label(/^Parts {2}\(per cable — parts table ÷ 10\)$/);
  ok('parts: sum of the table less the tool, per cable', parts && /SUM\(H\d+:H\d+\)-\(H\d+\)\)\/10/.test(right(parts).value.formula)
     && near(right(parts).value.result, d1.partsTotalPerUnit));
  const labor=label(/^Labor {2}\(per cable\)$/), pct=label(/^Profit %$/);
  ok('labor: one editable price per cable (12 min × $0.50 = $6), no minutes or rate', !!labor && right(labor).value===6
     && !label(/^Labor time/) && !label(/^Labor rate/));
  ok('profit: an editable value', near(right(pct).value,0.3));
  const sub=label(/^Subtotal {2}\(per cable\)$/);
  ok('subtotal: parts + labor', right(sub).value.formula===`${right(parts).address}+${right(labor).address}`);
  const unit=label(/^Unit Price — D1$/);
  ok('unit price: formula with the app figure', /\+/.test(right(unit).value.formula) && near(right(unit).value.result, d1.finalPerUnit));
  const order=label(/^Price per 10 units$/);
  ok('order: unit price × units', right(order).value.formula===`${right(unit).address}*10` && near(right(order).value.result, d1.final));
  const total=label(/^TOTAL FINAL PRICE$/);
  ok('grand total: sums the drawings', /\+/.test(right(total).value.formula) && near(right(total).value.result, S.final));
  const tools=label(/^TOOLS TOTAL — D1/);
  ok('tools: their own total, outside the price', !!tools && near(right(tools).value.result, 185));
  ok('summary: D2 row points at its block', cells.some(c=>c.row<rowOf('CON-1') && c.col===7 && c.value && c.value.formula && near(c.value.result, d2.finalPerUnit)));
  ok('summary: 8 columns, no "Rows"', !find(/^Rows$/) && !!find(/^Order Total$/));

  // Tools: which connector — but not where the price came from.
  const toolRow=pn=>cells.filter(c=>c.col===2 && c.value===pn).map(c=>c.row).pop();
  const t1=toolRow('TL-1'), t2=toolRow('TL-2');
  ok('tool list: Tool / Description / For part / Price, no source or link', cells.some(c=>c.value==='For part')
     && !cells.some(c=>c.value==='Price from' || c.value==='Link') && !cells.some(c=>c.value && c.value.hyperlink));
  ok('tool 1: for its connector, priced', ws.getCell(t1,6).value==='CON-1' && near(ws.getCell(t1,8).value.result,185));
  ok('tool 2: the Mouser price, without saying Mouser', near(ws.getCell(t2,8).value.result,96.5));
  const S2=x=>vm.runInContext(`_sdPriceSource(sdItems.find(r=>r.part_number==='${x}'))`, ctx);
  // Labels/markers: a supplier price wins; with none, the nominal $0.20 per piece.
  ok('label: no price → nominal $0.20 × 3 pieces', near(item('LAB-2').total,0.6) && S2('LAB-2').kind==='nominal');
  ok('customer supplied: Part Cost is 0 in the app and in Excel, with a note',
     item('CS-4').total===0 && pc('CS-4').formula==='0' && /Customer-supplied/.test(ws.getCell(rowOf('CS-4'),8).note||''));
  ok('customer supplied: marked in the description and listed under the drawing',
     /CUSTOMER SUPPLIED/.test(ws.getCell(rowOf('CS-4'),4).value) && !!find(/D2: 1 customer-supplied item\(s\).*CS-4/));
  ok('revision: shown in the drawing heading', !!find(/^DRAWING D2\s+REV C/));
  ok('Online Components: the cheapest price wins in the app', near(item('OC-1').total,9) && S2('OC-1').kind==='onlinecomp' && near(pc('OC-1').result,9));
  ok('Farnell: the cheapest price wins in the app', near(item('FA-1').total,2) && S2('FA-1').kind==='farnell' && near(pc('FA-1').result,2));
  ok('Farnell: cable sold by the metre is costed per metre (2000 mm × $1.20/m = $2.40, below Mouser $1/ft = $6.56)',
     near(item('FA-2').total,2.4) && near(pc('FA-2').result,2.4));
  ok('label: a marker with a Mouser price uses that price', near(item('MRK-3').total,0.7) && S2('MRK-3').kind==='mouser');
  ok('source: the cheapest verified price wins over the estimate', S2('TL-2').kind==='mouser' && S2('TL-1').kind==='ai');
  ok('source: a manual price is reported as such', S2('LAB-1').kind==='manual');
  ok('source: only https links are trusted', vm.runInContext(`_sdSafeUrl('javascript:alert(1)')===''&&_sdSafeUrl('https://a.b/c')==='https://a.b/c'`, ctx));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
