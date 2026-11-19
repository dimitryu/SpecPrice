const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1200,h:760,aiDelay:900});
  await L.signIn(page);
  await L.go(page,'sales-desk'); await page.waitForSelector('#btn-sd-file');
  await L.mark(page,['#btn-sd-addpick','#btn-sd-file','#btn-sd-newrow','#btn-sd-fc','#btn-sd-savedb','#btn-sd-labor','#btn-sd-clear','#sd-summary-host','#btn-sd-export']);
  await L.shot(page,'10-sd-empty',{x:0,y:0,width:1200,height:330});
  await page.click('#btn-sd-file'); await page.waitForTimeout(400);
  await L.mark(page,['#sd-drop-zone']);
  await L.shot(page,'11-sd-newdrawing','.modal');
  await page.evaluate(()=>{ window.__dbDelay=450; });
  await page.setInputFiles('#sd-file-input',L.A('DEMO-100-01.pdf'));
  await page.waitForTimeout(1600);
  await L.shot(page,'12-sd-analysing','.modal');
  // No review table: read → Sales Desk → Database → prices, each with its progress.
  await page.waitForSelector('[data-stage="db"].stage-run',{timeout:90000}); await page.waitForTimeout(1300);
  await L.mark(page,[{sel:'[data-stage="read"]',pad:3},{sel:'[data-stage="process"] .stage-time',pad:3},{sel:'[data-stage="db"]',pad:3}]);
  await L.shot(page,'13-sd-import','.modal');
  await L.unmark(page);
  await page.waitForSelector('#sd-import-close',{timeout:90000}); await page.evaluate(()=>{ window.__dbDelay=0; });
  await page.waitForTimeout(400);
  await L.mark(page,[{sel:'[data-stage="price"]',pad:3},{sel:'.sd-import-done',pad:3},'#sd-import-close']);
  await L.shot(page,'13b-sd-import-done','.modal');
  await L.unmark(page);
  await page.click('#sd-import-close'); await page.waitForTimeout(1500);
  const sdTool=await page.evaluate(()=>[...document.querySelectorAll('#sd-tbody tr[data-i]')].findIndex(tr=>tr.querySelector('.sd-part-number')?.value==='PCT-2510'));
  await L.mark(page,['#sd-search',{sel:'#sd-tbody tr[data-i] td:nth-child(6)',idx:sdTool,pad:2},'.sd-in-units','.sd-in-tools',{sel:'.sd-btn-breakdown',pad:3},{sel:'.sd-in-minutes',at:'right'},'.sd-in-rate','.sd-in-profit','.summary-total']);
  await L.shot(page,'14-sd-loaded',{x:0,y:0,width:1200,height:560});
  { const box=await page.$('.sd-tool-src'); const host=await box.evaluateHandle(e=>e.closest('div[style*="fffbeb"]')||e.parentElement);
    await host.evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(300);
    await L.mark(page,[{sel:'.sd-tool-search',pad:2,at:'right'},{sel:'.sd-tool-src',pad:2,at:'right'},{sel:'.sd-tool-links',pad:2,at:'right'}]);
    await L.shot(page,'14b-sd-tool-ai',host); await page.evaluate(()=>window.scrollTo(0,0)); }
  const notes=await page.$('#sd-notes-panel'); 
  if(notes && await notes.isVisible()){
    await notes.evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(300);
    await L.mark(page,[{sel:'#sd-notes-details summary',pad:2}]); await L.shot(page,'14f-sd-notes','#sd-notes-panel'); await L.unmark(page);
    await page.evaluate(()=>window.scrollTo(0,0)); }
  else throw new Error('notes panel did not appear');
  await page.click('.sd-btn-breakdown'); await page.waitForTimeout(800);
  await L.shot(page,'15-sd-labor','.modal');
  await page.evaluate(()=>closeModal()); await page.waitForTimeout(300);
  await page.click('#btn-sd-fc'); await page.waitForTimeout(500);
  await L.mark(page,['.su-units']);
  await L.shot(page,'16-sd-units','.modal');
  await page.fill('.su-units','50'); await page.click('#su-go');
  await page.waitForTimeout(3500);
  await page.click('#fc-close-x').catch(()=>{}); await page.waitForTimeout(1500);
  // The price columns sit right of the table's visible part: scroll them into view first.
  const exp=await page.evaluate(()=>{
    const th=document.querySelector('#sd-table thead th[data-col="mouser_price"]');
    let w=th; while(w && w!==document.body && !(w.scrollWidth>w.clientWidth+2 && getComputedStyle(w).overflowX!=='visible')) w=w.parentElement;
    // The frozen columns stay on the left, so the price column has to come out right of them.
    const fz=document.querySelector('#sd-table thead th.col-frozen-last');
    const fzRight=fz ? fz.offsetLeft+fz.offsetWidth : 0;
    if(w && w!==document.body) w.scrollLeft=Math.max(0, th.offsetLeft-fzRight-12);
    const b=document.querySelector('#btn-sd-export'); const r=b&&b.getBoundingClientRect();
    return r?{top:r.top,bottom:r.bottom,left:r.left}:null;
  });
  if(process.env.GDBG) console.log('export button at', exp);
  await page.evaluate(()=>{ const f=document.getElementById('btn-support-fab'); if(f) f.style.visibility='hidden'; });
  await L.mark(page,[{sel:'#sd-table thead th[data-col="mouser_price"]',pad:2},'.summary-total','.summary-order','#btn-sd-export']);
  await L.shot(page,'17-sd-priced',{x:0,y:0,width:1200,height:Math.max(620, Math.ceil((exp&&exp.bottom||0)+12))});
  await page.evaluate(()=>{ const f=document.getElementById('btn-support-fab'); if(f) f.style.visibility=''; });
  // tools warning close-up
  const warn=await page.$('text=Final price does NOT include');
  if(warn){ await L.mark(page,[{sel:'.sd-tool-jump',pad:3,at:'right'},{sel:'.sd-tool-for',pad:2,at:'right'},{sel:'.sd-tool-src',pad:2,at:'right'},{sel:'.sd-tool-links',pad:2,at:'right'}]); await L.shot(page,'18-sd-summary','#sd-summary-host'); }
  // Compact view: the supplier columns hidden, Part Cost names the cheapest supplier.
  // The choice is saved on the user's own profile and is still there next time.
  await page.click('#sd-view-compact'); await page.waitForTimeout(700);
  const saved=await page.evaluate(()=>JSON.stringify(Object.values((window.__DB||{}).users||{}).map(u=>u.ui_prefs||null).filter(Boolean)));
  await L.go(page,'home'); await page.waitForTimeout(400); await L.go(page,'sales-desk'); await page.waitForSelector('#sd-table'); await page.waitForTimeout(700);
  const kept=await page.evaluate(()=>({pressed:document.querySelector('#sd-view-compact')?.getAttribute('aria-pressed'),
    supplierCols:document.querySelectorAll('#sd-table thead th[data-col="mouser_price"],#sd-table thead th[data-col="farnell_stock"]').length,
    chips:[...document.querySelectorAll('#sd-tbody .sd-cost-src')].map(e=>e.textContent.trim())}));
  console.log('compact saved', saved, 'after revisit', JSON.stringify(kept));
  if(kept.pressed!=='true' || kept.supplierCols!==0) throw new Error('Compact view not kept');
  await page.evaluate(()=>{ window.scrollTo(0,0); const f=document.getElementById('btn-support-fab'); if(f) f.style.visibility='hidden';
    const th=document.querySelector('#sd-table thead th[data-col="total"]');
    let w=th; while(w && w!==document.body && !(w.scrollWidth>w.clientWidth+2 && getComputedStyle(w).overflowX!=='visible')) w=w.parentElement;
    if(w && w!==document.body) w.scrollLeft=Math.max(0, th.offsetLeft+th.offsetWidth-w.clientWidth+90); });
  await page.waitForTimeout(300);
  await L.mark(page,['.sd-view-toggle',{sel:'#sd-table thead th[data-col="total"]',pad:2},{sel:'#sd-tbody .sd-cost-src',idx:1,pad:3,at:'right'}]);
  await L.shot(page,'17c-sd-compact',{x:0,y:0,width:1200,height:520});
  await L.unmark(page);
  await page.evaluate(()=>{ const f=document.getElementById('btn-support-fab'); if(f) f.style.visibility=''; });
  await page.click('#sd-view-full'); await page.waitForTimeout(500);
  // The Excel quotation for the same 50 cables — rendered to an image by excel_shot.py.
  { const [dl]=await Promise.all([page.waitForEvent('download'), page.click('#btn-sd-export')]);
    await dl.saveAs(require('path').join(__dirname,'.quote.xlsx')); console.log('saved .quote.xlsx'); }
  await page.click('#btn-sd-addpick'); await page.waitForTimeout(700);
  const chk=await page.$$('.modal tbody input[type=checkbox]'); if(chk[0]) await chk[0].click(); if(chk[6]) await chk[6].click();
  await L.mark(page,[{sel:'.modal select',idx:0},{sel:'.modal input.search-box, .modal input[placeholder*="Search"]',idx:0},{sel:'.modal tbody input[type=checkbox]',idx:0,pad:5},{sel:'.modal input[type=number]',idx:0},'#pp-add']);
  await L.shot(page,'19-sd-picker','.modal');
  console.log('errors',errs);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
