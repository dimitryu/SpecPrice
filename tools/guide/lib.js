// Shared harness for the user-guide screenshots (web/guide/img/): demo data,
// the Firebase stand-in from tests/smoke, a mocked server and AI, and the
// numbered red markers the guide text refers to. See README.md here.
const path=require('path'), fs=require('fs');
let PW; try{ PW=require('playwright'); }catch{ PW=require(path.join(__dirname,'..','..','tests','node_modules','playwright')); }
const {chromium}=PW;
const STUBS=path.join(__dirname,'..','..','tests','smoke')+'/';
const stub=f=>fs.readFileSync(STUBS+f,'utf8');
const BASE=process.env.GUIDE_BASE||'http://127.0.0.1:8820';
const OUT=path.join(__dirname,'..','..','web','guide','img')+'/';
const A=f=>path.join(__dirname,'assets',f);
const LOGO='data:image/png;base64,'+fs.readFileSync(A('logo.png')).toString('base64');
const SPEC=JSON.parse(fs.readFileSync(A('spec-demo.json'),'utf8'));

// ── demo data ────────────────────────────────────────────────────────────────
const NOW=Date.UTC(2026,10,1,8,30,0);
const PARTS=[
 ['DCX-4P-90','DEMO-100-01','Power Cable 1000mm','CP-10021','PLUG, 90 DEG, 4 CONTACTS, 14-12AWG','ConnectaTech',1,'pcs',12.40,850,13.10,420,11.60,false],
 ['WL-14-3C','DEMO-100-01','Power Cable 1000mm','CP-10022','CABLE, POWER 14AWG 3 COND, UNSHIELDED','WireLine',1,'m',2.15,12000,2.32,8000,2.05,true],
 ['TF-2.5-BU','DEMO-100-01','Power Cable 1000mm','CP-10023','FERRULE 2.5MM2 BLUE','ProCrimp',1,'pcs',0.06,50000,0.07,30000,0.05,true],
 ['HS-12-BK','DEMO-100-01','Power Cable 1000mm','CP-10024','HEAT SHRINK 12MM BLACK','ShrinkCo',1,'m',1.10,900,0.95,0,1.20,false],
 ['LB-25-WH','DEMO-100-01','Power Cable 1000mm','CP-10025','LABEL, 25MM, WHITE, PRINTABLE','MarkIt',1,'pcs',0.18,5000,'',null,0.15,false],
 ['DCX-8S-ST','DEMO-220-03','Signal Harness 8-Way','CP-20031','RECEPTACLE, STRAIGHT, 8 SOCKETS','ConnectaTech',1,'pcs',18.90,230,17.75,160,'',false],
 ['WL-24-8S','DEMO-220-03','Signal Harness 8-Way','CP-20032','CABLE, 24AWG 8 COND, SHIELDED','WireLine',1,'m',1.85,3400,1.92,2100,1.70,false],
 ['PC-24-S','DEMO-220-03','Signal Harness 8-Way','CP-20033','CONTACT, SOCKET, 24-20AWG, GOLD','ConnectaTech',1,'pcs',0.42,15000,0.39,9000,'',false],
 ['BS-8-ST','DEMO-220-03','Signal Harness 8-Way','CP-20034','BACKSHELL, STRAIGHT, SIZE 8','ConnectaTech',1,'pcs',6.30,0,6.80,75,'',false],
 ['CT-100-BK','DEMO-220-03','Signal Harness 8-Way','CP-20035','CABLE TIE 100MM BLACK','FixIt',1,'pcs',0.03,90000,0.04,60000,0.02,true],
 ['PCT-2420','DEMO-220-03','Signal Harness 8-Way','','CRIMP TOOL FOR PC-24-S CONTACTS','ProCrimp',1,'pcs','',null,'',null,'',false],
 ['GR-6-YG','DEMO-310-02','Ground Strap 300mm','CP-31001','WIRE 6MM2 YELLOW-GREEN','WireLine',1,'m',1.40,4200,1.55,2600,1.30,false],
 ['RL-M6-6','DEMO-310-02','Ground Strap 300mm','CP-31002','RING LUG M6, 6MM2','ProCrimp',1,'pcs',0.22,20000,0.25,11000,0.19,true],
 ['HS-9-YG','DEMO-310-02','Ground Strap 300mm','CP-31003','HEAT SHRINK 9MM YELLOW-GREEN','ShrinkCo',1,'m',0.95,1300,1.05,700,'',false],
];
const ts=(daysAgo,h=10,m=0)=>{ const d=new Date(NOW-daysAgo*86400000); d.setUTCHours(h,m,0,0); const t=d.getTime();
  return `{toDate:()=>new Date(${t}),toMillis:()=>${t},seconds:${Math.floor(t/1000)}}`; };

