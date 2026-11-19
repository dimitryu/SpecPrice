/* Which model does which AI job, and with which thinking setting (v1.82):
   strong model for reading drawings, the small one for text and small jobs,
   thinking off where it is not needed — and a graceful way back when the
   account or the server will not take the new settings. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const dom=new JSDOM(`<!doctype html><html><body></body></html>`,{url:'https://x.test'});
const g=dom.window;
const src=fs.readFileSync('extracted.js','utf8');
const pre=`var db={}, auth={currentUser:{uid:'u1', getIdToken:async()=>'t'}};
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
const body=(task,base)=>JSON.parse(JSON.stringify(M.aiBody(task,base||{max_tokens:400,messages:[]})));
const set=js=>vm.runInContext(js, ctx);

(async()=>{
  // ── the server passes thinking on (aiProxy v1.82) ──
  set(`aiThinkCtl=true; _aiLightDown=false; _csModelDown=false;`);
  const READ=['cs_core','cs_detail','cs_bom','bom_image','bom_locate','title_image'];
  const LIGHT=['bom_text','title_text','process','notes','mfg_steps','translate'];
  ok('read jobs → the strong model, thinking off', READ.every(t=>{ const b=body(t); return b.model==='claude-sonnet-5' && b.thinking && b.thinking.type==='disabled'; }));
  ok('light jobs → the small new model, thinking off', LIGHT.every(t=>{ const b=body(t); return b.model==='claude-haiku-5-5' && b.thinking && b.thinking.type==='disabled'; }));
  const tw=body('tools_web',{max_tokens:4096,messages:[]});
  ok('crimp-tool web search → the strong model, thinking left on at low effort', tw.model==='claude-sonnet-5' && !tw.thinking && tw.output_config && tw.output_config.effort==='low');
  ok('budgets are left as the job asked when thinking is off', body('bom_locate').max_tokens===400 && body('cs_core',{max_tokens:16000,messages:[]}).max_tokens===16000);
  ok('every job in the app has a route', ['cs_core','cs_detail','cs_bom','bom_image','bom_locate','title_image','tools_web','bom_text','title_text','process','notes','mfg_steps','translate'].every(t=>t in M.AI_TASKS));

  // ── a server that cannot pass it on yet ──
  set(`aiThinkCtl=false;`);
  ok('light jobs stay on the previous small model (it does not think by default)', LIGHT.every(t=>body(t).model==='claude-haiku-4-5-20251001' && !('thinking' in body(t))));
  ok('read jobs: no thinking setting sent, and room left for the thinking', READ.every(t=>!('thinking' in body(t))) && body('bom_locate').max_tokens===2048 && body('cs_core',{max_tokens:16000,messages:[]}).max_tokens===32000);
  ok('the strong model falls back to the old small one when the account cannot use it',
     (set(`_csModelDown=true;`), body('cs_core').model==='claude-haiku-4-5-20251001'));
  set(`_csModelDown=false; aiThinkCtl=true;`);

  // ── _aiFetch: what goes over the wire, and the way back ──
  const sent=[]; let replies=[];
  ctx.__f.sent=b=>sent.push(b); ctx.__f.next=()=>replies.shift();
  set(`_fetchWithRetry=async(u,o)=>{ __f.sent(JSON.parse(o.body)); const r=__f.next();
    return {ok:r.status===200, status:r.status, clone(){ return this; }, json:async()=>r.body}; };`);
  replies=[{status:200, body:{content:[{type:'text',text:'[]'}]}}];
  await M._aiFetch({body:JSON.stringify(M.aiBody('notes',{max_tokens:1536,temperature:0,messages:[{role:'user',content:'x'}]}))});
  ok('wire: the routing tag is not sent', !('_task' in sent[0]));
  ok('wire: no temperature for a model that refuses it', !('temperature' in sent[0]));
  sent.length=0;
  replies=[{status:404, body:{error:{message:'model: claude-haiku-5-5 not found'}}}, {status:200, body:{content:[]}}];
  await M._aiFetch({body:JSON.stringify(M.aiBody('process',{max_tokens:2048,messages:[]}))});
  ok('new small model refused → asked again on the previous one, once', sent.length===2 && sent[0].model==='claude-haiku-5-5' && sent[1].model==='claude-haiku-4-5-20251001');
  ok('...and remembered for the session', body('process').model==='claude-haiku-4-5-20251001');
  set(`_aiLightDown=false;`); sent.length=0;
  replies=[{status:400, body:{error:{message:'thinking: unknown field'}}}, {status:200, body:{content:[]}}];
  await M._aiFetch({body:JSON.stringify(M.aiBody('cs_core',{max_tokens:16000,messages:[]}))});
  ok('thinking setting refused → asked again without it, with room for the thinking', sent.length===2 && sent[0].thinking && !('thinking' in sent[1]) && sent[1].max_tokens===32000);
  ok('...and not sent again this session', !('thinking' in body('cs_core')));
  sent.length=0; set(`aiThinkCtl=true;`);
  replies=[{status:400, body:{error:{message:'max_tokens too large'}}}];
  const r=await M._aiFetch({body:JSON.stringify(M.aiBody('notes',{max_tokens:1536,messages:[]}))});
  ok('any other error comes back as it was, not retried', sent.length===1 && r.status===400);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fails.forEach(f=>console.log('  ✗ '+f));
  if(fail) process.exit(1);
})().catch(e=>{ console.error('HARNESS ERROR', e); process.exit(1); });
