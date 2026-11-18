// Guide shots 19c, 05b — an adhesive bought by the bottle (Pack ml) and a
// drawing's BOM shown from the Database. Demo data only.
const L=require('./lib.js');
const fs=require('fs'), os=require('os'), path=require('path');
// The demo drawing under a second drawing number (the file name is part of
// how a drawing's number is found).
const DWG2=path.join(os.tmpdir(),'DEMO-300-01.pdf');
fs.copyFileSync(L.A('DEMO-100-01.pdf'), DWG2);
const ROWS=[
 {item:'1',atlantium_pn:'CP-30001',part_number:'DCX-4P-90',description:'PLUG, 90 DEG, 4 CONTACTS, 14-12AWG',qty:'1',unit:'pc',manufacturer:'ConnectaTech',pin_count:'4'},
 {item:'2',atlantium_pn:'CP-30002',part_number:'HS-12-BK',description:'HEAT SHRINK 12MM BLACK',qty:'40',unit:'mm',manufacturer:'ShrinkCo'},
 {item:'3',atlantium_pn:'CP-30003',part_number:'TL-243-50',description:'THREADLOCKER ADHESIVE, MEDIUM STRENGTH',qty:'5',unit:'ml',manufacturer:'DemoBond'}];
(async()=>{
  let {b,page,errs}=await L.open({w:1900,h:950});
  await page.route('https://us-central1-specprice-236a2.cloudfunctions.net/**', async r=>{
    const u=new URL(r.request().url());
    const json=(o,st=200)=>r.fulfill({status:st,contentType:'application/json',body:JSON.stringify(o)});
    if(u.pathname==='/priceLookup' && u.searchParams.get('pn')==='TL-243-50')
      return json({pn:'TL-243-50',qty:1,mouser:{price:18.4,stock:'60',mpn:'TL-243-50',manufacturer:'DemoBond',breakQty:1,exactMatch:true,
        desc:'Threadlocker medium strength, 50ML BOTTLE',url:'https://www.example.com/tl-243-50'},digikey:null,errors:[]});
    if(u.pathname!=='/aiProxy' || r.request().method()==='GET') return r.fallback();
    const txt=JSON.stringify(JSON.parse(r.request().postData()).messages);
    const ok=o=>json({content:[{type:'text',text:o}],stop_reason:'end_turn'});
    if(/TITLE BLOCK of an engineering drawing/.test(txt)) return ok('{"drawing_number":"DEMO-300-01","title":"FAN HARNESS 200MM","revision":"A","revisions":["A"]}');
    if(/HAND CRIMP TOOL|Is there a PARTS LIST|manufacturing process engineer|manufacturing steps|MANUFACTURING INSTRUCTIONS/.test(txt)) return r.fallback();
    if(/Bill of Materials|BOM/i.test(txt)) return ok(JSON.stringify(ROWS));
    return r.fallback(); });
  await L.signIn(page); await L.go(page,'sales-desk'); await page.waitForSelector('#btn-sd-file');
  await page.click('#btn-sd-file'); await page.waitForTimeout(300);
  await page.setInputFiles('#sd-file-input',DWG2);
  await page.waitForSelector('#btn-save-bom',{timeout:90000}); await page.waitForTimeout(500);
  await page.click('#btn-save-bom'); await page.waitForTimeout(4000);
  // Check Price for 20 cables: the bottle size comes from the supplier's description.
  await page.click('#btn-sd-fc'); await page.waitForTimeout(500);
  await page.fill('.su-units','20'); await page.click('#su-go'); await page.waitForTimeout(3500);
  await page.click('#fc-close-x').catch(()=>{}); await page.waitForTimeout(1500);
  const ad=await page.evaluate(()=>[...document.querySelectorAll('#sd-tbody tr[data-i]')].findIndex(t=>/THREADLOCKER/.test(t.querySelector('.sd-description')?.value||'')));
  await page.evaluate(()=>{ const th=document.querySelector('#sd-table thead th[data-col="pack_ml"]');
    let w=th; while(w && w!==document.body && !(w.scrollWidth>w.clientWidth+2 && getComputedStyle(w).overflowX!=='visible')) w=w.parentElement;
    const q=document.querySelector('#sd-table thead th[data-col="qty"]');
    if(w && w!==document.body) w.scrollLeft=Math.max(0, q.offsetLeft-20); });
  await page.evaluate(()=>{ const f=document.getElementById('btn-support-fab'); if(f) f.style.visibility='hidden'; });
  await L.mark(page,[{sel:'#sd-tbody .sd-qty',idx:ad,pad:3},{sel:'#sd-tbody .sd-pack-ml',pad:3},{sel:'#sd-tbody .sd-bottles',pad:3,at:'right'},{sel:'#sd-tbody .sd-manual-total',idx:ad,pad:3}]);
  const box=await page.evaluate(()=>{ window.scrollTo(0,0); const t=document.querySelector('#sd-table').getBoundingClientRect();
    const w=document.querySelector('#sd-table').closest('.table-wrap, div[style*="overflow"]')?.getBoundingClientRect()||t;
    return {x:Math.max(0,w.left-4), y:Math.max(0,t.top-8), width:Math.min(w.width+8,1900), height:Math.min(t.height+60,400)}; });
  await L.mark(page,[{sel:'#sd-tbody .sd-qty',idx:ad,pad:3},{sel:'#sd-tbody .sd-pack-ml',pad:3},{sel:'#sd-tbody .sd-bottles',pad:3,at:'right'},{sel:'#sd-tbody .sd-manual-total',idx:ad,pad:3}]);
  await L.shot(page,'19c-sd-adhesive',box);
  await L.unmark(page);
  // The Database: the shared part lists both drawings; a drawing's BOM.
  await L.go(page,'part-stock'); await page.waitForSelector('#ps-table');
  await page.fill('#ps-search','HS-12-BK'); await page.waitForTimeout(1200);
  await L.mark(page,[{sel:'#ps-table tbody tr:first-child td:nth-child(2)',pad:2}]);
  await L.shot(page,'05b-db-drawings',{x:0,y:0,width:1300,height:330});
  await L.unmark(page);
  await page.click('.ps-dwg-link[data-dwg="DEMO-300-01"]'); await page.waitForTimeout(1200);
  await L.mark(page,['.ps-dwg-bom',{sel:'#ps-table thead th[data-col="drawing_number"]',pad:2}]);
  await L.shot(page,'05c-db-drawing-bom',{x:0,y:0,width:1300,height:470});
  console.log('errors',errs); await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
