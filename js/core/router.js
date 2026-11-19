import { S } from './state.js';
import { logAudit } from './audit.js';
import { auth, signOut } from './firebase.js';
import { icon } from './icons.js';
import { allowedViews, canView, disabledViews, isReadOnlyUser } from './roles.js';
import { companyName, currentUserRole } from './session.js';
import { esc, setActions, setContent } from './ui.js';
import { APP_VER } from './version.js';
import { renderAdminPage } from '../features/admin.js';
import { renderCustomers } from '../features/customers.js';
import { renderCutStrip } from '../features/cutstrip/list.js';
import { renderPartStock } from '../features/database.js';
import { renderGuide } from '../features/guide.js';
import { renderManufacturing } from '../features/manufacturing.js';
import { renderRFQList } from '../features/rfq.js';
import { renderSalesDesk } from '../features/salesDesk/salesDesk.js';
import { renderSettingsPage } from '../features/settings.js';
import { renderStatisticsPage } from '../features/statistics.js';
import { _supRenderBadges } from '../features/support.js';

// ── Router ────────────────────────────────────────────────────────────────────
// There's no persistent sidebar — the Home screen (role-gated button grid) is
// the hub. Every other screen shows a 🏠 button in the topbar to get back.
// opts.force skips the current screen's leave guard (S._leaveGuard) — the
// guard itself uses it once the user has answered its question.
export function route(v, opts={}){
  const target = v||'home';
  if(!opts.force && typeof S._leaveGuard==='function' && target!==S.currentView){
    if(S._leaveGuard(target)===false) return;
  }
  if(target!==S.currentView) S._leaveGuard=null;
  if(!canView(target)){
    if(target!=='home') logAudit('screen_open',{screen:target},false); // blocked by role — logged as a failed attempt
    route('home'); return;
  }
  S.currentView=target;
  document.body.classList.toggle('read-only', isReadOnlyUser());
  const btnHome=document.getElementById('btn-home');
  if(btnHome) btnHome.style.display = S.currentView==='home' ? 'none' : 'inline-flex';
  document.body.dataset.view=S.currentView;
  const TITLES={'home':'','part-stock':'Database','rfq':'RFQ','sales-desk':'Sales Desk','cut-strip':'Cut & Strip','customers':'Customers','manufacturing':'Manufacturing Instructions','statistics':'Statistics','settings':'Settings','admin':'Admin','guide':'User Guide'};
  document.getElementById('page-title').textContent=TITLES[S.currentView]||'';
  setActions('');
  if(S.currentView!=='home') logAudit('screen_open',{screen:S.currentView},true);
  if(S.currentView==='home') renderHome();
  else if(S.currentView==='part-stock'){
    // Navigating to Part Stock always refetches from Firestore, so parts added
    // on other screens (Add Drawing extraction, Priority Import, etc.) show up
    // immediately without needing a full page reload. Same-screen interactions
    // (search/sort/paging) call renderPartStock() directly rather than route(),
    // so they keep reusing the in-memory cache and don't re-hit Firestore on
    // every keystroke.
    S.allParts=[];
    renderPartStock();
  }
  else if(S.currentView==='rfq') renderRFQList();
  else if(S.currentView==='sales-desk') renderSalesDesk();
  // Always lands on the saved-specs list, never on whatever spec happened to be
  // open last — a stale sheet on screen is how the wrong revision gets cut.
  else if(S.currentView==='cut-strip'){ S.csCurrent=null; renderCutStrip(); }
  else if(S.currentView==='customers') renderCustomers();
  // Always lands on the document list, never on whatever instruction happened
  // to be open last — same reasoning as Cut & Strip above.
  else if(S.currentView==='manufacturing'){ S.mfgCurrent=null; renderManufacturing(); }
  else if(S.currentView==='statistics') renderStatisticsPage();
  else if(S.currentView==='guide') renderGuide();
  else if(S.currentView==='settings'){
    if(currentUserRole!=='admin'){ route('home'); return; }
    renderSettingsPage();
  }
  else if(S.currentView==='admin'){
    if(currentUserRole!=='admin'){ route('home'); return; }
    renderAdminPage();
  }
}

