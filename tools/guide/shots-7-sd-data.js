// Guide shots 13c, 14c, 14d, 19b — the drawing's identity from its title block,
// editing the extracted table, customer-supplied material, Save to Database and
// the tools found for parts added from the Database. Demo data only.
const L=require('./lib.js');
const ROWS=[
 {item:'1',atlantium_pn:'CP-50001',part_number:'D38999/26WC-35SN',description:'PLUG 22P SIZE 13',qty:'1',unit:'pc',manufacturer:'Amphenol',pin_count:''},
 {item:'2',atlantium_pn:'CP-50002',part_number:'39-01-2040',description:'CONN RCPT 4POS MINI-FIT',qty:'1',unit:'pc',manufacturer:'Molex',pin_count:'4'},
 {item:'3',atlantium_pn:'CP-50003',part_number:'M27500-22SB2T23',description:'CABLE 2C 22AWG SHIELDED',qty:'1500',unit:'mm',manufacturer:'',customer_supplied:'yes'},
 {item:'4',atlantium_pn:'CP-50004',part_number:'HS-12-BK',description:'HEAT SHRINK 12MM BLACK',qty:'0.03',unit:'m',manufacturer:'ShrinkCo'}];
(async()=>{
  let {b,page,errs}=await L.open({w:1900,h:950});
  await page.route('https://us-central1-specprice-236a2.cloudfunctions.net/aiProxy', async r=>{
    if(r.request().method()==='GET') return r.fallback();
    const txt=JSON.stringify(JSON.parse(r.request().postData()).messages);
    const json=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:[{type:'text',text:o}],stop_reason:'end_turn'})});
    if(/TITLE BLOCK of an engineering drawing/.test(txt)) return json('{"drawing_number":"DEMO-100-01","title":"POWER HARNESS 1.5M","revision":"B","revisions":["A","B","C"]}');
    if(/Is there a PARTS LIST|manufacturing process engineer|manufacturing steps|MANUFACTURING INSTRUCTIONS/.test(txt)) return r.fallback();
    if(/Bill of Materials|BOM/i.test(txt)) return json(JSON.stringify(ROWS));
    return r.fallback(); });
  await L.signIn(page); await L.go(page,'sales-desk'); await page.waitForSelector('#btn-sd-file');
  await page.click('#btn-sd-file'); await page.waitForTimeout(300);
  await page.setInputFiles('#sd-file-input',L.A('DEMO-100-01.pdf'));
  await page.waitForSelector('#btn-save-bom',{timeout:90000}); await page.waitForTimeout(500);
  // a row added by hand
  await page.click('#pv-add-row'); await page.waitForTimeout(200);
  await page.evaluate(()=>{ const tr=document.querySelector('#preview-tbody tr:last-child');
    tr.querySelector('[data-k="part_number"]').textContent='CT-100-BK'; tr.querySelector('[data-k="description"]').textContent='CABLE TIE 100MM BLACK';
    tr.querySelector('[data-k="qty"]').textContent='4'; tr.querySelector('[data-k="unit"]').textContent='pc'; });
  const rowOf=pn=>page.evaluate(pn=>[...document.querySelectorAll('#preview-tbody tr')].findIndex(t=>t.textContent.includes(pn)),pn);
  const cab=await rowOf('M27500'), hs=await rowOf('HS-12-BK');
  await L.mark(page,[{sel:'#preview-tbody tr:first-child [data-k="drawing_number"]',pad:2},{sel:'#preview-tbody tr:first-child [data-k="revision"]',pad:2},
    {sel:'#preview-tbody tr:first-child [data-k="drawing_name"]',pad:2},{sel:'.pv-tool-note',pad:2},
    {sel:'.pv-cust',idx:cab,pad:6},{sel:'#pv-add-row',pad:3}]);
  await L.shot(page,'13c-sd-preview-edit','.modal');
  await L.unmark(page);
  await page.click('#btn-save-bom'); await page.waitForTimeout(5000);
  // the new columns, the customer-supplied row and its note
  await L.mark(page,[{sel:'#sd-table thead th[data-col="revision"]',pad:2},{sel:'#sd-table thead th[data-col="atlantium_pn"]',pad:2},
    {sel:'#sd-table thead th[data-col="customer_supplied"]',pad:2},{sel:'.sd-cust-supplied:checked',pad:6},'#btn-sd-savedb']);
  await L.shot(page,'14c-sd-columns',{x:0,y:0,width:1900,height:640});
  await L.unmark(page);
  // Save to Database: change a description, then save
  await page.evaluate(()=>{ const i=[...document.querySelectorAll('.sd-part-number')].find(x=>x.value==='CT-100-BK'); const d=i.closest('tr').querySelector('.sd-description'); d.value='CABLE TIE 100MM BLACK, UV'; d.dispatchEvent(new Event('change')); });
  await page.click('#btn-sd-savedb'); await page.waitForSelector('#sdb-go');
  await L.shot(page,'14d-sd-savedb-ask','.modal');
  await page.click('#sdb-go'); await page.waitForSelector('#sdb-close',{timeout:20000});
  await L.mark(page,[{sel:'.db-progress',pad:3},{sel:'.sdb-result',pad:4}]);
  await L.shot(page,'14e-sd-savedb-done','.modal');
  await L.unmark(page); await page.click('#sdb-close'); await page.waitForTimeout(500);
  // Add from Database: the plug, the Mini-Fit and a contact whose tool is in the Database
  await page.click('#btn-sd-clear'); await page.waitForTimeout(300);
  await page.click('#btn-sd-addpick'); await page.waitForSelector('#pp-tbody');
  await page.evaluate(()=>{ for(const pn of ['RL-M6-6','PC-24-S']){ const tr=[...document.querySelectorAll('#pp-tbody tr')].find(t=>t.children[1]?.textContent.trim()===pn); tr.querySelector('.pp-check').checked=true; } });
  await page.click('#pp-add'); await page.waitForTimeout(6000);
  await page.evaluate(()=>document.querySelectorAll('.toast').forEach(t=>t.remove()));
  const ix=pn=>page.evaluate(pn=>[...document.querySelectorAll('#sd-tbody tr[data-i]')].findIndex(t=>t.querySelector('.sd-part-number')?.value===pn),pn);
  const t1=await ix('PCT-2420'), t2=await ix('HT-RL6');
  await L.mark(page,[{sel:'#sd-tbody tr[data-i] td:nth-child(6)',idx:t1,pad:2},{sel:'.sd-tool-origin',idx:0,pad:2,at:'right'},
    {sel:'#sd-tbody tr[data-i] td:nth-child(6)',idx:t2,pad:2}]);
  await L.shot(page,'19b-sd-pick-tools',{x:0,y:0,width:1900,height:700});
  console.log('errors',errs); await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
