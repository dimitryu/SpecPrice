import { S } from '../core/state.js';
import { _BOM_EXCEL_PROMPT, _BOM_TEXT_PROMPT, _BOM_TOOL_RULE_SECTION, _BOM_VISION_PROMPT } from '../ai/bom.js';
import { _csPrompt } from '../ai/cutstrip.js';
import { _cableProcessPrompt, _notesPrompt } from '../ai/process.js';
import { logAudit } from '../core/audit.js';
import { FB, auth, sendPasswordResetEmail } from '../core/firebase.js';
import { ADMIN_AUTO_VIEWS, PROTECTED_ROLE, PROTECTED_VIEWS, ROLES_META_DOC, SEED_ROLE_VIEWS, _isRoleDocId, _mergedRoleKeys, roleOptions } from '../core/roles.js';
import { HOME_BUTTONS, renderHomeIfActive } from '../core/router.js';
import { companyId, currentUserRole } from '../core/session.js';
import { closeModal, esc, setActions, setContent, showModal, toast } from '../core/ui.js';
import { updateCompany } from '../data/company.js';
import { createRole, deleteRole, listRoleDocs, markRolesSeeded, updateRole } from '../data/roles.js';
import { countUsersWithRole, createUserProfile, deleteUserProfile, listUsers, updateUserProfile } from '../data/users.js';
import { _CS_SOURCE_LANG } from './cutstrip/i18n.js';

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════════════════════════
// Full Settings page (inline in #content, not a modal) — reached via the sidebar
// "Settings" nav item. showSettingsModal() below remains a lightweight modal used
// only as a contextual prompt when a task needs an AI key that isn't configured yet.
export function renderSettingsPage(){
  setActions('');
  setContent(`
    <div class="settings-panel" style="padding:20px 22px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">Sales Desk</h3>
      <div class="form-field" style="margin-top:10px">
        <label>Labor Rate ($ / minute)</label>
        <input class="form-input" id="inp-labor-rate" type="number" min="0" step="any"
          placeholder="0.5" value="${esc(S._sdLaborRateMin)}">
        <p style="font-size:11px;color:var(--muted);margin-top:5px">Used to calculate Labor Cost in Sales Desk (Labor Total minutes × this rate).</p>
      </div>
      <div style="border-top:1px solid var(--border);margin:20px 0 16px"></div>
      <button class="btn btn-green" id="btn-save-settings">💾 Save Settings</button>
      <p style="font-size:11px;color:var(--muted);margin-top:10px">AI API keys have moved to the 🛡️ Admin screen.</p>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">Logo</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Shown on the Home screen and in the top bar.</p>
      <div id="stg-logo-body"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">Users</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Manage user accounts and roles.</p>
      <div id="stg-users-body"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">Roles</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Create new roles and control which Home-screen buttons each role can see.</p>
      <div id="stg-roles-body"></div>
    </div>`);

  document.getElementById('btn-save-settings').addEventListener('click', async()=>{
    S._sdLaborRateMin=parseFloat(document.getElementById('inp-labor-rate').value)||0;
    const btn=document.getElementById('btn-save-settings');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      if(companyId) await updateCompany({labor_rate_min:S._sdLaborRateMin});
      toast('Settings saved','success');
    }catch(e){ toast('Error saving: '+e.message,'error'); }
    btn.disabled=false; btn.textContent='💾 Save Settings';
  });

  renderSettingsLogoSection();
  renderSettingsUsersSection();
  renderSettingsRolesSection();
}

