import { S } from './state.js';
import { auth } from './firebase.js';
import { companyId } from './session.js';
import { addAuditEntry } from '../data/audit.js';

// ── Audit log ─────────────────────────────────────────────────────────────────
// A single, append-only trail of who did what and whether it worked — read by
// Admin > Logs (see renderAdminPage). Fire-and-forget: a logging failure must
// never block or surface an error for the actual user action it's describing,
// so every call is wrapped in try/catch with only a console warning on failure.
// `details` can be a string or a plain object (stored as-is, rendered with
// JSON.stringify by the Logs tab when it's an object).
export async function logAudit(action, details, success=true){
  if(!companyId) return; // no company context yet (e.g. very first load) — nothing to attribute this to
  try{
    await addAuditEntry({
      user: S.currentUserEmail||'', userId: auth.currentUser?.uid||'',
      action, details: details==null?'':details, success: !!success,
    });
  }catch(e){ console.warn('[Audit] log failed:', e.message); }
}
// Same trail as logAudit(), but for automated operations the app runs on its own
// behalf (FindChips/Priority price searches, AI drawing/BOM price analysis) rather
// than a direct manual user action — these are attributed to "SYSTEM" in the User
// column so Admin > Logs can tell "I clicked X" apart from "the app computed Y".
// Still records which human's session triggered it (viaUser) for traceability.
export async function logSystemAudit(action, details, success=true){
  if(!companyId) return;
  try{
    await addAuditEntry({
      user: 'SYSTEM', userId: 'system', viaUser: S.currentUserEmail||'',
      action, details: details==null?'':details, success: !!success,
    });
  }catch(e){ console.warn('[Audit] system log failed:', e.message); }
}
