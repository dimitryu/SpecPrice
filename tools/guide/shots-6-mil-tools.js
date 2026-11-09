// Guide shots 18b/18c: a MIL-DTL-38999 plug whose tools the system knows (demo data; prices are examples).
const L=require('./lib.js');
const ROWS=[{item:'1',atlantium_pn:'',part_number:'D38999/26WC-35SN',description:'Plug (cable) 22pin FM SHL SIZE 13',qty:'1',unit:'pc',manufacturer:'',pin_count:'',drawing_number:'DEMO-400-01'},
 {item:'',atlantium_pn:'',part_number:'D38999/26WC-35SN-TOOL',description:'CRIMP TOOL for D38999/26WC-35SN',qty:'1',unit:'pc',manufacturer:'',pin_count:'',price:'150',drawing_number:'DEMO-400-01'},
 {item:'2',atlantium_pn:'',part_number:'M27500-22SB2T23',description:'CABLE 2 COND 22AWG SHIELDED',qty:'1500',unit:'mm',manufacturer:'',pin_count:'',drawing_number:'DEMO-400-01'}];
const PR={'M22520/2-01':{m:812.5,d:845.1},'M22520/2-07':{m:162.3,d:''},'M81969/14-01':{m:9.8,d:11.2}};
(async()=>{ let {b,page,errs}=await L.open({w:1500,h:900}); 
  await page.route('https://us-central1-specprice-236a2.cloudfunctions.net/**', async r=>{
    const u=new URL(r.request().url()); const json=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
    if(u.pathname==='/aiProxy'){ if(r.request().method()==='GET') return json({configured:true});
      const txt=JSON.stringify(JSON.parse(r.request().postData()).messages);
      if(/Is there a PARTS LIST/.test(txt)) return json({content:[{type:'text',text:'{"found":false}'}]});
      if(/Bill of Materials|BOM/i.test(txt)) return json({content:[{type:'text',text:JSON.stringify(ROWS)}]});
      return json({content:[{type:'text',text:'{}'}]}); }
    if(u.pathname==='/priceLookup'){ const pn=u.searchParams.get('pn'), p=PR[pn];
      const v=(x,site)=>x===''||x==null?null:{price:x,stock:'12',mpn:pn,manufacturer:'DMC',breakQty:1,exactMatch:true,desc:'tool',url:site+encodeURIComponent(pn)};
      return json({pn,qty:1,mouser:p?v(p.m,'https://www.mouser.com/ProductDetail/DMC/'):null,digikey:p?v(p.d,'https://www.digikey.com/en/products/detail/dmc/'):null,errors:[]}); }
    return r.fallback(); });
  await L.signIn(page); await L.go(page,'sales-desk'); await page.waitForSelector('#btn-sd-file');
  await page.click('#btn-sd-file'); await page.waitForTimeout(400);
  await page.setInputFiles('#sd-file-input',L.A('DEMO-100-01.pdf'));
  await page.waitForSelector('#btn-save-bom',{timeout:90000}); await page.waitForTimeout(500);
  //console.log('preview', await page.evaluate(()=>[...document.querySelectorAll('#preview-tbody tr')].map(tr=>[...tr.querySelectorAll('td')].slice(3,8).map(td=>td.innerText.trim()).join(' | '))));
  await page.click('#btn-save-bom'); await page.waitForTimeout(4000);
  const rows=()=>page.evaluate(()=>[...document.querySelectorAll('#sd-tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>{const i=td.querySelector('input,select');return (i?i.value:td.innerText).trim().replace(/\s+/g,' ');}).filter(Boolean).slice(0,12).join(' | ')));
  await page.click('#btn-sd-fc'); await page.waitForTimeout(500);
  await page.fill('.su-units','10'); await page.click('#su-go'); await page.waitForTimeout(4000);
  await page.click('#fc-close-x').catch(()=>{}); await page.waitForTimeout(1500);
  // the table rows of the connector and its three tools
  const t=await page.$('#sd-table'); const bb=await t.boundingBox();
  const rws=await page.$$('#sd-tbody tr'); const last=await rws[4].boundingBox();
  await L.mark(page,[{sel:'#sd-tbody tr:nth-child(3) td:nth-child(3)',pad:2},{sel:'#sd-tbody tr:nth-child(3) td:nth-child(4)',pad:2},{sel:'#sd-tbody tr:nth-child(4) td:nth-child(3)',pad:2},{sel:'#sd-tbody tr:nth-child(5) td:nth-child(3)',pad:2}]);
  await L.shot(page,'18b-sd-mil-tools',{x:bb.x,y:bb.y-4,width:Math.min(bb.width,1100),height:last.y+last.height-bb.y+12});
  await L.unmark(page);
  const h=await page.$('#sd-summary-host'); const box=await page.$('.sd-tool-links');
  await L.mark(page,[{sel:'.sd-tool-links',idx:0,pad:2,at:'right'}]);
  await L.shot(page,'18c-sd-mil-links',h);
  console.log('errors',errs); await b.close(); })().catch(e=>{console.error(e);process.exit(1)});
