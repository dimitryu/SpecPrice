const L=require('./lib.js');
const fs=require('fs');
const specs=fs.readFileSync(require('path').join(__dirname,'.specs-db.json'),'utf8');
const INIT=`window.__DB['companies/c1/cut_strip_specs']=(()=>{const o=${specs}; for(const k in o){ const v=o[k]; if(v.updatedAt&&!v.updatedAt.toDate){ v.updatedAt={toDate:()=>new Date(${L.NOW}-86400000),toMillis:()=>${L.NOW}-86400000}; } } return o;})();`;
(async()=>{
  let {b,page,errs}=await L.open({w:1100,h:800,init:INIT,aiDelay:400});
  await L.signIn(page);
  // Manufacturing
  await L.go(page,'manufacturing'); await page.waitForSelector('#btn-mfg-new');
  await L.mark(page,['#btn-mfg-new','#btn-mfg-from-cs']);
  await L.shot(page,'34-mfg-empty',{x:0,y:0,width:1100,height:420});
  await page.click('#btn-mfg-from-cs'); await page.waitForSelector('.mfg-imp');
  await L.mark(page,[{sel:'.mfg-imp',idx:0}]);
  await L.shot(page,'35-mfg-from-cs','.modal');
  await page.click('.mfg-imp'); await page.waitForTimeout(4500);
  await L.mark(page,['#btn-mfg-save','#btn-mfg-cancel',{sel:'.cs-del',idx:0,pad:3}]);
  await L.shot(page,'36-mfg-edit');
  // scroll to steps
  const h=await page.$$('.cs-h2'); if(h[2]){ await h[2].evaluate(e=>e.scrollIntoView({block:'start'})); await page.waitForTimeout(300); await L.shot(page,'37-mfg-steps',await L.sheetClip(page)); }
  await page.evaluate(()=>window.scrollTo(0,0)); await page.evaluate(()=>document.querySelector('#content')?.scrollTo(0,0));
  await page.click('#btn-mfg-save'); await page.waitForTimeout(3500);
  await L.mark(page,[{sel:'#topbar-actions > span',pad:3},'#btn-mfg-edit','#btn-mfg-print','#btn-mfg-back']);
  await L.shot(page,'38-mfg-doc');
  await page.click('#btn-mfg-back'); await page.waitForTimeout(3500);
  await L.mark(page,['#mfg-search',{sel:'table tbody tr',idx:0,pad:2}]);
  await L.shot(page,'39-mfg-list',{x:0,y:0,width:1100,height:300});
  // Statistics
  await L.go(page,'statistics'); await page.waitForTimeout(2500);
  await L.mark(page,[{sel:'.stat-preset',idx:1},'#stat-from','#stat-apply','#stat-export-all',{sel:'.stat-export',idx:0}]);
  await L.shot(page,'40-stats');
  // Settings
  await L.go(page,'settings'); await page.waitForTimeout(1500);
  let P=await L.panel(page,'#inp-labor-rate');
  await L.mark(page,['#inp-labor-rate','#btn-save-settings']);
  await L.shot(page,'41-settings-top',P);
  P=await L.panel(page,'#stg-logo-body'); await L.shot(page,'41b-settings-logo',P);
  P=await L.panel(page,'#stg-users-body');
  await L.mark(page,['#btn-invite-user',{sel:'.stg-edit-user',idx:1}]);
  await L.shot(page,'42-settings-users',P);
  await page.click('#btn-invite-user'); await page.waitForTimeout(400);
  await L.shot(page,'43-invite','.modal');
  await page.click('#modal-cancel'); await page.waitForTimeout(300);
  await page.click('.stg-edit-user >> nth=1'); await page.waitForTimeout(400);
  await L.mark(page,[{sel:'.modal select',idx:0},{sel:'.modal input[type=checkbox]',idx:0,pad:4},'#btn-edu-pwreset','#btn-edu-delete','#btn-edu-save']);
  await L.shot(page,'44-edit-user','.modal');
  await page.click('#modal-cancel'); await page.waitForTimeout(300);
  { const o=await L.open({w:1500,h:800}); await L.signIn(o.page); await L.go(o.page,'settings'); await o.page.waitForTimeout(1500);
    const Q=await L.panel(o.page,'#stg-roles-body');
    await L.mark(o.page,['#btn-new-role',{sel:'.role-name-inp',idx:1},{sel:'.role-view-sel',idx:10},{sel:'.role-save',idx:1},{sel:'.role-del',idx:0}]);
    await L.shot(o.page,'45-settings-roles',Q); await o.b.close(); }
  // Admin
  await L.go(page,'admin'); await page.waitForTimeout(2000);
  P=await L.panel(page,'#adm-ai-status');
  await L.mark(page,['#adm-ai-status','#adm-anth-key','#btn-adm-save-keys','#btn-adm-test-ai']);
  await L.shot(page,'46-admin-ai',P);
  P=await L.panel(page,'#adm-dist-status');
  await L.mark(page,['#adm-dist-status','#adm-mouser-key','#btn-adm-save-dist','#btn-adm-test-dist']);
  await L.shot(page,'47-admin-dist',P);
  P=await L.panel(page,'#adm-tickets-body');
  await L.mark(page,[{sel:'#adm-tickets-body select',idx:0},{sel:'#adm-tickets-body select',idx:1},{sel:'#adm-tickets-body tbody tr',idx:2,pad:1},{sel:'#adm-tickets-body tbody select',idx:0},{sel:'#adm-tickets-body tbody button',idx:0}]);
  await L.shot(page,'48-admin-tickets',P);
  await page.click('#adm-tickets-body tbody button >> nth=0').catch(()=>{}); await page.waitForTimeout(700);
  await L.shot(page,'48b-admin-ticket-open','.modal'); await page.evaluate(()=>closeModal()); await page.waitForTimeout(400);
  P=await L.panel(page,'#adm-logs-body');
  await L.mark(page,[{sel:'#adm-logs-body input',idx:0},{sel:'#adm-logs-body tbody tr',idx:3,pad:1}]);
  await L.shot(page,'49-admin-logs',P);
  P=await L.panel(page,'#adm-prompts-body'); await L.shot(page,'49b-admin-prompts',P);
  console.log('errors',errs);
  await b.close();

  // Support as a regular (sales) user
  ({b,page,errs}=await L.open({w:1440,h:860}));
  await L.signIn(page,'u2','avi.levi@demo-co.com');
  await L.mark(page,['.home-btn-grid']);
  await L.shot(page,'50-home-sales',{x:320,y:60,width:800,height:620});
  await page.click('#btn-support-fab'); await page.waitForTimeout(1500);
  await page.fill('#support-new-msg','The labor time for DEMO-220-03 looks too high — can you check?');
  await L.mark(page,[{sel:'#support-modal-body',pad:2},'#support-new-msg','#support-new-files','#btn-support-send']);
  await L.shot(page,'51-support','.modal');
  console.log('errors',errs);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