function partsJS(){
  return '{'+PARTS.map((p,i)=>{
    const [pn,dwg,dname,cpn,desc,mfr,qty,unit,mo,mos,dk,dks,pr,own]=p;
    const f={part_number:pn,drawing_number:dwg,drawing_name:dname,atlantium_pn:cpn,description:desc,manufacturer:mfr,qty,unit,own_stock:own};
    if(mo!==''){ f.mouser_price=mo; f.mouser_stock=String(mos); f.mouser_match='exact'; }
    if(dk!==''){ f.digikey_price=dk; f.digikey_stock=String(dks); f.digikey_match='exact'; }
    if(pr!=='') f.priority_price=pr;
    return `'${pn}':Object.assign(${JSON.stringify(f)},{updatedAt:${ts(i%9+1)}})`;
  }).join(',')+`,'OLD-PART-1':{part_number:'OLD-PART-1',description:'CONNECTOR, OBSOLETE',manufacturer:'ConnectaTech',deleted:true,deletedAtMs:${NOW-3*86400000},deletedBy:'dana.cohen@demo-co.com'}`
   +`,'OLD-PART-2':{part_number:'OLD-PART-2',description:'CABLE 22AWG 2C (DUPLICATE)',manufacturer:'WireLine',deleted:true,deletedAtMs:${NOW-9*86400000},deletedBy:'dana.cohen@demo-co.com'}}`;
}

function auditJS(){
  const users=['dana.cohen@demo-co.com','avi.levi@demo-co.com','noa.mizrahi@demo-co.com'];
  const out=[]; let n=0;
  const add=(day,h,user,action,details,ok=true)=>out.push(`'a${++n}':{user:'${user}',action:'${action}',success:${ok},details:${JSON.stringify(details)},timestamp:${ts(day,h,(n*7)%60)}}`);
  for(let day=0;day<28;day++){
    if(day%7===5||day%7===6) continue;
    users.forEach((u,i)=>{ if((day+i)%4!==3) add(day,7+i,u,'login',''); });
    add(day,9,users[1],'screen_open',{screen:'sales-desk'});
    add(day,9,users[0],'screen_open',{screen:'part-stock'});
    if(day%2===0) add(day,11,users[2],'screen_open',{screen:'cut-strip'});
    if(day%3===0){ const f=['DEMO-100-01.pdf','DEMO-220-03.pdf','DEMO-310-02.pdf'][day%9/3|0];
      add(day,10,users[1],'drawing_bom_search',{filename:f,provider:'anthropic',mode:'vision',rowsFound:6+day%5,ms:21000+day*400});
      add(day,10,users[1],'sales_desk_add_from_drawing',{count:6+day%5});
      add(day,11,users[1],'price_check',{checked:8,found:7,failed:0,ms:9000+day*150});
      add(day,12,users[1],'sales_desk_export',{rows:8}); }
    if(day===4) add(day,10,users[1],'drawing_bom_search',{filename:'scan-blurry.jpg',mode:'vision'},false);
  }
  return '{'+out.join(',')+'}';
}

