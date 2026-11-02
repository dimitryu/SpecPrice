const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1440,h:860,aiDelay:3000});
  await L.signIn(page);
  await L.go(page,'cut-strip'); await page.waitForSelector('#btn-cs-new');
  await L.mark(page,['#btn-cs-new']);
  await L.shot(page,'20-cs-empty',{x:0,y:0,width:1440,height:420});
  await page.click('#btn-cs-new'); await page.waitForTimeout(400);
  await L.mark(page,['#cs-drop-zone']);
  await L.shot(page,'21-cs-new','.modal');
  await page.setInputFiles('#cs-file-input',L.A('DEMO-100-01.pdf'));
  await page.waitForTimeout(1500);
  await L.shot(page,'22-cs-progress','.modal');
  await page.waitForSelector('#cs-sheet',{timeout:120000}); await page.waitForTimeout(4500);
  await L.mark(page,[{sel:'#topbar-actions > span',pad:3},'#btn-cs-edit','#btn-cs-print','#btn-cs-pdf','#btn-cs-back']);
  await L.shot(page,'23-cs-sheet-top');
  // full sheet sections
  const h2s=await page.$$('#cs-sheet .cs-h2');
  console.log('sections',h2s.length);
  const names=['24-cs-s1','25-cs-s2','26-cs-s3','27-cs-s4','28-cs-s5','29-cs-s6','30-cs-s7'];
  for(let i=0;i<h2s.length && i<7;i++){
    await h2s[i].evaluate(e=>e.scrollIntoView({block:'start'}));
    await page.evaluate(()=>window.scrollBy(0,-10));
    await page.waitForTimeout(300);
    await L.shot(page,names[i],await L.sheetClip(page));
  }
  // TBC example
  const tbc=await page.$('.cs-tbc');
  if(tbc){ await tbc.evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(300); await L.mark(page,[{sel:'.cs-tbc',pad:3}]); await L.shot(page,'31-cs-tbc',await L.sheetClip(page)); }
  // edit mode
  await page.evaluate(()=>document.querySelector('#content').scrollTo(0,0)); await page.evaluate(()=>window.scrollTo(0,0));
  await page.click('#btn-cs-edit'); await page.waitForTimeout(800);
  await L.mark(page,['#btn-cs-save','#btn-cs-cancel',{sel:'#cs-sheet input, #cs-sheet [contenteditable="true"]',idx:2,pad:3}]);
  await L.shot(page,'32-cs-edit');
  await page.click('#btn-cs-save'); await page.waitForTimeout(1200);
  // language HE / RU buttons
  await page.click('#btn-cs-back'); await page.waitForTimeout(4000);
  await L.mark(page,['#cs-search',{sel:'#cs-list-head',pad:2},{sel:'.cs-open',idx:0},{sel:'.cs-del',idx:0}]);
  await L.shot(page,'33-cs-list',{x:0,y:0,width:1440,height:300});
  console.log('errors',errs);
  // keep DB for manufacturing
  const db=await page.evaluate(()=>JSON.stringify(window.__DB['companies/c1/cut_strip_specs']));
  require('fs').writeFileSync(require('path').join(__dirname,'.specs-db.json'),db);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
