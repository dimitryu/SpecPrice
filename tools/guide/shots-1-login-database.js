const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1100,h:700});
  await page.goto(L.BASE+'/index.html'); await page.waitForTimeout(500);
  await page.fill('#email','dana.cohen@demo-co.com'); await page.fill('#pw','password1');
  await L.mark(page,[{sel:'#email',at:'right'},{sel:'#pw',at:'right'},{sel:'#btn',at:'right'}]);
  await L.shot(page,'01-login','.card');
  await b.close();

  ({b,page,errs}=await L.open({w:1440,h:800}));
  await L.signIn(page);
  await L.mark(page,['.home-btn-grid',{sel:'.home-btn-guide',pad:3},'#btn-check-version-top','#btn-support-fab','#btn-home-signout']);
  await L.shot(page,'02-home');
  await b.close();

  ({b,page,errs}=await L.open({w:1880,h:900}));
  await L.signIn(page);
  await L.go(page,'part-stock'); await page.waitForSelector('#ps-table');
  { const o=await L.open({w:1000,h:700}); await L.signIn(o.page); await L.go(o.page,'part-stock'); await o.page.waitForSelector('#ps-table');
    await L.mark(o.page,['#ps-search','#ps-page-size','#btn-ps-refresh','#btn-ps-fc','#btn-ps-import','#btn-ps-export','#btn-ps-delsel','#btn-ps-trash','.count-badge']);
    const tb=await (await o.page.$('.toolbar')).boundingBox();
    await L.shot(o.page,'03-db-toolbar',{x:0,y:0,width:1000,height:tb.y+tb.height+16}); await o.b.close(); }
  await L.mark(page,[{sel:'#ps-table thead',pad:2},{sel:'.price-green',idx:1,pad:4},{sel:'.price-red',idx:1,pad:4},{sel:'.ps-stock-toggle',idx:1,pad:6},{sel:'#ps-table tbody tr td:nth-child(3)',idx:4,pad:2}]);
  await L.shot(page,'04-db-table',{x:0,y:70,width:1500,height:460});
  // check price modal on 4 selected rows
  for(const i of [2,5,7,12]) await page.click(`.ps-check >> nth=${i}`);
  await page.click('#btn-ps-fc'); await page.waitForTimeout(2500);
  await L.mark(page,['#fc-res-table thead','#fc-summary','#btn-fc-stop']);
  await L.shot(page,'05-check-price','.modal');
  await page.click('#fc-close-x'); await page.waitForTimeout(800);
  // import chooser
  await page.click('#btn-ps-import'); await page.waitForTimeout(400);
  await L.mark(page,['#import-data-priority','#import-data-tools']);
  await L.shot(page,'06-import-choose','.modal');
  await page.click('#import-data-priority'); await page.waitForTimeout(400);
  await page.setInputFiles('#pi-file-input',L.A('priority-demo.xlsx')); await page.waitForTimeout(1500);
  await L.shot(page,'07-import-map','.modal');
  await page.click('#pi-map-continue').catch(()=>{}); await page.waitForSelector('#pi-save',{timeout:20000});
  await L.mark(page,['#pi-save']);
  await L.shot(page,'08-import-review','.modal');
  await page.evaluate(()=>closeModal());
  await page.waitForTimeout(300);
  await page.click('#btn-ps-trash'); await page.waitForTimeout(500);
  await L.mark(page,['#trash-days',{sel:'.trash-check',idx:0,pad:5},'#trash-restore','#trash-purge']);
  await L.shot(page,'09-trash','.modal');
  console.log('errors',errs);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
