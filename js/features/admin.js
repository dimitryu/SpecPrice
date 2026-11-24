import { S } from '../core/state.js';
import { _aiSetProxy } from '../ai/client.js';
import { logAudit } from '../core/audit.js';
import { bindCollapseControls, collapseControlsHTML, makePanelsCollapsible } from '../core/collapse.js';
import { auth } from '../core/firebase.js';
import { logDescribe, logSearchText, logTitle } from '../core/logText.js';
import { parseBoolQuery, wireSearchClear } from '../core/table.js';
import { closeModal, debounce, esc, fmtDateTime, setActions, setContent, showModal, toast } from '../core/ui.js';
import { listRecentAuditEntries } from '../data/audit.js';
import { clearCompanyAiKeys } from '../data/company.js';
import { listDeletedCustomers, purgeCustomer, restoreCustomer } from '../data/customers.js';
import { listDeletedProjects, purgeProject, restoreProject } from '../data/projects.js';
import { listDeletedSpecDocs, purgeSpecDoc, restoreSpecDoc } from '../data/specs.js';
import { listTickets, setTicketStatus } from '../data/support.js';
import { renderAdminPromptsSection } from './settings.js';
import { _SUPPORT_ICON_SVG, _SUPPORT_ROW_BG, _SUPPORT_STATUSES, _SUPPORT_STATUS_COLOR, _SUPPORT_STATUS_LABEL, _SUPPORT_STATUS_TEXT, _supBindFileButtons, _supMarkRead, _supPostMessage, _supPrepareFiles, _supRefreshBadges, _supTurn, _supportNeedsAdmin, _supportStatusBadge, _supportThread, _supportUnreadDot } from './support.js';

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN (support tickets + system audit log) — admin-role only, gated the
// same way as Settings (see route()). Reached via the "🛡️ Admin" Home button.
// ══════════════════════════════════════════════════════════════════════════════
export function renderAdminPage(){
  setActions(collapseControlsHTML());
  setContent(`
    <div class="settings-panel" style="padding:20px 22px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">🔑 AI API Keys</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:14px">Used for extracting BOMs from PDF/image drawings, Cut &amp; Strip, manufacturing steps and the Sales Desk process/notes analysis.</p>
      <div id="adm-ai-status" style="font-size:11px;color:var(--muted);margin-bottom:14px">Loading current status…</div>
      <div class="form-field">
        <label>Anthropic API Key</label>
        <input class="form-input" id="adm-anth-key" type="password" placeholder="sk-ant-… (leave blank to keep current)" autocomplete="off">
      </div>
      <div style="background:var(--info-bg);border:1px solid var(--info-line);border-radius:6px;padding:9px 11px;margin-top:12px;font-size:11px;color:var(--ink);line-height:1.5">
        🔒 Stored on the server, like the distributor keys below — it cannot be read back, only replaced, and no browser ever holds it. Every user of the app uses it through the server.
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-green" id="btn-adm-save-keys">💾 Save API Key</button>
        <button class="btn" id="btn-adm-test-ai">🧪 Test Connection</button>
      </div>
      <div id="adm-ai-test" style="margin-top:12px"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">🔌 Distributor Price APIs</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:14px">Official Mouser, DigiKey, Online Components and Farnell (element14) APIs, used by CHECK PRICE to fill their price columns. Set up any of them on its own — you don't need all of them.</p>
      <div id="adm-dist-status" style="font-size:11px;color:var(--muted);margin-bottom:14px">Loading current status…</div>

      <div class="form-field">
        <label>Mouser API Key</label>
        <input class="form-input" id="adm-mouser-key" type="password" placeholder="leave blank to keep current" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>DigiKey Client ID</label>
        <input class="form-input" id="adm-dk-id" type="password" placeholder="leave blank to keep current" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>DigiKey Client Secret</label>
        <input class="form-input" id="adm-dk-secret" type="password" placeholder="leave blank to keep current" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Online Components API Key</label>
        <input class="form-input" id="adm-oc-key" type="password" placeholder="leave blank to keep current" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Online Components API Name</label>
        <input class="form-input" id="adm-oc-name" type="text" placeholder="cgpriceavailability (leave blank to keep current)" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Farnell API Key <span style="font-weight:400;text-transform:none;color:var(--muted)">— free from <a href="https://partner.element14.com/" target="_blank" rel="noopener noreferrer">partner.element14.com</a></span></label>
        <input class="form-input" id="adm-fa-key" type="password" placeholder="leave blank to keep current" autocomplete="off">
      </div>
      <div class="form-field" style="margin-top:12px">
        <label>Farnell Store</label>
        <input class="form-input" id="adm-fa-store" type="text" placeholder="il.farnell.com (leave blank to keep current)" autocomplete="off">
      </div>

      <div style="background:var(--info-bg);border:1px solid var(--info-line);border-radius:6px;padding:9px 11px;margin-top:12px;font-size:11px;color:var(--ink);line-height:1.5">
        🔒 These are stored on the server, not in your browser, and cannot be read back — only replaced. Leave a field blank to keep its current value.
      </div>

      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-green" id="btn-adm-save-dist">💾 Save Credentials</button>
        <button class="btn" id="btn-adm-test-dist">🧪 Test Connection</button>
      </div>
      <div id="adm-dist-test" style="margin-top:12px"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">${_SUPPORT_ICON_SVG} Support Tickets</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Requests and problem reports submitted via the Support button. Reply and set a status — the user sees your reply the next time they open Support.</p>
      <div id="adm-tickets-body"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">♻ Recycle Bin</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">RFQs, customers, Cut &amp; Strip specifications and manufacturing instructions that someone deleted. Nothing is gone until you delete it here — restore it, or delete it permanently. (Deleted Database parts have their own bin: Database → ♻ Deleted items.)</p>
      <div id="adm-bin-body"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">📜 System Logs</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Login/logout, screen opens, and key actions across every user — most recent 500 entries.</p>
      <div id="adm-logs-body"></div>
    </div>

    <div class="settings-panel" style="padding:20px 22px;margin-top:20px;">
      <h3 style="font-size:14px;font-weight:700;color:var(--blue-dark);margin-bottom:4px">🤖 AI Prompts</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">The exact instructions sent to the AI for each kind of analysis. Read-only — shown so you can see what the AI is being asked to do.</p>
      <div id="adm-prompts-body"></div>
    </div>`);

  renderAdminAiKeySection();
  renderAdminDistributorApiSection();
  renderAdminTicketsSection();
  renderAdminBinSection();
  renderAdminLogsSection();
  makePanelsCollapsible(document.getElementById('content'),'admin');
  bindCollapseControls('admin');
  renderAdminPromptsSection();
}

