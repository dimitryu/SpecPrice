/* The step-by-step panel of a drawing analysis (stagesPanel): each step's own
   time, steps that run again add up, and the job keeps going — and says so in
   the tab's title — while the user is in another tab or window. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><head><title>SpecPrice</title></head><body><div id="host"></div></body></html>`,{url:'https://x.test'});
const g=dom.window;
let hidden=false;
Object.defineProperty(g.document,'hidden',{get:()=>hidden});
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var collection=()=>({}), doc=(...a)=>({id:a[a.length-1]}), addDoc=async()=>({id:'x'}), serverTimestamp=()=>new Date(),
    getDocs=async()=>({docs:[]}), getDoc=async()=>({exists:()=>false,data:()=>({})}), setDoc=async()=>{}, updateDoc=async()=>{},
    query=()=>({}), orderBy=()=>({}), arrayUnion=(...v)=>v, deleteField=()=>null, writeBatch=()=>({update(){},commit:async()=>{}});
var _csLang='en', _csCache={en:{},he:{},ru:{}}, psPageSize=20, _sdCollapsedRows=new Set();
`;
let clock=1000;
const timers=[];
const ctx={module:{exports:{}}, console:{log(){},warn(){},error:console.error},
  window:g, document:g.document, navigator:g.navigator, performance:{now:()=>clock},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout:(f,ms)=>{ timers.push(f); return timers.length; }, clearTimeout(){}, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;
let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const host=g.document.getElementById('host');
const time=k=>host.querySelector(`[data-stage="${k}"] .stage-time`)?.textContent||'';
const runTimers=()=>{ const t=timers.splice(0); t.forEach(f=>f()); return t.length; };
let unloads=0; const _add=g.addEventListener.bind(g), _rem=g.removeEventListener.bind(g);
g.addEventListener=(t,f,o)=>{ if(t==='beforeunload') unloads++; return _add(t,f,o); };
g.removeEventListener=(t,f,o)=>{ if(t==='beforeunload') unloads--; return _rem(t,f,o); };

const st=M.stagesPanel(host,[{k:'a',label:'Reading the parts list'},{k:'b',label:'Reading the title block'},{k:'c',label:'Finding the crimp tools'}]);
ok('panel: one row per step, none started', host.querySelectorAll('.stage-wait').length===3);
st.set('a',{state:'run', text:'File 1/2'});
ok('background: closing the tab while it runs asks first', unloads===1);
ok('background: the tab title says what it is doing', /^⏳ Reading the parts list — SpecPrice$/.test(g.document.title));
clock+=4000; runTimers();
ok('time: a running step counts up live', time('a')==='⏱ 4.0 s');
st.set('a',{state:'done', text:'File 1/2 — 12 rows'});
clock+=2000;                       // another step runs meanwhile (not this one)
st.set('b',{state:'run'}); clock+=1500; st.set('b',{state:'done'});
st.set('a',{state:'run', text:'File 2/2'}); clock+=3000; st.set('a',{state:'done'});
ok('time: a step that runs again (the next drawing) adds to its own time only — 4 s + 3 s', time('a')==='⏱ 7.0 s');
ok('time: the other step has its own', time('b')==='⏱ 1.5 s');
ok('time: the total is from the first start to the last end', st.totalMs()===4000+2000+1500+3000);
ok('time: times() for the log', JSON.stringify(st.times())==='{"a":7000,"b":1500}');

// The user switches to another tab: the work goes on, the panel stops redrawing.
st.set('c',{state:'run'});
hidden=true; g.document.dispatchEvent(new g.Event('visibilitychange'));
const drawn=host.innerHTML;
clock+=60000; const fired=runTimers();
ok('background: no redraw every second while the tab is hidden', host.innerHTML===drawn);
ok('background: ...and the clock stops ticking (no timer left running)', runTimers()===0 && fired<=1);
st.set('c',{state:'done', text:'2 tool rows'});      // the job carried on while hidden
st.finish('Done — 24 rows on Sales Desk');
ok('background: a job that ends in a hidden tab says so in the title', /^✓ Done — 24 rows on Sales Desk — SpecPrice$/.test(g.document.title));
ok('background: ...and closing the tab no longer asks', unloads===0);
ok('time: the step that ran while hidden has its real time', time('c')==='⏱ 1 min 00 s');
hidden=false; g.document.dispatchEvent(new g.Event('visibilitychange'));
ok('background: back in the tab, the title is restored', g.document.title==='SpecPrice');

// finish(): steps that never ran are marked skipped.
const h2=g.document.createElement('div'); g.document.body.appendChild(h2);
const s2=M.stagesPanel(h2,[{k:'x',label:'X'},{k:'y',label:'Y'}]);
s2.set('x',{state:'run'}); clock+=1000; s2.finish('Failed', false);
ok('finish: a step still running ends as a warning, one that never ran as skipped',
   !!h2.querySelector('[data-stage="x"].stage-warn') && !!h2.querySelector('[data-stage="y"].stage-skip'));
ok('finish: a failure in a visible tab leaves the title alone', g.document.title==='SpecPrice');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fails.forEach(f=>console.log('  ✗ '+f));
if(fail) process.exit(1);