const SEED=()=>`
Date.now=(()=>{ const t=${NOW}; return ()=>t; })();
window.__DB={
 users:{
  u1:{company_id:'c1',role:'admin',email:'dana.cohen@demo-co.com',displayName:'Dana Cohen'},
  u2:{company_id:'c1',role:'sales',email:'avi.levi@demo-co.com',displayName:'Avi Levi'},
  u3:{company_id:'c1',role:'agent',email:'noa.mizrahi@demo-co.com',displayName:'Noa Mizrahi'},
  u4:{company_id:'c1',role:'viewer',email:'yossi.bar@demo-co.com',displayName:'Yossi Bar',disabled:true}},
 companies:{c1:{name:'Demo Cables Ltd.',labor_rate_min:0.75,trash_days:30,logo_b64:'${LOGO}'}},
 roles:{
  _meta:{seeded:true},
  admin:{name:'Admin',views:['sales-desk','part-stock','cut-strip','manufacturing','statistics','settings','admin']},
  agent:{name:'Agent',views:['sales-desk','part-stock','cut-strip','manufacturing']},
  sales:{name:'Sales',views:['sales-desk','part-stock']},
  viewer:{name:'Viewer',views:['part-stock','cut-strip'],disabledViews:['cut-strip']}},
 'companies/c1/parts_cache':${partsJS()},
 'companies/c1/projects':{}, 'companies/c1/customers':{},
 'companies/c1/cut_strip_specs':{}, 'companies/c1/audit_logs':${auditJS()},
 'companies/c1/support_tickets':{
   t1:{user:'avi.levi@demo-co.com',message:'The Check Price button shows "Not found" for part HS-12-BK, but we bought it from DigiKey last month.',status:'in_progress',
       createdAt:${ts(2,9,15)},lastMsgAt:${ts(1,14,5)},lastMsgRole:'admin',userUnread:true,adminUnread:false,
       thread:[{role:'admin',by:'dana.cohen@demo-co.com',text:'Thanks Avi — the part number on the drawing has an extra dash. I fixed it in the Database; please run Check Price again.',at:'${new Date(NOW-86400000).toISOString()}'}]},
   t2:{user:'noa.mizrahi@demo-co.com',message:'Can we add a Russian version of the cut & strip sheet for the night shift?',status:'done',
       createdAt:${ts(6,11,0)},lastMsgAt:${ts(5,10,0)},lastMsgRole:'admin',userUnread:false,adminUnread:false,
       thread:[{role:'admin',by:'dana.cohen@demo-co.com',text:'Done — use the RU button at the top of the sheet.',at:'${new Date(NOW-5*86400000).toISOString()}'}]},
   t3:{user:'avi.levi@demo-co.com',message:'Please add the new customer drawing format (two BOM tables on one sheet).',status:'open',
       createdAt:${ts(0,8,10)},lastMsgAt:${ts(0,8,10)},lastMsgRole:'user',userUnread:false,adminUnread:true,thread:[]}}
};
localStorage.setItem('cs_lang','he');
localStorage.setItem('ai_proxy','1');
`;

// ── mocked AI ────────────────────────────────────────────────────────────────
const BOM_ROWS=[
 {item:'1',atlantium_pn:'CP-10021',part_number:'DCX-4P-90',description:'PLUG, 90 DEG, 4 CONTACTS, 14-12AWG',qty:'1',unit:'pcs',manufacturer:'ConnectaTech'},
 {item:'2',atlantium_pn:'CP-10022',part_number:'WL-14-3C',description:'CABLE, POWER 14AWG 3 COND, UNSHIELDED',qty:'1',unit:'m',manufacturer:'WireLine'},
 {item:'3',atlantium_pn:'CP-10023',part_number:'TF-2.5-BU',description:'FERRULE 2.5MM2 BLUE',qty:'3',unit:'pcs',manufacturer:'ProCrimp'},
 {item:'4',atlantium_pn:'CP-10024',part_number:'HS-12-BK',description:'HEAT SHRINK 12MM BLACK',qty:'0.03',unit:'m',manufacturer:'ShrinkCo'},
 {item:'5',atlantium_pn:'CP-10025',part_number:'LB-25-WH',description:'LABEL, 25MM, WHITE, PRINTABLE',qty:'2',unit:'pcs',manufacturer:'MarkIt'},
 {item:'',atlantium_pn:'',part_number:'PCT-2510',description:'CRIMP TOOL FOR TF-2.5 FERRULES',qty:'1',unit:'pcs',manufacturer:'ProCrimp',price:'185'},
];
const DETAIL={segments:[{id:'S1',conductors:SPEC.segments[0].conductors}],markers:SPEC.markers,
  engineering_notes:[{n:'1',text:'Strip 70 mm of jacket on side A so the conductors can bend inside the 90° plug',action:'strip'}]};
