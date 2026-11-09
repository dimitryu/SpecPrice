const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1200,h:760,aiDelay:900});
  await L.signIn(page);
  await L.go(page,'sales-desk'); await page.waitForSelector('#btn-sd-file');
  await L.mark(page,['#btn-sd-addpick','#btn-sd-file','#btn-sd-newrow','#btn-sd-fc','#btn-sd-labor','#btn-sd-clear','#sd-summary-host','#btn-sd-export']);
  await L.shot(page,'10-sd-empty',{x:0,y:0,width:1200,height:330});
  await page.click('#btn-sd-file'); await page.waitForTimeout(400);
  await L.mark(page,['#sd-drop-zone']);
  await L.shot(page,'11-sd-newdrawing','.modal');
  await page.setInputFiles('#sd-file-input',L.A('DEMO-100-01.pdf'));
  await page.waitForTimeout(1600);
  await L.shot(page,'12-sd-analysing','.modal');
  await page.waitForSelector('#btn-save-bom',{timeout:90000}); await page.waitForTimeout(600);
  await page.setViewportSize({width:1500,height:860}); await page.waitForTimeout(500);
  await L.mark(page,[{sel:'#preview-tbody tr',idx:5,pad:2},{sel:'#preview-tbody .btn-red',idx:0},'#btn-save-bom']);
  await L.shot(page,'13-sd-preview','.modal');
  await page.setViewportSize({width:1200,height:760}); await page.waitForTimeout(300);
  await page.click('#btn-save-bom');
  await page.waitForTimeout(7000);
  await L.mark(page,['#sd-search',{sel:'#sd-tbody tr:nth-child(7) td:nth-child(4)',pad:2},'.sd-in-units','.sd-in-tools',{sel:'.sd-btn-breakdown',pad:3},{sel:'.sd-in-minutes',at:'right'},'.sd-in-rate','.sd-in-profit','.summary-total']);
  await L.shot(page,'14-sd-loaded',{x:0,y:0,width:1200,height:560});
  const notes=await page.$('#sd-notes-panel'); 
  if(notes && await notes.isVisible()){ await L.mark(page,['#sd-notes-panel']); await L.shot(page,'14b-sd-notes','#sd-notes-panel'); }
  await page.click('.sd-btn-breakdown'); await page.waitForTimeout(800);
  await L.shot(page,'15-sd-labor','.modal');
  await page.evaluate(()=>closeModal()); await page.waitForTimeout(300);
  await page.click('#btn-sd-fc'); await page.waitForTimeout(500);
  await L.mark(page,['.su-units']);
  await L.shot(page,'16-sd-units','.modal');
  await page.fill('.su-units','50'); await page.click('#su-go');
  await page.waitForTimeout(3500);
  await page.click('#fc-close-x').catch(()=>{}); await page.waitForTimeout(1500);
  await L.mark(page,[{sel:'#sd-table thead th[data-col="mouser_price"]',pad:2},'.summary-total','.summary-order','#btn-sd-export']);
  await L.shot(page,'17-sd-priced',{x:0,y:0,width:1200,height:620});
  // tools warning close-up
  const warn=await page.$('text=Final price does NOT include');
  if(warn){ await L.mark(page,[{sel:'.sd-tool-jump',pad:3,at:'bottom'},{sel:'.sd-tool-jump + a',pad:3,at:'right'}]); await L.shot(page,'18-sd-summary','#sd-summary-host'); }
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
