/* BOM import from a PDF whose parts list is a picture on the sheet: the whole
   _bomFromPDF path, with the PDF reader and the model scripted. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body><div id="content"></div><div id="toast-el"></div></body></html>`,{url:'https://x.test'});
const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=()=>({}), doc=()=>({}), addDoc=async()=>({id:'x'}), serverTimestamp=()=>new Date(),
    getDocs=async()=>({docs:[]}), setDoc=async()=>{}, updateDoc=async()=>{}, query=()=>({}), orderBy=()=>({});
var _csLang='en', _csCache={en:{},he:{},ru:{}}, psPageSize=20;
`;
const ctx={module:{exports:{}}, console, __f:{},
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

const SCHEMATIC='ThunderB External connector - 4 way selector harness\n1 CAN_H 26AWG White\nJ4 COJ4 EL-000481 EL-000486\n'
  +'XT60- male EL-006078-M\n20 AWG Red EXT28V\nD-Type 15p Female EL-004802\nDESCRIPTION.: TBV EXT connector 4 way selector harness';
const ROWS=Array.from({length:25},(_,i)=>({item:String(i+1), part_number:'MPN-'+(i+1), atlantium_pn:'EL-'+(1000+i),
  description:'Row '+(i+1), qty:'1', unit:'ea', manufacturer:'Molex'}));

let calls=[], crops=[];
const reply=t=>({ok:true, json:async()=>({content:[{type:'text',text:t}], stop_reason:'end_turn'})});
function script(handler){
  ctx.__f.handler=handler;
  vm.runInContext(`anthKey='sk'; _csModelDown=false;
    _fetchWithRetry=async(u,o)=>__f.handler(JSON.parse(o.body));
    logSystemAudit=async()=>{};
    extractPDFPages=async()=>__f.pdf;`, ctx);
}
const kind=b=>{
  const c=b.messages[0].content;
  const txt=typeof c==='string'?c:c.map(x=>x.text||'').join(' ');
  if(/Is there a PARTS LIST/.test(txt)) return 'locate';
  return typeof c==='string' ? 'text' : 'vision';
};

(async()=>{
  // ── 1. the drawing: schematic text, table pasted on sheet 1 ────────────
  ctx.__f.pdf={pageTexts:[SCHEMATIC,'General Note: see Note1'], pageImages:['PAGE1','PAGE2'],
    crop:async(pi,box)=>{ crops.push({pi,box}); return ['BAND1']; }};
  calls=[]; crops=[];
  script(b=>{
    calls.push({kind:kind(b), model:b.model, img:(Array.isArray(b.messages[0].content)?b.messages[0].content.find(x=>x.type==='image'):null)?.source?.data});
    const k=kind(b);
    if(k==='locate') return reply(calls[calls.length-1].img==='PAGE1'
      ? '{"found":true,"box":[0.03,0.71,0.42,0.97],"rows":25}' : '{"found":false}');
    if(k==='vision') return reply(JSON.stringify(ROWS));
    return reply('[{"item":"1","part_number":"EL-000481","description":"from the schematic"}]');
  });
  const r=await M._bomFromPDF({name:'EL-004695-AC_B.pdf'}, ()=>{});
  no('schematic: the text layer is not sent as if it held the table', calls.some(c=>c.kind==='text'));
  ok('schematic: the sheet is searched for the table first', calls[0].kind==='locate' && calls[0].img==='PAGE1');
  ok('schematic: ...and the region found is rendered on its own',
     crops.length>=1 && crops[0].pi===0 && Math.abs(crops[0].box[0]-0.03)<1e-9);
  ok('schematic: ...and read from that sharp render, not the whole sheet',
     calls.some(c=>c.kind==='vision' && c.img==='BAND1') && !calls.some(c=>c.kind==='vision' && c.img==='PAGE1'));
  ok('schematic: ...by the stronger model', calls.filter(c=>c.kind!=='text').every(c=>/sonnet/.test(c.model)));
  ok('schematic: all 25 rows come back', r.rows.length===25 && r.rows[24].part_number==='MPN-25');
  ok('schematic: the page it came from is the one handed on', r.fromImage===true && r.imgData && r.imgData.b64==='PAGE1');

  // ── 2. a PDF whose text layer IS the table: text, quick, no vision ─────
  ctx.__f.pdf={pageTexts:['ITEM PART NUMBER DESCRIPTION QTY\n1 ABC-1 Resistor 2\n2 ABC-2 Cap 4'], pageImages:['P1'],
    crop:async()=>['B']};
  calls=[];
  script(b=>{ calls.push({kind:kind(b)}); return reply('[{"item":"1","part_number":"ABC-1"},{"item":"2","part_number":"ABC-2"}]'); });
  const t2=await M._bomFromPDF({name:'text.pdf'}, ()=>{});
  ok('text: a real text table is read as text', calls.length===1 && calls[0].kind==='text' && t2.rows.length===2);
  ok('text: ...and nothing else is spent on it', !calls.some(c=>c.kind!=='text'));

  // ── 3. a tall table cut into bands: overlap rows are not doubled ───────
  ctx.__f.pdf={pageTexts:[''], pageImages:['P1'], crop:async()=>['A','B']};
  calls=[];
  script(b=>{
    const k=kind(b); calls.push({kind:k});
    if(k==='locate') return reply('{"found":true,"box":[0,0,1,1]}');
    const img=b.messages[0].content.find(x=>x.type==='image').source.data;
    return reply(JSON.stringify(img==='A' ? ROWS.slice(0,15) : ROWS.slice(12)));
  });
  const t3=await M._bomFromPDF({name:'tall.pdf'}, ()=>{});
  ok('bands: both bands are read', calls.filter(c=>c.kind==='vision').length===2);
  ok('bands: the rows seen in both are kept once', t3.rows.length===25);

  // ── 4. nothing located: the whole sheet is still tried, as before ──────
  ctx.__f.pdf={pageTexts:[''], pageImages:['P1'], crop:async()=>{ throw new Error('should not crop'); }};
  calls=[];
  script(b=>{
    const k=kind(b); calls.push({kind:k});
    if(k==='locate') return reply('{"found":false}');
    return reply(JSON.stringify(ROWS.slice(0,3)));
  });
  const t4=await M._bomFromPDF({name:'none.pdf'}, ()=>{});
  ok('fallback: with no table located, the whole page is read', t4.rows.length===3 && calls.some(c=>c.kind==='vision'));

  // ── 5. an account without the stronger model falls back, not fails ─────
  ctx.__f.pdf={pageTexts:[SCHEMATIC], pageImages:['PAGE1'], crop:async()=>['BAND1']};
  calls=[]; let first=true;
  script(b=>{
    calls.push({kind:kind(b), model:b.model});
    if(first){ first=false; return {ok:false, status:404, json:async()=>({error:{message:'model: claude-sonnet-5 not_found'}})}; }
    return reply(kind(b)==='locate' ? '{"found":true,"box":[0.03,0.71,0.42,0.97]}' : JSON.stringify(ROWS));
  });
  const t5=await M._bomFromPDF({name:'fb.pdf'}, ()=>{});
  ok('model: a rejected model falls back to the small one', t5.rows.length===25 && /haiku/.test(calls[calls.length-1].model));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