// ── AI Prompts viewer (Admin page) ───────────────────────────────────────────
// Read-only listing of every prompt the app sends to the AI, grouped by what
// it's for. Built from the SAME constants/functions the real calls use (never
// a hand-copied duplicate), so this can't drift out of date when a prompt is
// edited. The two BOM prompts take a runtime argument, so a placeholder is
// passed purely for display.
export function _aiPromptCatalog(){
  return [
    {id:'bom-text',   title:'BOM extraction — PDF text mode',
     note:'Used when the PDF has a readable text layer. Sent with the extracted page text appended.',
     text:_BOM_TEXT_PROMPT('<drawing-filename>.pdf')},
    {id:'bom-vision', title:'BOM extraction — page image (vision)',
     note:'Fallback when the PDF text layer is empty/sparse (table drawn as graphics), and for image uploads. Sent with the rendered page image.',
     text:_BOM_VISION_PROMPT},
    {id:'bom-excel',  title:'BOM extraction — Excel / CSV spreadsheet',
     note:'Used when the uploaded file is a spreadsheet (ERP/PLM BOM export). Understands hierarchical exports where only some row types are real components and vendor data sits on child rows.',
     text:_BOM_EXCEL_PROMPT('<bom-export>.xlsx')},
    {id:'tool-rule',  title:'Crimp / insertion tool detection + pricing',
     note:'Shared rule embedded inside BOTH BOM prompts above — makes the AI add a priced TOOL row for every connector that has a pin count.',
     text:_BOM_TOOL_RULE_SECTION},
    {id:'labor',      title:'Cable manufacturing process → Labor Time',
     note:'Sales Desk only. Works out the manufacturing steps and per-unit minutes behind the auto Labor Time (and the Labor Breakdown modal).',
     text:_cableProcessPrompt('0: <BOM row description> (qty=1 pc)\n1: <BOM row description> (qty=230 mm)')},
    {id:'notes',      title:'Drawing Notes / Manufacturing Instructions',
     note:'Sales Desk only. Pulls the drawing’s NOTES / GENERAL NOTES block out for the panel under the BOM table.',
     text:_notesPrompt()},
    {id:'cut-strip',  title:'Cut & Strip specification',
     note:'Cut & Strip screen. Reads a cable/harness drawing and produces the whole bench sheet: connectors, one block per cable run, cut-length calculation, strip dimensions, wiring table, operation steps, inspection list and open items. Always sent in Hebrew — English and Russian sheets are translations of this output, not separate analyses.',
     text:_csPrompt(_CS_SOURCE_LANG)},
    {id:'cut-strip-tr', title:'Cut & Strip — translation of an existing sheet',
     note:'Cut & Strip screen. Only used when someone switches a saved sheet to a language it was not generated in. Sent in chunks of 20 strings.',
     text:_csTranslatePromptSample()},
  ];
}
// The translation prompt is built inside _csTranslateChunk around a runtime
// batch. Rebuilt here from the same text with a placeholder batch, so the panel
// shows what is really sent rather than a hand-copied paraphrase.
export function _csTranslatePromptSample(){
  const langName='Hebrew';
  return `Translate each of these cable-harness shop-floor work instruction strings into ${langName}.\n`
    +'Rules:\n'
    +'- Keep part numbers, standards (IPC/WHMA-A-620, MIL-DTL-17), reference designators (P1, J1), dimension codes (A, B, C) and all units EXACTLY as they are.\n'
    +'- Keep numbers and their units unchanged (e.g. "320 mm" stays "320 mm").\n'
    +'- Technical terms a technician normally says in English (crimp, PTFE, VSWR, PCB) may stay in English.\n'
    +'- These are safety-relevant instructions. Translate precisely; do not soften, shorten or embellish.\n'
    +'- Return ONLY a JSON array of the translated strings, same order, same length. No commentary.\n\n'
    +JSON.stringify(['<up to 20 strings from the sheet>'], null, 0);
}
export function renderAdminPromptsSection(){
  const body=document.getElementById('adm-prompts-body');
  if(!body) return;
  const items=_aiPromptCatalog();
  body.innerHTML=items.map(p=>`
    <details style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px">
      <summary style="padding:9px 12px;cursor:pointer;font-size:13px;font-weight:700;color:var(--blue-dark)">${esc(p.title)}</summary>
      <div style="padding:0 12px 12px">
        <p style="font-size:11px;color:var(--muted);margin:0 0 8px">${esc(p.note)}</p>
        <button class="btn btn-ghost btn-sm prompt-copy" data-id="${esc(p.id)}" style="margin-bottom:8px">📋 Copy</button>
        <pre id="prompt-text-${esc(p.id)}" style="white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid var(--border);border-radius:5px;padding:10px;font-size:11px;line-height:1.5;max-height:340px;overflow:auto;margin:0">${esc(p.text)}</pre>
      </div>
    </details>`).join('');
  body.querySelectorAll('.prompt-copy').forEach(btn=>btn.addEventListener('click',async()=>{
    const el=document.getElementById(`prompt-text-${btn.dataset.id}`);
    if(!el) return;
    try{ await navigator.clipboard.writeText(el.textContent); toast('Prompt copied','success'); }
    catch{ toast('Could not copy — select the text manually','error'); }
  }));
}

