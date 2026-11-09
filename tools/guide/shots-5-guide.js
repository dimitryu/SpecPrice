const L=require('./lib.js');
(async()=>{
  let {b,page,errs}=await L.open({w:1440,h:860});
  await L.signIn(page);
  await page.click('.home-btn-guide'); await page.waitForSelector('.gd-body .gd-h1'); await page.waitForTimeout(1500);
  // "progress bar": the 5th place found is a short paragraph in chapter 5, a clear example of the current hit
  await page.fill('#gd-search','פס התקדמות'); await page.waitForTimeout(700);
  const k=await page.evaluate(()=>[...document.querySelectorAll('.gd-res-list li')].findIndex(li=>/^Sales Desk/.test(li.innerText)));
  await page.click(`.gd-res-list li >> nth=${k}`); await page.waitForTimeout(3200);
  await L.mark(page,['.gd-search',{sel:'.gd-res-list',pad:3},{sel:'.gd-res-nav',pad:3},{sel:'#gd-toc-list a[data-id="database"]',pad:2,at:'right'},
                     {sel:'.gd-blk-on',pad:8,at:'right'},'#btn-gd-print']);
  await L.shot(page,'52-guide');
  console.log('errors',errs);
  await b.close();
})();