// ── Home screen ───────────────────────────────────────────────────────────────
export const HOME_BUTTONS = {
  // view: [icon (core/icons.js), label, one line on what it is for, group]
  'rfq':         ['clipboard',"RFQ's",'Requests for quotation','work'],
  'sales-desk':  ['quote','Sales Desk','Drawing → priced quote','work'],
  'part-stock':  ['database','Database','Parts, prices, drawings','work'],
  'cut-strip':   ['scissors','Cut &amp; Strip','Cutting &amp; stripping sheets','work'],
  'customers':   ['users','Customers','Customer list','work'],
  'manufacturing':['wrench','Manufacturing','Work instructions','work'],
  'statistics':  ['chart','Statistics','Quotes, prices, activity','manage'],
  'settings':    ['settings','Settings','Users, roles, rates, logo','manage'],
  'admin':       ['shield','Admin','Keys, logs, support, recycle bin','manage'],
};
// The order on the Home screen: the everyday screens first.
const _HOME_ORDER=['sales-desk','part-stock','cut-strip','manufacturing','rfq','customers','statistics','settings','admin'];
// The Home band's line drawing: a harness — connector, three conductors, a
// splice, two plugs — in the copper colour, very faint.
const _HOME_HARNESS = `<svg class="harness" viewBox="300 0 900 170" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
<path d="M156 75 C 300 75 330 40 470 40 S 650 70 760 70"/><path d="M156 85 C 300 85 340 85 480 85 S 650 85 760 85"/><path d="M156 95 C 300 95 330 130 470 130 S 650 100 760 100"/>
<rect x="470" y="30" width="26" height="20" rx="3" stroke-width="1.6"/><path d="M560 60v50M574 60v50" stroke-width="1.4" stroke-dasharray="3 4"/>
<path d="M760 64h36v42h-36z"/><path d="M796 85 C 880 85 900 60 990 60"/><path d="M796 92 C 880 92 900 120 990 120"/>
<rect x="990" y="44" width="70" height="32" rx="6"/><rect x="990" y="104" width="70" height="32" rx="6"/>
<path d="M1060 52h20M1060 60h20M1060 68h20M1060 112h20M1060 120h20M1060 128h20" stroke-width="1.4"/></svg>`;
export function _logoHTML(){
  return S.companyLogoB64
    ? `<img src="${S.companyLogoB64}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">`
    : `<span style="color:var(--primary)">${icon('building',34,1.5)}</span>`;
}
export function renderHome(){
  setActions('');
  const views = allowedViews();
  // Disabled buttons are pushed to the end so the working ones stay together at
  // the front — a greyed tile in the middle of the grid breaks the scan for the
  // button someone actually came to press.
  const off=new Set(disabledViews());
  const tile=(v, first)=>{
    const [ic,label,desc]=HOME_BUTTONS[v]||['help',v,''];
    const dis=off.has(v);
    return `<button class="home-btn${dis?' home-btn-off':''}${first&&!dis?' home-btn-hero':''}" data-view="${v}"${dis?' disabled aria-disabled="true" title="This screen is turned off for your role"':''}>`
      + `<span class="home-btn-icon">${icon(ic,24,1.6)}</span><span class="home-btn-text"><b>${label}</b><small>${dis?'Turned off for your role':desc}</small></span>`
      + `<span class="home-btn-go">${icon('chevron',16,2)}</span></button>`;
  };
  const group=g=>{
    const vs=views.filter(v=>(HOME_BUTTONS[v]||[])[3]===g).sort((x,y)=>_HOME_ORDER.indexOf(x)-_HOME_ORDER.indexOf(y));
    return [...vs.filter(v=>!off.has(v)), ...vs.filter(v=>off.has(v))];
  };
  const work=group('work'), manage=group('manage');
  setContent(`
    <div class="home-wrap">
      <div class="home-band">${_HOME_HARNESS}
        <div class="home-logo">${_logoHTML()}</div>
        <div><h1>${esc(companyName)}</h1><p>${esc(S.currentUserEmail)}</p><span class="home-role">${esc(currentUserRole||'—')}</span></div>
      </div>
      ${work.length?`<div class="home-sec">Work</div><div class="home-btn-grid">${work.map((v,i)=>tile(v,i===0)).join('')}</div>`:''}
      <div class="home-sec">Manage</div>
      <div class="home-btn-grid">${manage.map(v=>tile(v,false)).join('')}`
        // The user guide is for everyone, whatever the role, so it is not one of
        // the role-controlled buttons and always comes last.
        + `<button class="home-btn home-btn-guide" data-view="guide"><span class="home-btn-icon">${icon('book',24,1.6)}</span>`
        + `<span class="home-btn-text"><b>User Guide</b><small>How to use SpecPrice</small></span><span class="home-btn-go">${icon('chevron',16,2)}</span></button>
      </div>
      <div class="home-foot"><button class="btn btn-ghost" id="btn-home-signout">Sign Out</button><span class="mono">v${APP_VER}</span></div>
    </div>`);
  document.querySelectorAll('.home-btn:not(.home-btn-off)')
    .forEach(b=>b.addEventListener('click',()=>route(b.dataset.view)));
  document.getElementById('btn-home-signout')?.addEventListener('click',
    () => logAudit('logout',null,true).finally(()=>signOut(auth).then(() => location.href = 'index.html')));
  _supRenderBadges();   // the Admin tile carries the "waiting for you" count
}
// The Home screen's buttons are role-gated, so it has to be redrawn when the
// signed-in user's own role changes underneath it.
export function renderHomeIfActive(){ if(S.currentView==='home') renderHome(); }