// ── Logo (single-company build) ──────────────────────────────────────────────
// The app now runs for one company only, so there's no company list/selector
// any more — this just edits the CURRENT company's logo, which the Home screen
// and top bar read via companyLogoB64/_logoHTML().
export async function renderSettingsLogoSection(){
  const body=document.getElementById('stg-logo-body');
  if(!body) return;
  let _logoB64=S.companyLogoB64||'';
  const _render=()=>{
    const prev=document.getElementById('stg-logo-preview');
    if(prev) prev.innerHTML=_logoB64?`<img src="${_logoB64}" style="width:100%;height:100%;object-fit:contain">`:`<span style="font-size:28px">🏢</span>`;
  };
  body.innerHTML=`
    <div style="display:flex;align-items:center;gap:14px">
      <div id="stg-logo-preview" style="width:80px;height:80px;border-radius:8px;background:var(--blue-light);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0"></div>
      <div>
        <input type="file" id="stg-logo-inp" accept="image/*" style="font-size:12px">
        <button type="button" class="btn btn-ghost btn-sm" id="stg-logo-clear" style="margin-top:8px">Remove Logo</button>
      </div>
    </div>
    <button class="btn btn-green" id="btn-stg-logo-save" style="margin-top:16px">💾 Save Logo</button>`;
  _render();

  document.getElementById('stg-logo-inp').addEventListener('change',()=>{
    const f=document.getElementById('stg-logo-inp').files[0];
    if(!f) return;
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const maxDim=256;
        const scale=Math.min(1,maxDim/Math.max(img.width,img.height));
        const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        _logoB64=canvas.toDataURL('image/png');
        _render();
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(f);
  });
  document.getElementById('stg-logo-clear').addEventListener('click',()=>{ _logoB64=''; _render(); });
  document.getElementById('btn-stg-logo-save').addEventListener('click',async()=>{
    const btn=document.getElementById('btn-stg-logo-save');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      await updateCompany({logo_b64:_logoB64});
      S.companyLogoB64=_logoB64; // keep Home/top-bar in sync without a reload
      toast('Logo saved','success');
    }catch(e){ toast('Error: '+e.message,'error'); }
    btn.disabled=false; btn.textContent='💾 Save Logo';
  });
}

