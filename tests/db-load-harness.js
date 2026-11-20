/* Opening the Database fast (v1.83): the parts list is read once and shared
   (prefetch on Home + the screen's own load), a read started before a clear
   is not trusted, the first-look read is limited and skips deleted parts, and
   the background re-read reports a change only when there is one. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body><div id="content"></div><div id="topbar-actions"></div></body></html>`,{url:'https://x.test'});
const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=(d,...a)=>({col:a.join('/')}), doc=(...a)=>({id:a[a.length-1]}), addDoc=async()=>({id:'x'}), serverTimestamp=()=>new Date(),
    getDocs=async()=>({docs:[]}), getDoc=async()=>({exists:()=>false,data:()=>({})}), setDoc=async()=>{}, updateDoc=async()=>{},
    query=(c,...cl)=>Object.assign({},c,...cl), limit=n=>({lim:n}), orderBy=()=>({}), arrayUnion=(...v)=>v, deleteField=()=>null, writeBatch=()=>({update(){},commit:async()=>{}});
var _csLang='en', _csCache={en:{},he:{},ru:{}}, psPageSize=20, _sdCollapsedRows=new Set();
`;
const ctx={module:{exports:{}}, console:{log(){},warn(){},error:console.error},
  window:g, document:g.document, navigator:g.navigator, performance:{now:()=>0},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
vm.runInContext("companyId='c1'", ctx);
const M=ctx.module.exports, S=M.S;
let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };

// a controllable Firestore: each read waits until released
let DATA=[], reads=[];
const docsOf=arr=>({docs:arr.map(d=>({id:d.id, data:()=>{ const {id,...r}=d; return r; }}))});
ctx.getDocs=q=>new Promise(res=>{ reads.push({q, _res:res, go:()=>res(docsOf(q.lim?DATA.slice(0,q.lim):DATA))}); });
setTimeout(()=>{ console.log('db-load-harness: timed out'); process.exit(1); },5000).unref();
const flush=()=>new Promise(r=>setTimeout(r,0));
const release=async()=>{ while(reads.length){ reads.shift().go(); await flush(); } await flush(); };
const reset=()=>{ S.allParts=[]; S.trashParts=[]; S._partsSig=''; S._partsAt=0; reads=[]; };

(async()=>{
  DATA=[{id:'a',part_number:'A'},{id:'b',part_number:'B'},{id:'z',part_number:'Z',deleted:true}];
  // 1. two loads at once share one read
  reset();
  const p1=M.loadParts(), p2=M.loadParts();
  await flush();
  ok('one read for two concurrent loads', reads.length===1);
  await release(); await p1; await p2;
  ok('parts loaded', S.allParts.length===2);
  ok('deleted part goes to trash', S.trashParts.length===1 && S.trashParts[0]._id==='z');
  ok('read time stamped', S._partsAt>0);
  ok('signature kept', typeof S._partsSig==='string' && S._partsSig.length>0);
  ok('in-flight cleared', M._partsInFlight()===false);

  // 2. prefetch + screen load share one read
  reset();
  M.prefetchParts();
  await flush();
  const p3=M.loadParts();
  await flush();
  ok('prefetch shared with the screen', reads.length===1);
  await release(); await p3;
  ok('prefetch result used', S.allParts.length===2);
  // prefetch does nothing when loaded
  M.prefetchParts(); await flush();
  ok('no prefetch when loaded', reads.length===0);

  // 3. cleared after the read started: that read is not trusted
  reset();
  const p4=M.loadParts(); await flush();
  DATA=[{id:'a',part_number:'A'},{id:'b',part_number:'B'},{id:'c',part_number:'C'}];
  S.allParts=[];                 // a save elsewhere: "read it again"
  const p5=M.loadParts(); await flush();
  ok('a clear starts a new read', reads.length===2);
  // the old read answers with what it saw when it started
  { const old=reads[0]; const stale=docsOf([{id:'a',part_number:'A'},{id:'b',part_number:'B'}]);
    old.go=()=>old._res(stale); }
  await release(); await p4; await p5;
  ok('fresh data wins after a clear', S.allParts.length===3);

  // 4. peek: limited, deleted left out
  reset();
  DATA=[{id:'x',part_number:'X',deleted:true},{id:'a',part_number:'A'},{id:'b',part_number:'B'},{id:'c',part_number:'C'}];
  const pk=M.peekParts(2); await flush();
  ok('peek asks for a limit', reads[0].q.lim===2);
  await release();
  const rows=await pk;
  ok('peek leaves deleted out', rows.length===1 && rows[0]._id==='a');
  ok('peek does not fill the list', S.allParts.length===0);

  // 5. refresh: false when unchanged, true when changed, false when replaced meanwhile
  reset();
  const l=M.loadParts(); await flush(); await release(); await l;
  let r=M.refreshParts(); await flush(); await release();
  ok('refresh unchanged -> false', (await r)===false);
  DATA=[...DATA,{id:'d',part_number:'D'}];
  r=M.refreshParts(); await flush(); await release();
  ok('refresh changed -> true', (await r)===true);
  ok('refresh applied', S.allParts.some(p=>p._id==='d'));
  DATA=[...DATA,{id:'e',part_number:'E'}];
  r=M.refreshParts(); await flush();
  S.allParts=S.allParts.filter(p=>p._id!=='a');   // a delete on screen meanwhile
  await release();
  ok('refresh skipped if list replaced meanwhile', (await r)===false && !S.allParts.some(p=>p._id==='e'));

  // 6. constants
  ok('peek cap', M.PS_PEEK_MAX===100);
  ok('fresh window 20 s', M.PS_FRESH_MS===20000);

  console.log(`db-load-harness: ${pass} pass, ${fail} fail`);
  if(fail){ console.log(fails.join('\n')); process.exit(1); }
})().catch(e=>{ console.error(e); process.exit(1); });
