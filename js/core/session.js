import { S } from './state.js';
import { auth, signOut } from './firebase.js';
import { esc, mkEl } from './ui.js';
import { clearCompanyAiKeys, getCompany, getUserProfile, listCompanies } from '../data/company.js';
import { _psTrashDaysOf } from '../data/parts.js';
import { updateUserProfile } from '../data/users.js';

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
    S.uiPrefs = (uData.ui_prefs && typeof uData.ui_prefs==='object') ? {...uData.ui_prefs} : {};
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
      // AI keys never come from the company document any more (they are on
      // the server). An admin's session removes old copies left in it — the
      // document is readable by everyone in the company.
      if (currentUserRole === 'admin' && (cData.anthropic_key || cData.gemini_key)) {
        clearCompanyAiKeys().catch(e => console.warn('[ai key] company doc cleanup:', e.message));
      }
      S._sdLaborRateMin = parseFloat(cData.labor_rate_min) || 0.5;
      S.companyLogoB64 = cData.logo_b64 || '';
      S._psTrashDays = _psTrashDaysOf(cData.trash_days);
    }
  } catch(e) { console.error('initCompany', e); if (e.isDisabled) throw e; }
}
// ── Per-user screen settings ──────────────────────────────────────────────────
// Kept on the user's own document, so the choice follows them to any computer,
// with a local copy so the screen is right even before the profile has loaded.
export function getUiPref(key, def){
  const v = S.uiPrefs && S.uiPrefs[key];
  if (v != null && v !== '') return v;
  try { const uid = auth.currentUser && auth.currentUser.uid; const l = uid && localStorage.getItem(`ui_${key}:${uid}`); if (l) return l; } catch {}
  return def;
}
export function setUiPref(key, value){
  S.uiPrefs = { ...(S.uiPrefs || {}), [key]: value };
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  try { localStorage.setItem(`ui_${key}:${uid}`, String(value)); } catch {}
  updateUserProfile(uid, { [`ui_prefs.${key}`]: value }).catch(e => console.warn('ui pref not saved:', e.message));
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
