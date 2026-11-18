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
// The drawing(s) the work in progress is about. The screen doing it sets them
// (a drawing being imported, the rows being priced or saved) and every log
// entry written meanwhile carries them in its details as "drawing" — so Admin >
// Logs shows which drawing each AI call, price check or save was for. An entry
// that names its drawing itself keeps its own; account / user / screen entries
// never get one.
let _logDrawings=[];
export function setLogDrawing(d){
  _logDrawings=[...new Set((Array.isArray(d)?d:[d]).map(x=>String(x||'').trim()).filter(Boolean))];
}
export function logDrawingsOf(rows){
  return [...new Set((rows||[]).map(r=>String((r&&r.drawing_number)||'').trim()).filter(Boolean))];
}
const _NO_DRAWING_RE=/^(login|logout|screen_open|user_|role|roles_|ticket|support_|ai_key|distributor_api|password|customer_|rfq_(created|deleted)|database_trash_days|fc_fields|mfg_deleted)/;
export function _withDrawing(action, details){
  if(!_logDrawings.length || _NO_DRAWING_RE.test(String(action||''))) return details;
  const drawing=_logDrawings.length>6 ? `${_logDrawings.slice(0,6).join(', ')} +${_logDrawings.length-6}` : _logDrawings.join(', ');
  if(details==null || details==='') return {drawing};
  if(typeof details==='string') return {drawing, note:details};
  if(typeof details==='object' && !Array.isArray(details)){
    if(details.drawing || details.drawing_number) return details;
    return {drawing, ...details};
  }
  return details;
}
export async function logAudit(action, details, success=true){
  if(!companyId) return; // no company context yet (e.g. very first load) — nothing to attribute this to
  try{
    await addAuditEntry({
      user: S.currentUserEmail||'', userId: auth.currentUser?.uid||'',
      action, details: (d=>d==null?'':d)(_withDrawing(action, details)), success: !!success,
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
      action, details: (d=>d==null?'':d)(_withDrawing(action, details)), success: !!success,
    });
  }catch(e){ console.warn('[Audit] system log failed:', e.message); }
}