// Lightweight "you need an API key first" prompt — shown when a drawing import
// is attempted with no key configured (see handleFiles/handleSDFiles). The keys
// themselves live on the Admin screen now; this exists purely so a user isn't
// dead-ended mid-task, and it saves to the same localStorage entries.
export function showSettingsModal(onSaved){
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>🔑 AI API Key Required</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px">Analyzing a drawing needs at least one AI key. Enter one here to continue — you can manage them later on the 🛡️ Admin screen.</p>
      <div class="form-field">
        <label>Anthropic API Key</label>
        <input class="form-input" id="inp-anth-key" type="password" placeholder="sk-ant-…" value="${esc(S.anthKey)}">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:10px">Saved in this browser only. Better: an admin stores the key on the server (🛡️ Admin → AI API Keys) — then nobody needs a key in the browser.</p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" id="btn-save-settings">Save</button>
    </div>
  </div>`);

  document.getElementById('btn-save-settings').addEventListener('click',()=>{
    S.anthKey=document.getElementById('inp-anth-key').value.trim();
    localStorage.setItem('anth_key',S.anthKey);
    toast('API keys saved','success');
    closeModal();
    if(onSaved) onSaved();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// USERS / COMPANIES / BRANDING — rendered inside the Settings page (which is
// itself only reachable by users with role:'admin' on their users/{uid} doc).
// Ported from the Windows desktop app's AdminPanel (ui/admin_panel.py).
// ══════════════════════════════════════════════════════════════════════════════
// Role dropdown options are dynamic now — see roleOptions() near the top of
// the script (built-in defaults ∪ custom roles saved via Settings > Roles).

// ── Users section ─────────────────────────────────────────────────────────────
export async function renderSettingsUsersSection(){
  const body=document.getElementById('stg-users-body');
  if(!body) return;
  body.innerHTML=`<div style="text-align:center;padding:40px;color:var(--muted)"><div class="ring" style="margin:0 auto"></div></div>`;
  let users=[];
  try{
    users=await listUsers();
  }catch(e){ body.innerHTML=`<p style="color:red;padding:20px">${e.message}</p>`; return; }
  body.innerHTML=`
    <div class="toolbar"><span class="count-badge">${users.length} users</span>
      <button class="btn btn-green btn-sm" id="btn-invite-user" style="margin-left:auto">＋ Invite User</button></div>
    <div class="table-wrap"><table id="stg-users-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map(u=>`<tr data-id="${esc(u._id)}">
        <td>${esc(u.displayName||'')}</td>
        <td>${esc(u.email||'')}</td>
        <td>${esc(u.role||'')}</td>
        <td>${u.disabled===true?'<span class="price-red" style="font-weight:600">Disabled</span>':'<span class="price-green">Active</span>'}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm stg-edit-user" data-id="${esc(u._id)}">✏️ Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  document.getElementById('btn-invite-user').addEventListener('click',()=>openInviteUserModal());
  document.querySelectorAll('.stg-edit-user').forEach(btn=>btn.addEventListener('click',()=>{
    const u=users.find(x=>x._id===btn.dataset.id); if(u) openEditUserModal(u);
  }));
}

// Single-company build: new users are always created under the current
// company, so there's no company picker any more.
export function openInviteUserModal(){
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>Invite User</h3><button class="close-modal" id="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field"><label>Full Name</label><input class="form-input" id="inv-name-inp" placeholder="e.g. Israel Israeli"></div>
      <div class="form-field" style="margin-top:10px"><label>Email</label><input class="form-input" id="inv-email-inp" type="email" placeholder="user@company.com"></div>
      <div class="form-field" style="margin-top:10px"><label>Password</label><input class="form-input" id="inv-pass-inp" type="password" placeholder="Min. 6 characters"></div>
      <div class="form-field" style="margin-top:10px"><label>Role</label>
        <select class="form-input" id="inv-role-sel">${roleOptions().map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-green" id="btn-invite-confirm">＋ Create User</button>
    </div>
  </div>`);
  document.getElementById('modal-close').addEventListener('click',closeModal);
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('btn-invite-confirm').addEventListener('click',async()=>{
    const name=document.getElementById('inv-name-inp').value.trim();
    const email=document.getElementById('inv-email-inp').value.trim().toLowerCase();
    const pass=document.getElementById('inv-pass-inp').value;
    const companyIdSel=companyId; // single-company build
    const role=document.getElementById('inv-role-sel').value;
    if(!name||!email){ toast('Name and email are required','error'); return; }
    if(pass.length<6){ toast('Password must be at least 6 characters','error'); return; }
    const btn=document.getElementById('btn-invite-confirm');
    btn.disabled=true; btn.textContent='Creating…';
    try{
      await adminCreateUser(email,pass,name,companyIdSel,role);
      toast(`User "${name}" created`,'success');
      logAudit('user_created',{email,role},true);
      closeModal(); renderSettingsUsersSection();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('user_created',{error:e.message},false); btn.disabled=false; btn.textContent='＋ Create User'; }
  });
}

// Creates a new Firebase Auth account via the raw Identity Toolkit REST endpoint
// (NOT the client SDK's createUserWithEmailAndPassword, which would sign the
// currently-signed-in admin OUT of their own session and INTO the new account).
// A plain fetch() call never touches the SDK's in-memory auth state, so the
// admin's session stays untouched. The new user's Firestore profile doc is then
// written using the admin's own, still-active session/permissions.
export async function adminCreateUser(email,password,displayName,companyIdVal,role){
  const resp=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB.options.apiKey}`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password,returnSecureToken:true})
  });
  const data=await resp.json();
  if(data.error) throw new Error(data.error.message==='EMAIL_EXISTS'?'A user with this email already exists':(data.error.message||'Failed to create user'));
  const uid=data.localId;
  await createUserProfile(uid,{ email, displayName, company_id:companyIdVal, role });
  return uid;
}