const MFG={steps:[
  {n:1,title:'חיתוך הכבל',body:'חתכו כבל WL-14-3C באורך 1000 מ״מ.',critical:'אורך כולל מחברים — אין להוסיף תוספת.'},
  {n:2,title:'חשיפת מעטה',body:'צד A: הסירו 70 מ״מ מעטה חיצוני. צד B: הסירו 50 מ״מ.'},
  {n:3,title:'חשיפת גידים',body:'הסירו 8 מ״מ בידוד מכל גיד בצד B.'},
  {n:4,title:'לחיצת פרולים',body:'לחצו פרול TF-2.5-BU על כל גיד בצד B.',critical:'השתמשו בכלי PCT-2510 בלבד.'},
  {n:5,title:'הרכבת תקע',body:'חברו את הגידים לתקע DCX-4P-90 לפי טבלת החיווט (A/B/C).'},
  {n:6,title:'סימון',body:'הדביקו תוויות 20 מ״מ מכל קצה: Control Box W1 / Motor M1.'},
  {n:7,title:'בדיקה חשמלית',body:'בדקו רציפות ובידוד לכל גיד.'}],
  inspection:['אורך כולל 1000 ±10 מ״מ','כל הפרולים לחוצים היטב ואין גידים חשופים','התוויות במקום הנכון וקריאות','בדיקת רציפות עברה'],
  tools:[{tool:'PCT-2510',setting:'2.5 מ״מ²',note:'כלי לחיצה לפרולים'},{tool:'מסיר בידוד',setting:'14AWG',note:''}]};
function aiReply(body){
  const c=body.messages[0].content;
  const txt=typeof c==='string'?c:c.map(x=>x.text||'').join(' ');
  if(process.env.GDBG) console.log('AI>',txt.slice(0,150).replace(/\s+/g,' '));
  if(/Is there a PARTS LIST/.test(txt)) return '{"found":true,"box":[0.02,0.62,0.45,0.97],"rows":6}';
  if(/THIS PASS IS THE CUTTING DATA ONLY/.test(txt)) return JSON.stringify(SPEC);
  if(/What is missing is the\s+wiring/.test(txt)) return JSON.stringify(DETAIL);
  if(/writing the assembly instruction/.test(txt)) return JSON.stringify(MFG);
  if(/manufacturing process engineer|manufacturing steps/i.test(txt)) return JSON.stringify({steps:[
    {operation:'Cut cable to length',row_idx:1,unit_minutes:0.5,qty_in_drawing:1},
    {operation:'Strip jacket and conductors',row_idx:1,unit_minutes:1.5,qty_in_drawing:1},
    {operation:'Crimp ferrule',row_idx:2,unit_minutes:0.3,qty_in_drawing:3},
    {operation:'Assemble 90° plug',row_idx:0,unit_minutes:4,qty_in_drawing:1},
    {operation:'Heat shrink',row_idx:3,unit_minutes:0.8,qty_in_drawing:1},
    {operation:'Apply labels',row_idx:4,unit_minutes:0.4,qty_in_drawing:2},
    {operation:'Continuity test',row_idx:null,unit_minutes:2,qty_in_drawing:1}],single_unit_minutes:10.6});
  if(/NOTES/.test(txt)&&/MANUFACTURING INSTRUCTIONS/.test(txt)) return '["Note 1: strip 70 mm of jacket on side A","Note 2: labels 20 mm from each end"]';
  if(/translat/i.test(txt)){ const m=txt.match(/\[[\s\S]*\]/); return m?m[0]:'[]'; }
  if(/Bill of Materials|BOM/i.test(txt)) return JSON.stringify(BOM_ROWS);
  return '{}';
}
const PRICE={}; PARTS.forEach(p=>{ PRICE[p[0]]={mo:p[8],mos:p[9],dk:p[10],dks:p[11],mfr:p[5],desc:p[4]}; });