// ── Anthropic key — stored on the server ─────────────────────────────────────
// Saved through apiConfig into a document no client can read; the AI requests
// then go through the server (see ai/client.js _aiFetch). There is no browser
// fallback: if the functions are unreachable, saving fails and says so.
export async function renderAdminAiKeySection(){
  const statusEl=document.getElementById('adm-ai-status');
  const saveBtn=document.getElementById('btn-adm-save-keys');
  const testBtn=document.getElementById('btn-adm-test-ai');
  const testEl=document.getElementById('adm-ai-test');
  const input=document.getElementById('adm-anth-key');
  if(!statusEl||!saveBtn||!testBtn||!input) return;
  const badge=(ok,label,detail)=>
    `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;`+
    `background:${ok?'#DCFCE7':'#FEE2E2'};color:${ok?'#166534':'#991B1B'}">${ok?'✓':'✕'} ${esc(label)}</span>`+
    (detail?` <span style="color:var(--muted);font-size:10px">${esc(detail)}</span>`:'');
  const notDeployed=m=>/404|Failed to fetch|NetworkError|Load failed/i.test(String(m||''));

  async function refreshStatus(){
    statusEl.innerHTML='Loading current status…';
    try{
      const s=await _apiConfigCall('GET');
      const a=s.anthropic;
      if(!a){
        // An apiConfig deployed before the AI key moved to the server.
        statusEl.innerHTML=`<span style="color:var(--red)">The server functions are out of date — run: firebase deploy --only functions</span>`;
        return;
      }
      if(a.configured) _aiSetProxy(true);
      const when=a.updatedAt?new Date(a.updatedAt).toLocaleString():'';
      statusEl.innerHTML=a.configured
        ? `<div>${badge(true,'Anthropic — on the server',[a.hint,a.source==='env-var'?'via env var':''].filter(Boolean).join(' · '))}</div>`+
          (when?`<div style="color:var(--muted);font-size:10px;margin-top:4px">Last changed ${esc(when)}${a.updatedBy?' by '+esc(a.updatedBy):''}</div>`:'')
        : `<div>${badge(false,'Anthropic','not on the server yet')}</div>`+
          `<div style="color:var(--muted);font-size:10px;margin-top:4px">Enter the key and save — every user can then use the AI features.</div>`;
    }catch(e){
      statusEl.innerHTML=`<span style="color:var(--red)">${esc(notDeployed(e.message)
        ? 'Cannot reach the server functions — run: firebase deploy --only functions'
        : e.message)}</span>`;
    }
  }

  saveBtn.addEventListener('click',async()=>{
    const v=input.value.trim();
    if(!v){ toast('Nothing to save — enter the key first','warn'); return; }
    saveBtn.disabled=true; saveBtn.textContent='Saving…';
    try{
      await _apiConfigCall('POST',{anthropic_api_key:v});
      input.value='';
      _aiSetProxy(true);
      // The old copies: the company document is readable by every signed-in
      // user, so the key is taken out of it once the server has it.
      try{ await clearCompanyAiKeys(); }catch(e){ console.warn('[ai key] company doc cleanup:',e.message); }
      toast('API key saved on the server','success');
      logAudit('ai_keys_updated',{anthropic:true,storage:'server'},true);
      await refreshStatus();
    }catch(e){
      // No browser fallback: a key is never kept in this browser.
      toast(notDeployed(e.message)
        ? 'Cannot reach the server functions — run: firebase deploy --only functions, then save again'
        : 'Save failed: '+e.message,'error');
      logAudit('ai_keys_updated',e.message,false);
    }finally{ saveBtn.disabled=false; saveBtn.textContent='💾 Save API Key'; }
  });

  testBtn.addEventListener('click',async()=>{
    testBtn.disabled=true; testBtn.textContent='Testing…';
    testEl.innerHTML='<span style="font-size:11px;color:var(--muted)">Sending a tiny request…</span>';
    try{
      const r=await _apiConfigCall('POST',{action:'test_ai'});
      testEl.innerHTML=r.skipped
        ? `<span style="font-size:11px;color:var(--muted)">No key on the server yet — save one first.</span>`
        : `<div>${badge(r.ok,'Anthropic')} <span style="font-size:11px">${esc(r.message)}</span></div>`;
      logAudit('ai_key_test',r.message,!!r.ok);
    }catch(e){
      testEl.innerHTML=`<span style="color:var(--red);font-size:11px">${esc(e.message)}</span>`;
    }finally{ testBtn.disabled=false; testBtn.textContent='🧪 Test Connection'; }
  });

  refreshStatus();
}

