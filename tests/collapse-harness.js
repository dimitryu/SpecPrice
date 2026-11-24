/* Collapsible panels (v1.83.8) on Admin, Settings and Statistics: each titled
   panel folds to its title, Expand all / Collapse all act on every one, the
   state is remembered per screen in this browser, and a browser that blocks
   storage still folds (it just starts open next time). */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body><div id="content"></div><div id="topbar-actions"></div></body></html>`,{url:'https://x.test'});
const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1'}};
var _csLang='en', _csCache={en:{},he:{},ru:{}}, psPageSize=20, _sdCollapsedRows=new Set();
`;
let store={}, blocked=false;
const LS={getItem:k=>{ if(blocked) throw new Error('blocked'); return k in store?store[k]:null; },
          setItem:(k,v)=>{ if(blocked) throw new Error('blocked'); store[k]=String(v); }, removeItem:k=>{ delete store[k]; }};
const ctx={module:{exports:{}}, console:{log(){},warn(){},error:console.error},
  window:g, document:g.document, navigator:g.navigator, performance:{now:()=>0}, localStorage:LS,
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval:()=>{},
  Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
  isFinite, parseFloat, parseInt, confirm:()=>true};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(pre+src, ctx);
const M=ctx.module.exports;
let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else {fail++; fails.push(n);} };
const $=s=>g.document.querySelector(s), $$=s=>[...g.document.querySelectorAll(s)];
const C=g.document.getElementById('content');

const PAGE=`
  <div class="settings-panel" id="p0"><div class="stat-filter">dates</div></div>
  <div class="settings-panel" id="p1"><h3>🔑 AI API Keys</h3><p>note</p><div id="b1"><button id="inner">x</button></div></div>
  <div class="settings-panel" id="p2"><h3>System Logs</h3><div id="b2"></div></div>
  <div class="settings-panel stat-block" id="p3"><div class="stat-block-head"><div><div class="stat-block-title">Activity</div><div class="stat-block-note">n</div></div><button class="stat-export">Export</button></div><div class="stat-tiles"></div></div>
  <div class="settings-panel" id="p4"><h3>System Logs</h3><div></div></div>`;
const draw=()=>{ C.innerHTML=PAGE; return M.makePanelsCollapsible(C,'admin'); };

// 1. toggles added only where there is a title
let ps=draw();
ok('titled panels found', ps.length===4);
ok('untitled panel left alone', !$('#p0').dataset.cp && !$('#p0 .cp-toggle'));
ok('keys from titles', $('#p1').dataset.cp==='ai-api-keys' && $('#p2').dataset.cp==='system-logs' && $('#p3').dataset.cp==='activity');
ok('same title gets its own key', $('#p4').dataset.cp==='system-logs-2');
ok('title moved into the toggle', /AI API Keys/.test($('#p1 h3 .cp-toggle').textContent) && $('#p1 h3').children.length===1);
ok('toggle is a real button', $('#p1 .cp-toggle').tagName==='BUTTON' && $('#p1 .cp-toggle').type==='button');
ok('chevron added', !!$('#p1 .cp-toggle .cp-chev svg'));
ok('opens by default', $$('.settings-panel.is-collapsed').length===0 && $('#p1 .cp-toggle').getAttribute('aria-expanded')==='true');
ok('stat block head marked', $('#p3 .stat-block-head').classList.contains('cp-head') && !!$('#p3 .stat-block-title .cp-toggle'));
ok('h3 head marked', $('#p1 h3').classList.contains('cp-head'));
ok('body content kept with its ids', !!$('#p1 #b1 #inner'));

// 2. one toggle
$('#p1 .cp-toggle').click();
ok('click folds', $('#p1').classList.contains('is-collapsed') && $('#p1 .cp-toggle').getAttribute('aria-expanded')==='false');
ok('only that panel', $$('.settings-panel.is-collapsed').length===1);
ok('remembered', JSON.parse(store['sp.collapsed.admin']).join()==='ai-api-keys');
$('#p1 .cp-toggle').click();
ok('second click opens', !$('#p1').classList.contains('is-collapsed') && JSON.parse(store['sp.collapsed.admin']).length===0);
$('#p3 .cp-toggle').click();
ok('stat block folds by its title', $('#p3').classList.contains('is-collapsed'));

// 3. a redraw brings the state back; calling twice adds nothing
ps=draw();
ok('state survives a redraw', $('#p3').classList.contains('is-collapsed') && !$('#p1').classList.contains('is-collapsed'));
M.makePanelsCollapsible(C,'admin');
ok('no second toggle', $$('#p1 .cp-toggle').length===1 && $$('#p3 .cp-chev').length===1);

// 4. all
ok('collapse all counts', M.setAllPanels(C,'admin',false)===4);
ok('collapse all folds every titled panel', $$('.settings-panel.is-collapsed').length===4 && !$('#p0').classList.contains('is-collapsed'));
ok('collapse all remembered', JSON.parse(store['sp.collapsed.admin']).length===4);
M.setAllPanels(C,'admin',true);
ok('expand all', $$('.settings-panel.is-collapsed').length===0 && JSON.parse(store['sp.collapsed.admin']).length===0);

// 5. screens are separate
M.setAllPanels(C,'admin',false);
C.innerHTML=PAGE; M.makePanelsCollapsible(C,'settings');
ok('another screen starts open', $$('.settings-panel.is-collapsed').length===0);

// 6. top-bar buttons
g.document.getElementById('topbar-actions').innerHTML=M.collapseControlsHTML();
ok('two top-bar buttons', !!$('#cp-expand-all') && !!$('#cp-collapse-all'));
M.bindCollapseControls('settings');
$('#cp-collapse-all').click();
ok('Collapse all button', $$('.settings-panel.is-collapsed').length===4);
$('#cp-expand-all').click();
ok('Expand all button', $$('.settings-panel.is-collapsed').length===0);
C.innerHTML=PAGE+'<div class="settings-panel" id="p9"><h3>Later</h3><div></div></div>';
$('#cp-collapse-all').click();
ok('buttons act on panels drawn later', $('#p9').classList.contains('is-collapsed'));

// 7. storage blocked / broken
blocked=true;
C.innerHTML=PAGE; ps=M.makePanelsCollapsible(C,'stats');
ok('blocked storage: all open', ps.length===4 && $$('.settings-panel.is-collapsed').length===0);
$('#p2 .cp-toggle').click();
ok('blocked storage: still folds', $('#p2').classList.contains('is-collapsed'));
blocked=false;
store['sp.collapsed.stats']='{not json';
C.innerHTML=PAGE; M.makePanelsCollapsible(C,'stats');
ok('bad saved value ignored', $$('.settings-panel.is-collapsed').length===0);
ok('slug', M._cpSlug('🔌 Distributor Price APIs')==='distributor-price-apis' && M._cpSlug('')==='panel');
ok('no root', M.makePanelsCollapsible(null,'x').length===0);

console.log(`collapse-harness: ${pass} passed, ${fail} failed`);
if(fail){ fails.forEach(f=>console.log('  ✗ '+f)); process.exit(1); }