export function openEditUserModal(u){
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>Edit User</h3><button class="close-modal" id="modal-close">✕</button></div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">${esc(u.displayName||'')} · ${esc(u.email||'')}</p>
      <div class="form-field"><label>Role</label>
        <select class="form-input" id="edu-role-sel">${roleOptions().map(([v,l])=>`<option value="${v}" ${v===u.role?'selected':''}>${l}</option>`).join('')}</select>
      </div>
      <div class="form-field" style="margin-top:10px">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer">
          <input type="checkbox" id="edu-disabled-chk" ${u.disabled===true?'checked':''} style="width:auto">
          <span>Account disabled (blocks sign-in)</span>
        </label>
      </div>

      <div style="border-top:1px solid var(--border);margin:16px 0 12px"></div>
      <label style="display:block;font-size:11px;font-weight:700;color:#4A5568;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Password</label>
      <p style="font-size:11px;color:var(--muted);margin:0 0 10px;line-height:1.5">
        Sends <strong>${esc(u.email||'')}</strong> a secure link to set a new sign-in password.
        Passwords live in Firebase Authentication and can only be set by the account owner —
        no one, including an admin, can read or type in someone else's password from here.
      </p>
      <button class="btn btn-blue btn-sm" id="btn-edu-pwreset" style="width:100%;justify-content:center">📧 Send Password Reset Link</button>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-red btn-sm" id="btn-edu-delete">🗑 Delete User</button>
      <button class="btn btn-green" id="btn-edu-save">💾 Save</button>
    </div>
  </div>`);
  document.getElementById('modal-close').addEventListener('click',closeModal);
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('btn-edu-pwreset').addEventListener('click',async()=>{
    const email=(u.email||'').trim();
    if(!email){ toast('This user has no email address on file','error'); return; }
    if(!confirm(`Send a password reset link to ${email}?\n\nThey'll get an email with a link to choose a new password, and can sign in with it straight away. Their current password keeps working until they complete the reset.`)) return;
    const btn=document.getElementById('btn-edu-pwreset');
    btn.disabled=true; btn.textContent='Sending…';
    try{
      await sendPasswordResetEmail(auth,email);
      toast(`Password reset link sent to ${email}`,'success');
      logAudit('user_password_reset_sent',{email},true);
      btn.textContent='✓ Reset Link Sent';
    }catch(e){
      toast('Error: '+e.message,'error');
      logAudit('user_password_reset_sent',{email,error:e.message},false);
      btn.disabled=false; btn.textContent='📧 Send Password Reset Link';
    }
  });
  document.getElementById('btn-edu-save').addEventListener('click',async()=>{
    const role=document.getElementById('edu-role-sel').value;
    const disabled=document.getElementById('edu-disabled-chk').checked;
    const btn=document.getElementById('btn-edu-save');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      // Single-company build: keep the user on the current company (also
      // backfills company_id for any older profile that never had one set).
      await updateUserProfile(u._id,{company_id:u.company_id||companyId,role,disabled});
      toast('User updated','success');
      logAudit('user_updated',{email:u.email||u._id,role,disabled},true);
      closeModal(); renderSettingsUsersSection();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('user_updated',{error:e.message},false); btn.disabled=false; btn.textContent='💾 Save'; }
  });
  document.getElementById('btn-edu-delete').addEventListener('click', async()=>{
    if(!confirm(`Delete user "${u.displayName||u.email}"?\n\nThis removes their profile, company assignment, and role. Note: their sign-in account itself isn't deleted (that requires a backend) — use "disable" instead if you need to reliably block sign-in.`)) return;
    const btn=document.getElementById('btn-edu-delete');
    btn.disabled=true; btn.textContent='Deleting…';
    try{
      await deleteUserProfile(u._id);
      toast('User profile deleted','success');
      logAudit('user_deleted',{email:u.email||u._id},true);
      closeModal(); renderSettingsUsersSection();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('user_deleted',{error:e.message},false); btn.disabled=false; btn.textContent='🗑 Delete User'; }
  });
}