// ── Distributor API credentials (Mouser / DigiKey) ───────────────────────────
// Like the Anthropic key above, these never live in the browser: they
// are POSTed to the apiConfig Cloud Function, which stores them where no client
// can read them back. The UI therefore shows status, never values.
export const API_CONFIG_URL='https://us-central1-specprice-236a2.cloudfunctions.net/apiConfig';
export async function _apiConfigCall(method, body){
  if(!auth.currentUser) throw new Error('Not signed in');
  const token=await auth.currentUser.getIdToken();
  const init={method, headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(60000)};
  if(body){ init.headers['Content-Type']='application/json'; init.body=JSON.stringify(body); }
  const resp=await fetch(API_CONFIG_URL, init);
  let data=null;
  try{ data=await resp.json(); }catch{}
  if(!resp.ok) throw new Error((data&&data.error)||`HTTP ${resp.status}`);
  return data;
}

export async function renderAdminDistributorApiSection(){
  const statusEl=document.getElementById('adm-dist-status');
  const saveBtn=document.getElementById('btn-adm-save-dist');
  const testBtn=document.getElementById('btn-adm-test-dist');
  const testEl=document.getElementById('adm-dist-test');
  if(!statusEl||!saveBtn||!testBtn) return;

  const pill=(ok,label,detail)=>
    `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;`+
    `background:${ok?'#DCFCE7':'#FEE2E2'};color:${ok?'#166534':'#991B1B'}">${ok?'✓':'✕'} ${esc(label)}</span>`+
    (detail?` <span style="color:var(--muted);font-size:10px">${esc(detail)}</span>`:'');

  async function refreshStatus(){
    statusEl.innerHTML='Loading current status…';
    try{
      const s=await _apiConfigCall('GET');
      // "Where did this come from" matters when debugging: a key set with the
      // CLI and one set here look identical until you need to change it.
      const src=o=>o.source==='env-var'?'via env var':(o.source==='ui'?'set here':'');
      const when=s.updatedAt?new Date(s.updatedAt).toLocaleString():'';
      const row=(o,name,h)=>o.configured
        ? `<div>${pill(true,name,[h,src(o)].filter(Boolean).join(' · '))}</div>`
        : `<div><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#F1F5F9;color:#64748B">– ${name}</span> <span style="color:var(--muted);font-size:10px">not set up</span></div>`;
      const oc=s.onlinecomp||{configured:false};
      const fa=s.farnell||{configured:false};
      const none=!s.mouser.configured && !s.digikey.configured && !oc.configured && !fa.configured;
      statusEl.innerHTML=
        `<div style="display:flex;flex-direction:column;gap:6px">
           ${row(s.mouser,'Mouser',s.mouser.hint)}
           ${row(s.digikey,'DigiKey',s.digikey.clientIdHint)}
           ${row(oc,'Online Components',[oc.hint, oc.apiName?'API name '+oc.apiName:''].filter(Boolean).join(' · '))}
           ${row(fa,'Farnell',[fa.hint, fa.store?'store '+fa.store:''].filter(Boolean).join(' · '))}
           <div style="color:var(--muted);font-size:10px">${none
             ? 'No vendor is set up yet — add any one to start.'
             : 'Each vendor works on its own — one is enough.'}</div>
           ${when?`<div style="color:var(--muted);font-size:10px">Last changed ${esc(when)}${s.updatedBy?' by '+esc(s.updatedBy):''}</div>`:''}
         </div>`;
    }catch(e){
      // A 404 here almost always means the function hasn't been deployed yet —
      // say so, rather than leaving the admin staring at a raw status code.
      const notDeployed=/404|Failed to fetch|NetworkError/i.test(e.message);
      statusEl.innerHTML=`<span style="color:var(--red)">${esc(notDeployed
        ? 'Cannot reach the apiConfig function — run: firebase deploy --only functions'
        : e.message)}</span>`;
    }
  }

  saveBtn.addEventListener('click',async()=>{
    const mk=document.getElementById('adm-mouser-key').value.trim();
    const di=document.getElementById('adm-dk-id').value.trim();
    const ds=document.getElementById('adm-dk-secret').value.trim();
    const ok=document.getElementById('adm-oc-key').value.trim();
    const on=document.getElementById('adm-oc-name').value.trim();
    const fk=document.getElementById('adm-fa-key').value.trim();
    const fs=document.getElementById('adm-fa-store').value.trim();
    // Only send the fields actually filled in — an omitted field means "keep",
    // which is what lets the admin change one credential without re-typing all.
    const body={};
    if(mk) body.mouser_api_key=mk;
    if(di) body.digikey_client_id=di;
    if(ds) body.digikey_client_secret=ds;
    if(ok) body.onlinecomp_api_key=ok;
    if(on) body.onlinecomp_api_name=on;
    if(fk) body.farnell_api_key=fk;
    if(fs) body.farnell_store=fs;
    if(!Object.keys(body).length){ toast('Nothing to save — fill in at least one field','warn'); return; }

    saveBtn.disabled=true; saveBtn.textContent='Saving…';
    try{
      const r=await _apiConfigCall('POST',body);
      // Clear the inputs immediately: there is no reason for a secret to sit in
      // a DOM node after it's been stored.
      ['adm-mouser-key','adm-dk-id','adm-dk-secret','adm-oc-key','adm-oc-name','adm-fa-key','adm-fa-store'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
      toast('Credentials saved','success');
      logAudit('distributor_api_keys_updated',{fields:(r.updated||[]).join(', ')},true);
      await refreshStatus();
    }catch(e){
      toast('Save failed: '+e.message,'error');
      logAudit('distributor_api_keys_updated',e.message,false);
    }finally{ saveBtn.disabled=false; saveBtn.textContent='💾 Save Credentials'; }
  });

  testBtn.addEventListener('click',async()=>{
    testBtn.disabled=true; testBtn.textContent='Testing…';
    testEl.innerHTML='<span style="font-size:11px;color:var(--muted)">Querying the vendors…</span>';
    try{
      const r=await _apiConfigCall('POST',{action:'test'});
      // A vendor you haven't signed up for shows as a neutral dash, not a red
      // ✕ — otherwise a perfectly healthy one-vendor setup looks like a fault.
      const line=(name,v)=>{
        const badge=v.skipped
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#F1F5F9;color:#64748B">– ${esc(name)}</span>`
          : pill(v.ok,name);
        return `<div style="margin-bottom:4px">${badge} <span style="font-size:11px;color:${v.skipped?'var(--muted)':'inherit'}">${esc(v.message)}</span></div>`;
      };
      testEl.innerHTML=
        `<div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px">
           <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Test part: ${esc(r.pn)}</div>
           ${line('Mouser',r.mouser)}${line('DigiKey',r.digikey)}${r.onlinecomp?line('Online Components',r.onlinecomp):''}${r.farnell?line('Farnell',r.farnell):''}
         </div>`;
      logAudit('distributor_api_test',`mouser=${r.mouser.ok} digikey=${r.digikey.ok} onlinecomp=${!!(r.onlinecomp&&r.onlinecomp.ok)} farnell=${!!(r.farnell&&r.farnell.ok)}`,r.mouser.ok||r.digikey.ok||!!(r.onlinecomp&&r.onlinecomp.ok)||!!(r.farnell&&r.farnell.ok));
    }catch(e){
      testEl.innerHTML=`<span style="color:var(--red);font-size:11px">${esc(e.message)}</span>`;
    }finally{ testBtn.disabled=false; testBtn.textContent='🧪 Test Connection'; }
  });

  refreshStatus();
}

export const _ADM_TICKET_CACHE={}; // ticketId -> ticket data (ALL fetched tickets, unfiltered) — used by openAdminReplyModal
export let _admTicketsAll=[], _admTicketsFilterUser='', _admTicketsFilterStatus='';
// Which tickets were waiting when this screen was opened. Opening the screen
// clears the flags in Firestore, but the row still has to SHOW which ones were
// new — clearing a marker and leaving no trace of what it marked is how you
// lose the one ticket you came to answer.
export let _admTicketsWasUnread=[];
export async function renderAdminTicketsSection(){
  const body=document.getElementById('adm-tickets-body');
  if(!body) return;
  body.innerHTML=`<div style="text-align:center;padding:30px"><div class="ring" style="margin:0 auto"></div></div>`;
  try{
    // Attachment documents live in this same collection and are left out —
    // see listTickets in data/support.js.
    _admTicketsAll=await listTickets();
  }catch(e){ body.innerHTML=`<p style="color:red;padding:20px">${esc(e.message)}</p>`; return; }
  Object.keys(_ADM_TICKET_CACHE).forEach(k=>delete _ADM_TICKET_CACHE[k]);
  _admTicketsAll.forEach(t=>_ADM_TICKET_CACHE[t._id]=t);
  _admTicketsWasUnread=_admTicketsAll.filter(_supportNeedsAdmin).map(t=>t._id);
  if(!_admTicketsAll.length){ body.innerHTML=`<p style="color:var(--muted);font-size:12px;padding:10px 0">No support requests yet.</p>`; return; }
  const users=[...new Set(_admTicketsAll.map(t=>t.user).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(_admTicketsFilterUser && !users.includes(_admTicketsFilterUser)) _admTicketsFilterUser='';
  body.innerHTML=`
    <div class="toolbar" style="margin-bottom:10px;gap:8px">
      <select class="form-input" id="adm-tickets-filter-user" style="width:auto;min-width:160px">
        <option value="">All Users</option>
        ${users.map(u=>`<option value="${esc(u)}" ${u===_admTicketsFilterUser?'selected':''}>${esc(u)}</option>`).join('')}
      </select>
      <select class="form-input" id="adm-tickets-filter-status" style="width:auto;min-width:140px">
        <option value="">All Statuses</option>
        ${_SUPPORT_STATUSES.map(s=>`<option value="${s}" ${s===_admTicketsFilterStatus?'selected':''}>${_SUPPORT_STATUS_LABEL[s]}</option>`).join('')}
      </select>
      ${_admTicketsWasUnread.length?`<span class="count-badge" style="background:#FEE2E2;color:#9B1C1C;font-weight:700">${_admTicketsWasUnread.length} waiting for you</span>`:''}
      <span class="count-badge" id="adm-tickets-count"></span>
    </div>
    <div class="table-wrap"><table>
    <thead><tr><th style="width:26px"></th><th>Date/Time</th><th>User</th><th>Conversation</th><th style="width:130px">Status</th><th style="width:90px"></th></tr></thead>
    <tbody id="adm-tickets-tbody"></tbody>
  </table></div>`;
  document.getElementById('adm-tickets-filter-user').addEventListener('change',e=>{ _admTicketsFilterUser=e.target.value; _admTicketsFilterRows(); });
  document.getElementById('adm-tickets-filter-status').addEventListener('change',e=>{ _admTicketsFilterStatus=e.target.value; _admTicketsFilterRows(); });
  _admTicketsFilterRows();
  // Reading the list is reading the news — but only for other people's tickets.
  // An admin's own request is answered by an admin, so clearing it here would
  // wipe the marker on the one ticket nobody else is going to pick up.
  _supMarkRead(_admTicketsAll.filter(t=>_supportNeedsAdmin(t) && t.user!==S.currentUserEmail).map(t=>t._id), true);
}
export function _admTicketsFilterRows(){
  const tbody=document.getElementById('adm-tickets-tbody');
  const countEl=document.getElementById('adm-tickets-count');
  if(!tbody) return;
  const tickets=_admTicketsAll.filter(t=>{
    if(_admTicketsFilterUser && t.user!==_admTicketsFilterUser) return false;
    if(_admTicketsFilterStatus && (t.status||'open')!==_admTicketsFilterStatus) return false;
    return true;
  });
  if(countEl) countEl.textContent=`${tickets.length} of ${_admTicketsAll.length}`;
  tbody.innerHTML=tickets.length ? tickets.map(t=>{
    const turns=_supportThread(t);
    const last=turns[turns.length-1]||{};
    const files=turns.reduce((a,m)=>a+((m.files||[]).length),0);
    return `<tr data-id="${esc(t._id)}" style="background:${_SUPPORT_ROW_BG[_SUPPORT_STATUSES.includes(t.status)?t.status:'open']}">
      <td style="text-align:center">${_supportUnreadDot(_admTicketsWasUnread.includes(t._id),'New since you last looked')}</td>
      <td style="white-space:nowrap;font-size:11px;color:var(--muted)">${fmtDateTime(t.createdAt)}</td>
      <td style="font-size:12px">${esc(t.user||'')}</td>
      <td style="font-size:12px;max-width:380px">
        <div style="white-space:pre-wrap;word-break:break-word">${esc(t.message||'')}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">
          ${turns.length} message${turns.length>1?'s':''}${files?` · ${files} attachment${files>1?'s':''}`:''}
          ${turns.length>1?` · last: <strong>${last.role==='admin'?'admin':'user'}</strong> — ${esc(String(last.text||'').slice(0,80))}`:''}
        </div>
      </td>
      <td><select class="form-input adm-ticket-status" data-id="${esc(t._id)}" style="padding:3px 6px;font-size:12px;font-weight:700;border:none;border-radius:5px;background:${_SUPPORT_STATUS_COLOR[_SUPPORT_STATUSES.includes(t.status)?t.status:'open']};color:${_SUPPORT_STATUS_TEXT[_SUPPORT_STATUSES.includes(t.status)?t.status:'open']}">
        ${_SUPPORT_STATUSES.map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${_SUPPORT_STATUS_LABEL[s]}</option>`).join('')}
      </select></td>
      <td><button class="btn btn-ghost btn-sm adm-ticket-reply" data-id="${esc(t._id)}">💬 Open</button></td>
    </tr>`;}).join('') : `<tr class="empty-row"><td colspan="6">No tickets match this filter</td></tr>`;
  tbody.querySelectorAll('.adm-ticket-status').forEach(sel=>sel.addEventListener('change',async()=>{
    const id=sel.dataset.id, status=sel.value;
    sel.style.background=_SUPPORT_STATUS_COLOR[status]; sel.style.color=_SUPPORT_STATUS_TEXT[status];
    const rowEl=sel.closest('tr'); if(rowEl) rowEl.style.background=_SUPPORT_ROW_BG[status];
    if(_ADM_TICKET_CACHE[id]) _ADM_TICKET_CACHE[id].status=status;
    const cached=_admTicketsAll.find(t=>t._id===id); if(cached) cached.status=status;
    try{
      // Closing someone's ticket is news for them, so it lights up their Support
      // button exactly like a reply would — otherwise "Done" is a decision the
      // person who asked never finds out about.
      await setTicketStatus(id, status);
      logAudit('ticket_status_changed',{ticketId:id,status},true);
      toast('Status updated','success');
      if(_admTicketsFilterStatus) _admTicketsFilterRows();
    }catch(e){ toast('Error: '+e.message,'error'); }
  }));
  tbody.querySelectorAll('.adm-ticket-reply').forEach(btn=>btn.addEventListener('click',()=>openAdminReplyModal(btn.dataset.id)));
  _supBindFileButtons(tbody);
}
// The admin side of the same conversation: the whole exchange, a reply with
// attachments, and the status in the same dialog — so answering and deciding
// are one action rather than two that can disagree.
export function openAdminReplyModal(ticketId){
  const t=_ADM_TICKET_CACHE[ticketId];
  if(!t) return;
  const turns=_supportThread(t);
  showModal(`<div class="modal" style="width:min(94vw,680px)">
    <div class="modal-head"><h3>💬 ${esc(t.user||'')}</h3>${_supportStatusBadge(t.status)}<button class="close-modal" data-close-modal>✕</button></div>
    <div class="modal-body" id="adm-reply-thread" style="max-height:52vh">
      ${turns.map(m=>_supTurn(m,{userLabel:t.user||'User'})).join('')}
    </div>
    <div class="modal-foot" style="flex-direction:column;align-items:stretch;gap:8px">
      <textarea class="form-input" id="adm-reply-inp" rows="3" placeholder="Write your reply…" style="resize:vertical"></textarea>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="file" id="adm-reply-files" multiple style="font-size:11px;flex:1;min-width:170px"
          accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.doc,.docx,.html">
        <label for="adm-reply-status" style="font-size:11px;color:var(--muted)">Status</label>
        <select class="form-input" id="adm-reply-status" style="width:auto">
          ${_SUPPORT_STATUSES.map(s=>`<option value="${s}" ${s==='open'?'selected':''}>${_SUPPORT_STATUS_LABEL[s]}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" data-close-modal>Cancel</button>
        <button class="btn btn-green" id="btn-adm-reply-save">Send reply</button>
      </div>
      <div style="font-size:10px;color:var(--muted)">A reply re-opens the request by default — pick another status here if you are closing it in the same breath.</div>
    </div>
  </div>`);
  _supBindFileButtons(document.getElementById('adm-reply-thread'));
  document.getElementById('btn-adm-reply-save').addEventListener('click',async()=>{
    const text=document.getElementById('adm-reply-inp').value.trim();
    const status=document.getElementById('adm-reply-status').value;
    const picker=document.getElementById('adm-reply-files');
    if(!text && !(picker.files||[]).length){ toast('Write a reply or attach a file','error'); return; }
    const btn=document.getElementById('btn-adm-reply-save');
    btn.disabled=true; btn.textContent='Sending…';
    try{
      const {ready,rejected}=await _supPrepareFiles(picker.files);
      if(rejected.length) toast('Not attached: '+rejected.join('; '),'error');
      await _supPostMessage(ticketId, text, ready, true, status);
      toast('Reply sent','success');
      closeModal();
      renderAdminTicketsSection();
      _supRefreshBadges();
    }catch(e){ toast('Error: '+e.message,'error'); btn.disabled=false; btn.textContent='Send reply'; }
  });
}

export let _admLogsCache=[], _admLogsFilterQ='';
// Details values (JSON payloads) are often longer than the column — collapsed to
// one ellipsized line by default so the table stays scannable. Two ways to read
// the full value: the "Expand details" toggle below (applies to every row), or
// clicking a single Details cell to expand just that one.
export let _admLogsWrapDetails=false;
// v1.83.7: an entry is shown in plain words (core/logText.js) — a title for
// the action, one summary line, and on expanding every value with its label
// and each step of an analysis with its time in seconds.
export function _admLogDetailsHTML(l){
  const x=logDescribe(l);
  const items=x.items.filter(i=>i.key!=='stage_ms');
  return `<div class="log-sum${x.error?' log-err':''}">${esc(x.summary)}</div>
    <div class="log-full">
      ${items.length?`<dl class="log-dl">${items.map(i=>`<dt>${esc(i.label)}</dt><dd${i.key==='error'?' class="log-err"':''}>${esc(i.value)}</dd>`).join('')}</dl>`:''}
      ${x.steps.length?`<div class="log-steps-h">Steps</div><table class="log-steps">${x.steps.map(st=>
        `<tr><td>${esc(st.label)}</td><td class="log-sec">${esc(st.sec)}</td></tr>`).join('')}</table>`:''}
    </div>`;
}
export async function renderAdminLogsSection(){
  const body=document.getElementById('adm-logs-body');
  if(!body) return;
  body.innerHTML=`<div style="text-align:center;padding:30px"><div class="ring" style="margin:0 auto"></div></div>`;
  try{
    _admLogsCache=await listRecentAuditEntries(500);
  }catch(e){ body.innerHTML=`<p style="color:red;padding:20px">${esc(e.message)}</p>`; return; }
  _renderAdminLogsTable();
}
// Builds the toolbar (search box) + table shell ONCE per data load. Typing in the
// search box must NOT rebuild this shell — recreating the <input> node on every
// keystroke was what made the caret jump back to the start each time (the browser
// has no way to preserve cursor position across a full innerHTML replace). Filtering
// now only touches the <tbody> + count badge via _admLogsFilterRows(), same pattern
// as the Part Stock picker's filterRows().
export function _renderAdminLogsTable(){
  const body=document.getElementById('adm-logs-body');
  if(!body) return;
  body.innerHTML=`
    <div class="toolbar" style="margin-bottom:8px">
      <div class="search-wrap">
        <input class="search-box" id="adm-logs-search" placeholder='Search — supports AND / OR / NOT / "phrase" / (...)' value="${esc(_admLogsFilterQ)}">
        <button type="button" class="search-clear" id="adm-logs-search-clear" title="Clear">✕</button>
      </div>
      <button class="btn btn-ghost" id="btn-adm-logs-refresh" style="white-space:nowrap">🔄 Refresh</button>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap;cursor:pointer"
             title="Show every detail of every row — each value with its label, and the time of each step in seconds. You can also click a single row's Details to open just that one.">
        <input type="checkbox" id="adm-logs-wrap" ${_admLogsWrapDetails?'checked':''} style="width:auto">
        Expand details
      </label>
      <span class="count-badge" id="adm-logs-count"></span>
    </div>
    <div class="table-wrap" style="max-height:60vh"><table>
      <thead><tr><th>Time</th><th>User</th><th>What happened</th><th>Details</th><th style="width:60px">Result</th></tr></thead>
      <tbody id="adm-logs-tbody"></tbody>
    </table></div>`;
  const searchInp=document.getElementById('adm-logs-search');
  wireSearchClear('adm-logs-search','adm-logs-search-clear');
  searchInp.addEventListener('input',debounce(()=>{ _admLogsFilterQ=searchInp.value; _admLogsFilterRows(); },200));
  document.getElementById('btn-adm-logs-refresh').addEventListener('click',()=>renderAdminLogsSection());
  document.getElementById('adm-logs-wrap').addEventListener('change',e=>{
    _admLogsWrapDetails=e.target.checked;
    _admLogsFilterRows();
  });
  _admLogsFilterRows();
}
export function _admLogsFilterRows(){
  const tbody=document.getElementById('adm-logs-tbody');
  const countEl=document.getElementById('adm-logs-count');
  if(!tbody) return;
  const predicate=parseBoolQuery(_admLogsFilterQ);
  const rows=_admLogsCache.filter(l=>{
    if(!_admLogsFilterQ.trim()) return true;
    const detailsStr=typeof l.details==='object'?JSON.stringify(l.details):String(l.details||'');
    // the words shown, and the stored codes too (a search for "price_check" still works)
    return predicate([l.user,l.viaUser,l.action,logSearchText(l),detailsStr,l.success?'success':'failed'].map(v=>String(v||'')).join(' | ').toLowerCase());
  });
  tbody.innerHTML=rows.map(l=>{
    const sys=l.user==='SYSTEM';
    return `<tr>
        <td style="white-space:nowrap;font-size:11px;color:var(--muted)">${fmtDateTime(l.timestamp)}</td>
        <td style="font-size:12px">${sys?`System${l.viaUser?`<div class="log-code" title="The app did this on its own, during this user's work">for ${esc(l.viaUser)}</div>`:''}`:esc(l.user||'')}</td>
        <td style="font-size:12px">${esc(logTitle(l.action))}<div class="log-code">${esc(l.action||'')}</div></td>
        <td class="adm-log-details${_admLogsWrapDetails?' is-open':''}" title="Click to show or hide every detail">${_admLogDetailsHTML(l)}</td>
        <td style="text-align:center">${l.success?'<span style="color:var(--ok)" title="Worked">✓</span>':'<span style="color:var(--bad)" title="Did not work">✗</span>'}</td>
      </tr>`;
  }).join('');
  // Per-row open/close: one entry in full without opening every row.
  tbody.querySelectorAll('.adm-log-details').forEach(td=>td.addEventListener('click',()=>td.classList.toggle('is-open')));
  if(countEl) countEl.textContent=`${rows.length} of ${_admLogsCache.length} (most recent 500)`;
}

// ── Recycle Bin ──────────────────────────────────────────────────────────────
// Everything people delete from RFQ, Customers, Cut & Strip and Manufacturing
// lands here (see data/trash.js). Only an admin restores or purges — the
// Firestore rules allow the real delete to the company admin alone.
const _BIN_KINDS={
  rfq:      {label:'RFQ',            list:listDeletedProjects,  restore:restoreProject,  purge:purgeProject,  name:d=>d.name||d._id},
  customer: {label:'Customer',       list:listDeletedCustomers, restore:restoreCustomer, purge:purgeCustomer, name:d=>d.name||d._id},
  spec:     {label:'Cut & Strip',    list:async()=>(await listDeletedSpecDocs()).filter(d=>d.kind!=='mfg'), restore:restoreSpecDoc, purge:purgeSpecDoc, name:d=>d.drawing_number||d._id},
  mfg:      {label:'Manufacturing',  list:async()=>(await listDeletedSpecDocs()).filter(d=>d.kind==='mfg'), restore:restoreSpecDoc, purge:purgeSpecDoc, name:d=>d.name||d.drawing_number||d._id},
};
export async function renderAdminBinSection(){
  const body=document.getElementById('adm-bin-body');
  if(!body) return;
  body.innerHTML='<div style="font-size:12px;color:var(--muted)">Loading…</div>';
  let rows=[];
  try{
    for(const [k,cfg] of Object.entries(_BIN_KINDS)){
      const list=await cfg.list();
      rows.push(...list.map(d=>({k, id:d._id, name:cfg.name(d), by:d.deletedBy||'', at:Number(d.deletedAtMs)||0})));
    }
  }catch(e){ body.innerHTML=`<p style="color:var(--red);font-size:12px">${esc(e.message)}</p>`; return; }
  rows.sort((a,b)=>b.at-a.at);
  if(!rows.length){ body.innerHTML='<p style="color:var(--muted);font-size:12px;padding:6px 0">The recycle bin is empty.</p>'; return; }
  body.innerHTML=`
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn btn-sm" id="bin-restore">↩ Restore selected</button>
      <button class="btn btn-red btn-sm" id="bin-purge">✕ Delete permanently</button>
      <span id="bin-count" style="font-size:11px;color:var(--muted);align-self:center">${rows.length} item${rows.length>1?'s':''}</span>
    </div>
    <div class="table-wrap" style="max-height:320px"><table style="font-size:12px">
      <thead><tr><th style="width:26px"><input type="checkbox" id="bin-all"></th><th>Type</th><th>Name</th><th>Deleted by</th><th>Deleted</th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td><input type="checkbox" class="bin-chk" data-i="${i}"></td>
        <td>${esc(_BIN_KINDS[r.k].label)}</td><td>${esc(r.name)}</td><td>${esc(r.by)}</td>
        <td>${r.at?esc(fmtDateTime(new Date(r.at))):'—'}</td></tr>`).join('')}</tbody>
    </table></div>`;
  const picked=()=>[...body.querySelectorAll('.bin-chk:checked')].map(c=>rows[+c.dataset.i]);
  body.querySelector('#bin-all').addEventListener('change',e=>body.querySelectorAll('.bin-chk').forEach(c=>c.checked=e.target.checked));
  const run=async(kind)=>{
    const sel=picked();
    if(!sel.length){ toast('Select items first','warn'); return; }
    if(kind==='purge' && !confirm(`Delete ${sel.length} item${sel.length>1?'s':''} permanently?\n\nThis cannot be undone. An RFQ is deleted with all its drawings.`)) return;
    let ok=0, failed=0;
    for(const r of sel){
      try{ await _BIN_KINDS[r.k][kind](r.id); ok++; }catch(e){ failed++; console.warn('[bin]',e.message); }
    }
    logAudit(kind==='purge'?'recycle_bin_purge':'recycle_bin_restore',
      {count:ok, failed, items:sel.slice(0,100).map(r=>`${_BIN_KINDS[r.k].label}: ${r.name}`)}, !failed);
    toast(`${ok} ${kind==='purge'?'deleted permanently':'restored'}${failed?`, ${failed} failed`:''}`, failed?'warn':'success');
    renderAdminBinSection();
  };
  body.querySelector('#bin-restore').addEventListener('click',()=>run('restore'));
  body.querySelector('#bin-purge').addEventListener('click',()=>run('purge'));
}
