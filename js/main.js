import { S } from './core/state.js';
import { aiProbeProxy } from './ai/client.js';
import { logAudit } from './core/audit.js';
import { auth, onAuthStateChanged } from './core/firebase.js';
import { loadRoles } from './core/roles.js';
import { route } from './core/router.js';
import { currentUserRole, initCompany } from './core/session.js';
import { closeModal, esc, splashErr, splashMsg } from './core/ui.js';
import { APP_VER, autoCheckForUpdate, checkForUpdate } from './core/version.js';
import { _supStartBadgePolling, openSupportModal } from './features/support.js';

try{ localStorage.removeItem('gem_key'); }catch{}   // left over from the Gemini era

// ── PDF.js ────────────────────────────────────────────────────────────────────
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Catch uncaught errors and show on splash
window.addEventListener('unhandledrejection', e => splashErr('Error: ' + String(e.reason)));
window.addEventListener('error', e => splashErr('Error: ' + e.message));

// Timeout if Firebase never responds (likely: domain not authorized)
export const _authTimeout = setTimeout(() => {
  splashErr('Could not connect.\n\nIf this is your first time: go to Firebase Console → Authentication → Settings → Authorized Domains → Add "dimitryu.github.io"');
}, 8000);

onAuthStateChanged(auth, async user => {
  clearTimeout(_authTimeout);
  if (!user) { location.href = 'index.html'; return; }
  splashMsg('Loading company data…');
  S.currentUserEmail = user.email || '';
  try {
    await initCompany(user);
    await loadRoles();
    // Not awaited: it only decides which road AI requests take, and the last
    // known answer is already in place from the previous visit.
    aiProbeProxy();
  } catch(e) { splashErr(e.isDisabled ? e.message : ('Company load error: ' + e.message)); return; }
  document.getElementById('splash').style.display = 'none';
  document.getElementById('shell').style.display = 'flex';
  const infoEl = document.getElementById('topbar-info');
  // The version sits next to the signed-in user on every screen, and doubles as
  // the update check — the place people already look to answer "what am I
  // running?" is the place to answer "is it current?". It was on the Home
  // screen only, in 10px grey, where nobody found it.
  if (infoEl){
    infoEl.innerHTML = `<span>👤 ${esc(S.currentUserEmail)}</span><span style="color:#CBD5E1">|</span>`
      + `<button class="btn btn-ghost btn-sm" id="btn-check-version-top" `
      + `title="Check for a newer version">↻ v${APP_VER}</button>`;
    document.getElementById('btn-check-version-top')
      ?.addEventListener('click',e=>checkForUpdate(e.currentTarget));
  }
  logAudit('login', {role: currentUserRole}, true);
  route('home');
  autoCheckForUpdate();   // silent unless there's something to update
  _supStartBadgePolling();   // Support markers, on every screen
});
window.closeModal=closeModal;
document.getElementById('btn-home')?.addEventListener('click',()=>route('home'));
document.getElementById('btn-support-fab')?.addEventListener('click',()=>openSupportModal());
// Delegated so it works for BOTH drop-zone modals (RFQ + Sales Desk), which
// are built fresh each time they're opened.
document.addEventListener('change',e=>{
});
