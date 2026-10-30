// Loads the real app — web/js/main.js and every module it imports — in Node,
// against a DOM and an in-memory Firestore, signs in, and opens every screen.
// What this proves that the unit tests cannot: the modules LINK (every import
// exists), nothing reads another module's constant before it is defined, and
// each screen renders without throwing.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const { JSDOM }=require('jsdom');
const here=path.dirname(fileURLToPath(import.meta.url));
const web=path.join(here,'..','..','web');
const html=readFileSync(path.join(web,'app.html'),'utf8');
const body=html.slice(html.indexOf('<body>')+6, html.indexOf('<!-- main:begin -->'));
const dom=new JSDOM(`<!doctype html><html><body>${body}</body></html>`,{url:'https://specprice.test/app.html', pretendToBeVisual:true});
const w=dom.window;
const errors=[];
const SHOW=process.env.SHOW;
for(const k of ['window','document','navigator','localStorage','sessionStorage','location','HTMLElement','Node','Event','CustomEvent','KeyboardEvent','MouseEvent','FileReader','Blob','URL','getComputedStyle','requestAnimationFrame','DOMParser','Image','history'])
  { try{ globalThis[k]= k==='window'?w : (typeof w[k]==='function' && /^[a-z]/.test(k) ? w[k].bind(w) : w[k]); }catch{} }
globalThis.confirm=()=>true; globalThis.alert=()=>{};
w.APP_VER='1.59.0';
globalThis.fetch=async()=>({ ok:false, status:503, json:async()=>({}), text:async()=>'' });
const oerr=console.error; console.error=(...a)=>{ errors.push(a.map(String).join(' ')); };
process.on('unhandledRejection', e=>errors.push('unhandled: '+(e&&e.stack||e)));

const DB=globalThis.__DB={};
DB['users']={ u1:{ company_id:'c1', role:'admin', email:'admin@x.test' } };
DB['companies']={ c1:{ name:'Radion', labor_rate_min:0.88, trash_days:14 } };
DB['roles']={ admin:{ name:'Admin', views:['rfq','sales-desk','part-stock','cut-strip','customers','manufacturing','statistics','settings','admin'] } };
DB['companies/c1/parts_cache']={ 'P-1':{ part_number:'P-1', description:'Connector', manufacturer:'Molex', qty:1 },
                                 'P-2':{ part_number:'P-2', description:'Old', deleted:true, deletedAtMs:Date.now()-2*86400000 } };
DB['companies/c1/projects']={ r1:{ name:'RFQ one', customer:'Acme', updatedAt:{toMillis:()=>1, toDate:()=>new Date()} } };
DB['companies/c1/customers']={ k1:{ name:'Acme' } };
DB['companies/c1/cut_strip_specs']={};
DB['companies/c1/audit_logs']={};
DB['companies/c1/support_tickets']={};

let pass=0, fail=0; const fails=[];
const ok=(n,c)=>{ if(c) pass++; else { fail++; fails.push(n); } };
const tick=()=>new Promise(r=>setTimeout(r,10));

try{
  await import(pathToFileURL(path.join(web,'js','main.js')).href);
  ok('every module loads and links', true);
}catch(e){ ok('every module loads and links: '+e.message, false); }

const { S }=await import(pathToFileURL(path.join(web,'js','core','state.js')).href);
const session=await import(pathToFileURL(path.join(web,'js','core','session.js')).href);
const { route }=await import(pathToFileURL(path.join(web,'js','core','router.js')).href);
const parts=await import(pathToFileURL(path.join(web,'js','data','parts.js')).href);

ok('the sign-in hook is wired', typeof globalThis.__authCb==='function');
await globalThis.__authCb({ uid:'u1', email:'admin@x.test' });
for(let i=0;i<10;i++) await tick();
ok('sign-in: the company is loaded', session.companyId==='c1' && session.companyName==='Radion');
ok('sign-in: shared state reaches every module (S)', S.currentUserEmail==='admin@x.test' && S._sdLaborRateMin===0.88 && S._psTrashDays===14);
ok('sign-in: the shell is shown', w.document.getElementById('shell').style.display==='flex');
ok('sign-in: the version is shown in the top bar', /v1\.59\.0/.test(w.document.getElementById('topbar-info').innerHTML));
ok('home: the home grid renders', /Sales Desk|Database/.test(w.document.getElementById('content').innerHTML));

const screens=[['part-stock',/MNF P\/N|Delete Selected/],['rfq',/RFQ/],['sales-desk',/BOM Items|Add from Database/],
  ['cut-strip',/Cut|Strip/i],['customers',/Acme|Customer/],['manufacturing',/btn-mfg-new/],
  ['statistics',/Statistic|Drawings|Users/i],['settings',/Settings|Users|Logo/i],['admin',/Admin|Support|Logs/i],['home',/Database/]];
for(const [view,re] of screens){
  const before=errors.length;
  try{ await route(view); }catch(e){ errors.push(view+': '+e.message); }
  for(let i=0;i<15;i++) await tick();
  const c=w.document.getElementById('content').innerHTML;
  if(SHOW===view) console.log(c.slice(0,1500)+'\nACTIONS: '+w.document.getElementById('topbar-actions').innerHTML.slice(0,500));
  ok(`screen "${view}" renders`, re.test(c+w.document.getElementById('topbar-actions').innerHTML) && errors.length===before);
}
// the Database screen and its live list come from data/parts.js
await route('part-stock'); for(let i=0;i<10;i++) await tick();
ok('database: the live part is listed', /P-1/.test(w.document.getElementById('content').innerHTML));
ok('database: the deleted part is in the bin, not the list', S.trashParts.some(p=>p._id==='P-2') && !S.allParts.some(p=>p._id==='P-2'));

console.error=oerr;
if(errors.length){ console.log('errors logged:'); errors.slice(0,15).forEach(e=>console.log('  · '+e.slice(0,300))); }
ok('no errors were logged anywhere', errors.length===0);
console.log(`\n  ${pass} passed, ${fail} failed\n`);
fails.forEach(f=>console.log('  ✗ '+f));
process.exit(fail?1:0);