// ── Roles section ────────────────────────────────────────────────────────────
// Every role is one document in the Firestore 'roles' collection, listed,
// edited and deleted the same way. On first use the seed roles are written in
// so there is nothing that exists only in code, and no two-tier model for an
// admin to reason about.
//
// 'admin' is the single exception, and only to prevent an unrecoverable state —
// see PROTECTED_ROLE at the top of the script.
export async function renderSettingsRolesSection(){
  const body=document.getElementById('stg-roles-body');
  if(!body) return;
  body.innerHTML=`<div style="text-align:center;padding:40px;color:var(--muted)"><div class="ring" style="margin:0 auto"></div></div>`;

  let saved={};
  try{
    const docs=await listRoleDocs();
    docs.forEach(d=>{
      if(d.id===ROLES_META_DOC){ S._rolesSeeded = d.data?.seeded===true; return; }
      if(_isRoleDocId(d.id)) saved[d.id]=d.data||{};
    });

    // Materialise any seed role that has no document yet, ONCE. Gated on the
    // marker rather than on "is the collection empty", because an installation
    // can easily be part-populated — a custom role created under an earlier
    // version leaves exactly that state, and an emptiness check would then skip
    // seeding forever and show only that one role.
    //
    // After the marker is written this never runs again, so a role the admin
    // deletes stays deleted.
    if(!S._rolesSeeded){
      const missing=Object.keys(SEED_ROLE_VIEWS).filter(k=>!(k in saved));
      await Promise.all(missing.map(k=>{
        const rec={name:k.charAt(0).toUpperCase()+k.slice(1), views:SEED_ROLE_VIEWS[k]};
        saved[k]=rec;
        return createRole(k, rec);   // adds createdAt/updatedAt
      }));
      if(missing.length) logAudit('roles_seeded',{roles:missing},true);
      // The marker is an optimisation — it stops a deleted role from being
      // re-seeded. Losing it must not cost the admin the whole screen, so a
      // failure here is reported but not fatal: the roles above are already
      // written, and the next visit simply finds nothing missing and retries
      // the marker.
      try{
        await markRolesSeeded(ROLES_META_DOC, S.currentUserEmail||'');
        S._rolesSeeded=true;
      }catch(e){
        console.warn('[Roles] seed marker not written:', e.message);
        toast('Roles are set up, but the one-time marker could not be saved — a deleted role may reappear. '+e.message,'error');
      }
    }
  }catch(e){ body.innerHTML=`<p style="color:red;padding:20px">${esc(e.message)}</p>`; return; }
  S.roleViewsMap=saved;   // keep the in-memory gate in step with what was just read

  const roles=_mergedRoleKeys().map(k=>({
    _id:k,
    name: saved[k]?.name || (k.charAt(0).toUpperCase()+k.slice(1)),
    views: Array.isArray(saved[k]?.views) ? saved[k].views : (SEED_ROLE_VIEWS[k]||[]),
    disabledViews: Array.isArray(saved[k]?.disabledViews) ? saved[k].disabledViews : [],
  }));
  const viewKeys=Object.keys(HOME_BUTTONS);
  body.innerHTML=`
    <div class="toolbar"><span class="count-badge">${roles.length} roles</span>
      <button class="btn btn-green btn-sm" id="btn-new-role" style="margin-left:auto">＋ New Role</button></div>
    <div class="table-wrap"><table id="stg-roles-table">
      <thead><tr><th>Role Name</th><th>Key</th>${viewKeys.map(v=>`<th style="text-align:center">${HOME_BUTTONS[v][0]} ${HOME_BUTTONS[v][1]}</th>`).join('')}<th></th></tr></thead>
      <tbody>${roles.map(r=>{
        const locked = r._id===PROTECTED_ROLE;
        return `<tr data-key="${esc(r._id)}">
        <td><input class="form-input role-name-inp" data-key="${esc(r._id)}" value="${esc(r.name||r._id)}" style="padding:4px 7px;font-size:12px;min-width:100px"></td>
        <td style="font-family:monospace;font-size:11px;color:var(--muted)">${esc(r._id)}</td>
        ${viewKeys.map(v=>{
          const pin = locked && PROTECTED_VIEWS.includes(v);
          // Screens newer than this role document are on for administrators (see
          // ADMIN_AUTO_VIEWS), so the table has to show them that way — a row
          // reading "Off" beside a button that is plainly there is worse than no
          // table at all. They can still be turned off by disabling them, so the
          // only state withheld is "Off".
          const auto = locked && !pin && ADMIN_AUTO_VIEWS.includes(v);
          const state = pin ? 'on'
                      : (r.disabledViews||[]).includes(v) ? 'disabled'
                      : (r.views||[]).includes(v) || auto ? 'on' : 'off';
          return `<td style="text-align:center"><select class="role-view-sel"
            data-key="${esc(r._id)}" data-view="${v}" ${pin?'disabled':''}
            ${pin?'title="Administrators must keep access to this screen — removing it would lock the system out of its own administration."'
                 :auto?'title="New screens are switched on for administrators automatically. Set it to Disabled to grey it out."':''}
            style="padding:2px 4px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:#fff">
            <option value="on" ${state==='on'?'selected':''}>On</option>
            <option value="disabled" ${state==='disabled'?'selected':''}>Disabled</option>
            ${auto?'':`<option value="off" ${state==='off'?'selected':''}>Off</option>`}
          </select></td>`;
        }).join('')}
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-green btn-sm role-save" data-key="${esc(r._id)}">💾 Save</button>
          ${locked
            ? `<button class="btn btn-ghost btn-sm" disabled title="The administrator role cannot be deleted.">🔒</button>`
            : `<button class="btn btn-ghost btn-sm role-del" data-key="${esc(r._id)}" data-name="${esc(r.name||r._id)}">🗑</button>`}
        </td>
      </tr>`;}).join('')}</tbody>
    </table></div>`;

  document.getElementById('btn-new-role').addEventListener('click',()=>openNewRoleModal());

  body.querySelectorAll('.role-save').forEach(btn=>btn.addEventListener('click',async()=>{
    const key=btn.dataset.key;
    const name=(body.querySelector(`.role-name-inp[data-key="${key}"]`).value||'').trim()||key;
    // "Disabled" screens are stored in BOTH lists: they are part of what the
    // role can see (views) and separately marked inert (disabledViews), so any
    // older client that doesn't know about disabling still renders a button
    // rather than losing the screen entirely.
    const sels=[...body.querySelectorAll(`.role-view-sel[data-key="${key}"]`)];
    let views=sels.filter(s2=>s2.value!=='off').map(s2=>s2.dataset.view);
    let disabledViews=sels.filter(s2=>s2.value==='disabled').map(s2=>s2.dataset.view);
    // The protected screens must survive regardless of what the DOM says — this
    // is the write path, so it is where the guarantee has to hold. A disabled
    // select submits nothing, and an admin locked out of Admin could not undo it.
    if(key===PROTECTED_ROLE){
      // ADMIN_AUTO_VIEWS goes into the document on the first save so the grant
      // stops being implicit — after this the role record says what it means.
      views=[...new Set([...views, ...PROTECTED_VIEWS, ...ADMIN_AUTO_VIEWS])];
      disabledViews=disabledViews.filter(v=>!PROTECTED_VIEWS.includes(v));
    }
    btn.disabled=true; btn.textContent='Saving…';
    try{
      await updateRole(key,{name,views,disabledViews});
      S.roleViewsMap[key]={name,views,disabledViews};
      toast(`Role "${name}" saved`,'success');
      logAudit('role_saved',{role:key,name,views,disabledViews},true);
      // The current user may have just changed their own permissions.
      if(key===currentUserRole) renderHomeIfActive();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('role_saved',{role:key,error:e.message},false); }
    btn.disabled=false; btn.textContent='💾 Save';
  }));

  body.querySelectorAll('.role-del').forEach(btn=>btn.addEventListener('click',async()=>{
    const key=btn.dataset.key, name=btn.dataset.name;
    // Deleting a role that people are still assigned to would leave those
    // accounts pointing at nothing. Rather than silently reassigning them or
    // letting them fall back to a default they were never given, the delete is
    // refused and the admin is told how many users to move first.
    btn.disabled=true;
    let inUse=0;
    try{
      inUse=await countUsersWithRole(key);
    }catch(e){
      toast('Could not check which users have this role: '+e.message,'error');
      btn.disabled=false; return;
    }
    if(inUse){
      toast(`"${name}" is assigned to ${inUse} user${inUse>1?'s':''} — reassign them first`,'error');
      btn.disabled=false; return;
    }
    if(!confirm(`Delete the role "${name}"? No users are assigned to it.`)){ btn.disabled=false; return; }
    try{
      await deleteRole(key);
      delete S.roleViewsMap[key];
      toast(`Role "${name}" deleted`,'success');
      logAudit('role_deleted',{role:key,name},true);
      renderSettingsRolesSection();
    }catch(e){
      toast('Error: '+e.message,'error'); logAudit('role_deleted',{role:key,error:e.message},false);
      btn.disabled=false;
    }
  }));
}

