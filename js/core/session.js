import { S } from './state.js';
import { auth, signOut } from './firebase.js';
import { esc, mkEl } from './ui.js';
import { getCompany, getUserProfile, listCompanies } from '../data/company.js';
import { _psTrashDaysOf } from '../data/parts.js';

// ── State ─────────────────────────────────────────────────────────────────────
export let companyId   = '';
export let companyName = '';
export let currentUserRole = '';

// ── Company ───────────────────────────────────────────────────────────────────
export async function initCompany(user) {
  try {
    const uData = await getUserProfile(user.uid);
    if (uData.disabled === true) {
      await signOut(auth);
      const err = new Error('This account has been disabled. Contact your administrator.');
      err.isDisabled = true;
      throw err;
    }
    companyId = uData.company_id || '';
    currentUserRole = uData.role || '';
    if (!companyId) {
      const companies = await listCompanies();
      if (companies.length === 1) companyId = companies[0].id;
      else if (companies.length > 1) companyId = await pickCompany(companies);
    }
    if (companyId) {
      const cData = await getCompany(companyId);
      companyName = cData.name || companyId;
      // The company document is a fallback, not an override: a key saved in
      // Admin (localStorage) must not be wiped by a company doc that has none.
      // Once the key is on the server (S.aiProxy) the browser never holds one.
      S.anthKey   = S.aiProxy ? '' : (S.anthKey || cData.anthropic_key || '');
      S._sdLaborRateMin = parseFloat(cData.labor_rate_min) || 0.5;
      S.companyLogoB64 = cData.logo_b64 || '';
      S._psTrashDays = _psTrashDaysOf(cData.trash_days);
    }
  } catch(e) { console.error('initCompany', e); if (e.isDisabled) throw e; }
}
export function pickCompany(docs) {
  return new Promise(resolve => {
    const bg = mkEl('div','modal-bg');
    bg.innerHTML = `<div class="modal modal-sm"><div class="modal-head"><h3>Select Company</h3></div>
      <div class="modal-body">${docs.map(d=>`<div class="rfq-card" data-id="${d.id}" style="margin-bottom:8px">
        <div class="rfq-card-icon">🏢</div><div class="rfq-card-body"><h3>${esc(d.data.name||d.id)}</h3></div>
      </div>`).join('')}</div></div>`;
    bg.querySelectorAll('.rfq-card').forEach(el=>el.addEventListener('click',()=>{
      document.body.removeChild(bg); resolve(el.dataset.id);
    }));
    document.body.appendChild(bg);
  });
}