async function open(opts={}){
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
  const ctx=await b.newContext({viewport:{width:opts.w||1440,height:opts.h||860},deviceScaleFactor:1.5,locale:'en-US'});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.route('https://www.gstatic.com/firebasejs/**', r=>r.fulfill({contentType:'application/javascript',
    body:stub(r.request().url().split('/').pop().replace('.js','.mjs'))}));
  await page.route('https://api.anthropic.com/**', r=>r.abort());
  await page.route('https://us-central1-specprice-236a2.cloudfunctions.net/**', async r=>{
    const u=new URL(r.request().url()), m=r.request().method();
    const json=(o,s=200)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(o)});
    if(u.pathname==='/aiProxy'){
      if(m==='GET') return json({configured:true});
      const body=JSON.parse(r.request().postData());
      if(opts.aiDelay) await new Promise(res=>setTimeout(res,opts.aiDelay));
      return json({content:[{type:'text',text:aiReply(body)}],stop_reason:'end_turn'});
    }
    if(u.pathname==='/priceLookup'){
      const pn=u.searchParams.get('pn'), p=PRICE[pn];
      if(opts.priceDelay) await new Promise(res=>setTimeout(res,opts.priceDelay));
      const v=(price,stock)=>price===''||price==null?null:{price,stock:String(stock),mpn:pn,manufacturer:p.mfr,breakQty:1,exactMatch:true,desc:p.desc};
      return json({pn,qty:1,mouser:p?v(p.mo,p.mos):null,digikey:p?v(p.dk,p.dks):null,errors:[]});
    }
    if(u.pathname==='/priceProxy'){
      const cur=(decodeURIComponent(u.search).match(/([A-Z]{3})_USD/)||[])[1]||'ILS';
      const rate={ILS:'0.2700',EUR:'1.0800',GBP:'1.2700',CHF:'1.1300',JPY:'0.0067'}[cur]||'1';
      return r.fulfill({status:200,contentType:'text/html',body:'<html><body>'+'x'.repeat(300)+` 1 ${cur} = ${rate} USD </body></html>`});
    }
    if(u.pathname==='/apiConfig'){
      if(m==='GET') return json({mouser:{configured:true,hint:'…7f2a',source:'ui'},digikey:{configured:true,clientIdHint:'…91cc',secretHint:'…04de',source:'ui'},
        updatedAt:new Date(NOW-20*86400000).toISOString(),updatedBy:'dana.cohen@demo-co.com',
        anthropic:{configured:true,hint:'…x9Qa',source:'ui',updatedAt:new Date(NOW-3*86400000).toISOString(),updatedBy:'dana.cohen@demo-co.com'}});
      return json({ok:true,message:'Connected — the key works',mouser:{ok:true,message:'Found — $1.10 @ qty 1'},digikey:{ok:true,message:'Found — $0.95 @ qty 1'},pn:'HS-12-BK'});
    }
    return json({});
  });
  await page.addInitScript(SEED()+(opts.init||''));
  return {b,page,errs};
}
async function signIn(page, uid='u1', email='dana.cohen@demo-co.com'){
  await page.goto(BASE+'/app.html');
  await page.waitForFunction(()=>typeof window.__authCb==='function');
  await page.evaluate(([uid,email])=>window.__authCb({uid,email}),[uid,email]);
  await page.waitForSelector('.home-btn');
  await page.waitForTimeout(400);
}
async function go(page, view){
  if(view==='home'){ await page.click('#btn-home'); }
  else { if(await page.$('#btn-home:visible')) await page.click('#btn-home'); await page.click(`.home-btn[data-view="${view}"]`); }
  await page.waitForTimeout(700);
}
// Draws numbered markers. items: [selector | {sel, pad, idx(nth match), label}]
async function mark(page, items){
  await page.evaluate((items)=>{
    document.querySelectorAll('.__gm').forEach(e=>e.remove());
    const vw=innerWidth, vh=innerHeight;
    items.forEach((it,i)=>{
      const o=typeof it==='string'?{sel:it}:it;
      const els=document.querySelectorAll(o.sel); const el=els[o.idx||0];
      if(!el){ console.warn('MARK MISSING',o.sel); return; }
      const r=el.getBoundingClientRect(); const pad=o.pad??4;
      const box=document.createElement('div'); box.className='__gm';
      Object.assign(box.style,{position:'fixed',left:(r.left-pad)+'px',top:(r.top-pad)+'px',width:(r.width+2*pad)+'px',height:(r.height+2*pad)+'px',
        border:'3px solid #E11D48',borderRadius:'7px',zIndex:2147483646,pointerEvents:'none',boxShadow:'0 0 0 2px rgba(255,255,255,.7)'});
      const n=document.createElement('div'); n.className='__gm'; n.textContent=String(o.n||i+1);
      let x=r.left-pad-14, y=r.top-pad-14;
      if(o.at==='right') x=r.right+pad-14;
      if(o.at==='bottom'){ y=r.bottom+pad-14; }
      x=Math.max(2,Math.min(vw-30,x)); y=Math.max(2,Math.min(vh-30,y));
      Object.assign(n.style,{position:'fixed',left:x+'px',top:y+'px',width:'28px',height:'28px',borderRadius:'50%',background:'#E11D48',color:'#fff',
        font:'700 15px/28px Arial',textAlign:'center',zIndex:2147483647,pointerEvents:'none',boxShadow:'0 1px 4px rgba(0,0,0,.35)',border:'2px solid #fff'});
      document.body.appendChild(box); document.body.appendChild(n);
    });
  }, items);
}
async function unmark(page){ await page.evaluate(()=>document.querySelectorAll('.__gm').forEach(e=>e.remove())); }
async function shot(page, name, clip){
  await page.waitForTimeout(250);
  const o={path:OUT+name+'.png'};
  if(clip && typeof clip==='object' && clip.boundingBox){ const bb=await clip.boundingBox(); o.clip={x:Math.max(0,bb.x-10),y:Math.max(0,bb.y-10),width:bb.width+20,height:Math.min(bb.height+20,1400)}; clip=null; }
  if(clip){ if(typeof clip==='string'){ const bb=await (await page.$(clip)).boundingBox(); o.clip={x:Math.max(0,bb.x-12),y:Math.max(0,bb.y-12),width:bb.width+24,height:bb.height+24}; } else o.clip=clip; }
  await page.screenshot(o);
  await unmark(page);
  console.log('shot',name);
}
async function sheetClip(page,h){ const bb=await (await page.$('#cs-sheet')).boundingBox(); const vh=page.viewportSize().height; return {x:Math.max(0,bb.x-10),y:0,width:bb.width+20,height:h||vh}; }
async function panel(page,sel){ const h=await page.$(sel); const p=await h.evaluateHandle(e=>e.closest('.settings-panel')||e); await p.evaluate(e=>e.scrollIntoView({block:'start'})); await page.waitForTimeout(300); return p; }
module.exports={A,sheetClip,panel,open,signIn,go,mark,unmark,shot,BASE,OUT,NOW};