export function openNewRoleModal(){
  const viewKeys=Object.keys(HOME_BUTTONS);
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>New Role</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-field">
        <label>Role Name</label>
        <input class="form-input" id="nr-name-inp" placeholder="e.g. Manager">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Role Key (internal, lowercase, no spaces)</label>
        <input class="form-input" id="nr-key-inp" placeholder="e.g. manager">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Visible Buttons</label>
        ${viewKeys.map(v=>`<label style="display:flex;align-items:center;gap:7px;margin-top:8px;cursor:pointer;font-weight:400;font-size:13px">
          <input type="checkbox" class="nr-view-chk" value="${v}" style="width:auto"><span>${HOME_BUTTONS[v][0]} ${HOME_BUTTONS[v][1]}</span>
        </label>`).join('')}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" id="btn-nr-save">＋ Create</button>
    </div>
  </div>`);
  document.getElementById('btn-nr-save').addEventListener('click',async()=>{
    const name=document.getElementById('nr-name-inp').value.trim();
    // Leading/trailing underscores are stripped so the sanitiser can never
    // produce a bookkeeping-looking id, nor a Firestore-reserved one (any id
    // matching __.*__ is rejected outright by the server).
    const key=document.getElementById('nr-key-inp').value.trim().toLowerCase()
                .replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');
    const views=[...document.querySelectorAll('.nr-view-chk:checked')].map(c=>c.value);
    if(!name||!key){ toast('Name and key are required','error'); return; }
    // "Create" on an existing key is really an overwrite — it would silently
    // replace that role's permissions for everyone who has it. Checked against
    // what actually exists, so a role the admin deleted CAN be re-created.
    if(key in S.roleViewsMap || key===PROTECTED_ROLE){
      toast(`A role with the key "${key}" already exists — edit it in the table instead`,'error');
      return;
    }
    // Underscore-prefixed ids are bookkeeping documents, not roles.
    if(!_isRoleDocId(key)){ toast('A role key cannot start with an underscore','error'); return; }
    const btn=document.getElementById('btn-nr-save');
    btn.disabled=true; btn.textContent='Creating…';
    try{
      await createRole(key,{name,views});
      S.roleViewsMap[key]={name,views};
      toast(`Role "${name}" created`,'success');
      closeModal();
      renderSettingsRolesSection();
    }catch(e){ toast('Error: '+e.message,'error'); btn.disabled=false; btn.textContent='＋ Create'; }
  });
}
