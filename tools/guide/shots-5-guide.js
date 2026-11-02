const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1440,h:860});
  await L.signIn(page);
  await page.click('.home-btn-guide'); await page.waitForSelector('.gd-body .gd-h1'); await page.waitForTimeout(1500);
  await L.mark(page,['.gd-search',{sel:'#gd-toc-list',pad:4},'#btn-gd-print']);
  await L.shot(page,'52-guide');
  await page.click('#gd-toc-list a >> nth=4'); await page.waitForTimeout(1200);
  
  await page.fill('#gd-search','TBC'); await page.waitForTimeout(500);
  
  console.log('errors',errs);
  await b.close();
})();
