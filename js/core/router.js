import { S } from './state.js';
import { logAudit } from './audit.js';
import { auth, signOut } from './firebase.js';
import { allowedViews, canView, disabledViews } from './roles.js';
import { companyName, currentUserRole } from './session.js';
import { esc, setActions, setContent } from './ui.js';
import { APP_VER } from './version.js';
import { renderAdminPage } from '../features/admin.js';
import { renderCustomers } from '../features/customers.js';
import { renderCutStrip } from '../features/cutstrip/list.js';
import { renderPartStock } from '../features/database.js';
import { renderManufacturing } from '../features/manufacturing.js';
import { renderRFQList } from '../features/rfq.js';
import { renderSalesDesk } from '../features/salesDesk/salesDesk.js';
import { renderSettingsPage } from '../features/settings.js';
import { renderStatisticsPage } from '../features/statistics.js';
import { _supRenderBadges } from '../features/support.js';

// ── Router ────────────────────────────────────────────────────────────────────
// There's no persistent sidebar — the Home screen (role-gated button grid) is
// the hub. Every other screen shows a 🏠 button in the topbar to get back.
export function route(v){
  const target = v||'home';
  if(!canView(target)){
    if(target!=='home') logAudit('screen_open',{screen:target},false); // blocked by role — logged as a failed attempt
    route('home'); return;
  }
  S.currentView=target;
  const btnHome=document.getElementById('btn-home');
  if(btnHome) btnHome.style.display = S.currentView==='home' ? 'none' : 'inline-flex';
  const TITLES={'home':'🏠 Home','part-stock':'📦 Database','rfq':'📋 RFQ','sales-desk':'💰 Sales Desk','cut-strip':'✂️ Cut & Strip','customers':'👥 Customers','manufacturing':'🛠️ Manufacturing Instructions','statistics':'📊 Statistics','settings':'⚙️ Settings','admin':'🛡️ Admin'};
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
  'rfq':         ['📋',"RFQ's"],
  'sales-desk':  ['💰','Sales Desk'],
  'part-stock':  ['📦','Database'],
  'cut-strip':   ['✂️','Cut &amp; Strip'],
  'customers':   ['👥','Customers'],
  'manufacturing':['🛠️','Manufacturing'],
  'statistics':  ['📊','Statistics'],
  'settings':    ['⚙️','Settings'],
  'admin':       ['🛡️','Admin'],
};
export function _logoHTML(){
  return S.companyLogoB64
    ? `<img src="${S.companyLogoB64}" style="max-width:100%;max-height:100%;object-fit:contain">`
    : `<span style="font-size:26px;color:#607D8B">🏢</span>`;
}
export function renderHome(){
  setActions('');
  const views = allowedViews();
  setContent(`
    <div style="max-width:640px;margin:20px auto;text-align:center">
      <div style="width:120px;height:80px;margin:0 auto 12px;display:flex;align-items:center;justify-content:center">${_logoHTML()}</div>
      <h1 style="font-size:19px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">${esc(companyName)}</h1>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${esc(S.currentUserEmail)}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:28px">${esc(currentUserRole||'—')}</div>
      <div class="home-btn-grid">
        ${(()=>{
          // Disabled buttons are pushed to the end so the working ones stay
          // together at the front — a greyed tile in the middle of the grid
          // breaks the scan for the button someone actually came to press.
          const off=new Set(disabledViews());
          const ordered=[...views.filter(v=>!off.has(v)), ...views.filter(v=>off.has(v))];
          return ordered.map(v=>{
            const [icon,label]=HOME_BUTTONS[v]||['❓',v];
            const dis=off.has(v);
            return `<button class="home-btn${dis?' home-btn-off':''}" data-view="${v}"${dis?' disabled aria-disabled="true" title="This screen is turned off for your role"':''}>`
                 + `<span class="home-btn-icon">${icon}</span><span>${label}</span></button>`;
          }).join('');
        })()}
      </div>
      <button class="btn btn-ghost" id="btn-home-signout" style="margin-top:36px">Sign Out</button>
      <div style="margin-top:10px;font-size:10px;color:#94A3B8">v${APP_VER}</div>
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
