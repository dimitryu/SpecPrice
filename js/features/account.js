import { S } from '../core/state.js';
import { logAudit } from '../core/audit.js';
import { EmailAuthProvider, auth, reauthenticateWithCredential, sendPasswordResetEmail, updatePassword } from '../core/firebase.js';
import { closeModal, esc, showModal, toast } from '../core/ui.js';

// ══════════════════════════════════════════════════════════════════════════════
// MY ACCOUNT — opened from the signed-in user's name in the top bar
// ------------------------------------------------------------------------------
// Changing a password needs the current one: Firebase asks for a fresh sign-in
// before a password change, and asking for it here is that sign-in. Someone who
// no longer knows it gets the reset e-mail instead, from the same window.
// ══════════════════════════════════════════════════════════════════════════════
export const _ACC_MIN_PW=6;
// Firebase error codes → a sentence a user can act on.
export function _accAuthError(e){
  const c=String(e && e.code || '');
  if(/wrong-password|invalid-credential|invalid-login-credentials/.test(c)) return 'The current password is not correct.';
  if(/weak-password/.test(c)) return `The new password is too weak — use at least ${_ACC_MIN_PW} characters.`;
  if(/too-many-requests/.test(c)) return 'Too many attempts. Wait a few minutes and try again.';
  if(/requires-recent-login/.test(c)) return 'Please sign out and sign in again, then change the password.';
  if(/network-request-failed/.test(c)) return 'No connection to the server — check the internet connection.';
  return (e && e.message) || 'Something went wrong.';
}
// What a new password must be before it is even sent. '' when it is fine.
export function _accCheckNewPassword(cur, next, again){
  if(!cur) return 'Enter your current password.';
  if(String(next||'').length<_ACC_MIN_PW) return `The new password must be at least ${_ACC_MIN_PW} characters.`;
  if(next!==again) return 'The two new passwords are not the same.';
  if(next===cur) return 'The new password must be different from the current one.';
  return '';
}

export function openAccountModal(){
  const email=S.currentUserEmail||'';
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>👤 My account</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Signed in as <strong style="color:var(--text)">${esc(email)}</strong></div>
      <div style="font-size:11px;font-weight:700;color:#4A5568;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Change password</div>
      <div class="form-field"><label>Current password</label>
        <input class="form-input" id="acc-cur" type="password" autocomplete="current-password"></div>
      <div class="form-field" style="margin-top:10px"><label>New password</label>
        <input class="form-input" id="acc-new" type="password" autocomplete="new-password" placeholder="At least ${_ACC_MIN_PW} characters"></div>
      <div class="form-field" style="margin-top:10px"><label>New password again</label>
        <input class="form-input" id="acc-new2" type="password" autocomplete="new-password"></div>
      <div id="acc-msg" role="alert" aria-live="polite" style="font-size:12px;margin-top:10px;min-height:16px"></div>
      <div style="border-top:1px solid var(--border);margin:14px 0 10px"></div>
      <div style="font-size:12px;color:var(--muted)">Forgot your current password?
        <a href="#" id="acc-reset">Send me a reset link</a> — it goes to ${esc(email)}.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" id="acc-save">🔒 Change password</button>
    </div>
  </div>`);
  const msg=(t,ok)=>{ const m=document.getElementById('acc-msg'); if(m){ m.textContent=t; m.style.color=ok?'#1B6B3A':'#E53E3E'; } };
  document.getElementById('acc-cur')?.focus();
  ['acc-cur','acc-new','acc-new2'].forEach(id=>document.getElementById(id)?.addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('acc-save')?.click(); }));

  document.getElementById('acc-save').addEventListener('click',async()=>{
    const cur=document.getElementById('acc-cur').value;
    const next=document.getElementById('acc-new').value;
    const again=document.getElementById('acc-new2').value;
    const bad=_accCheckNewPassword(cur,next,again);
    if(bad){ msg(bad,false); return; }
    const btn=document.getElementById('acc-save');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      const user=auth.currentUser;
      if(!user) throw Object.assign(new Error('Not signed in'),{code:'auth/requires-recent-login'});
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, cur));
      await updatePassword(user, next);
      logAudit('password_changed', null, true);
      closeModal();
      toast('Password changed. Use the new password next time you sign in.','success');
    }catch(e){
      msg(_accAuthError(e), false);
      logAudit('password_changed', {error:String(e && e.code || e && e.message || '')}, false);
      btn.disabled=false; btn.textContent='🔒 Change password';
    }
  });

  document.getElementById('acc-reset').addEventListener('click',async e=>{
    e.preventDefault();
    try{
      await sendPasswordResetEmail(auth, email);
      msg(`A reset link was sent to ${email}. Check your inbox (and the spam folder).`, true);
      logAudit('password_reset_requested', {from:'account'}, true);
    }catch(err){ msg(_accAuthError(err), false); }
  });
}
