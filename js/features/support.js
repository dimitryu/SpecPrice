import { S } from '../core/state.js';
import { logAudit } from '../core/audit.js';
import { auth } from '../core/firebase.js';
import { PROTECTED_ROLE, allowedViews } from '../core/roles.js';
import { route } from '../core/router.js';
import { companyId, currentUserRole } from '../core/session.js';
import { esc, fmtDateTime, mkEl, showModal, toast } from '../core/ui.js';
import { addTicketFile, appendTicketTurn, countUnreadForUser, createTicket, getTicketFile, listTickets, listUnreadForAdmin, markTicketsRead, setTicketFields } from '../data/support.js';

// ── Support ticket (floating headset button, every screen) ──────────────────────────
export const _SUPPORT_ICON_SVG=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-3px">
  <path d="M4 13.5V12a8 8 0 0 1 16 0v1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="3" y="13" width="4" height="6" rx="1.6" stroke="currentColor" stroke-width="1.8"/>
  <rect x="17" y="13" width="4" height="6" rx="1.6" stroke="currentColor" stroke-width="1.8"/>
  <path d="M19 19.2V20a3 3 0 0 1-3 3h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="12" cy="6.5" r="2.5" stroke="currentColor" stroke-width="1.6"/>
  <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
export const _SUPPORT_STATUSES=['open','in_progress','done','rejected'];
export const _SUPPORT_STATUS_LABEL={open:'Open',in_progress:'In Progress',done:'Done',rejected:'Rejected'};
export const _SUPPORT_STATUS_COLOR={open:'#2E75B6',in_progress:'#EAB308',done:'#1F8B4C',rejected:'#E53E3E'};
export const _SUPPORT_STATUS_TEXT={open:'#fff',in_progress:'#1A202C',done:'#fff',rejected:'#fff'};
export const _SUPPORT_ROW_BG={open:'#F7FAFC',in_progress:'#FEFCE8',done:'#F0FDF4',rejected:'#FEF2F2'};
export function _supportStatusBadge(status){
  const s=_SUPPORT_STATUSES.includes(status)?status:'open';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;color:${_SUPPORT_STATUS_TEXT[s]};background:${_SUPPORT_STATUS_COLOR[s]}">${_SUPPORT_STATUS_LABEL[s]}</span>`;
}

// A ticket is a CONVERSATION, not a message with one reply stapled to it.
// Every turn lives in `thread`, an array of
//   {role:'user'|'admin', by, text, at (ISO string), files:[{id,name,type,size}]}
//
// Two older shapes are still in the database and are folded into the same list
// when a ticket is read: the original `message` (the first user turn) and a
// single `adminReply` (the admin's answer, before threads existed). Nothing is
// migrated in place — old tickets simply read correctly, and the first new
// reply on one starts the thread.
//
// Firestore rejects serverTimestamp() inside an array, so a turn carries a
// client ISO string. It is a display timestamp only; the authoritative ordering
// fields (createdAt, lastMsgAt) are real server timestamps on the document.
export function _supportThread(t){
  const out=[];
  if(t && (t.message || (t.files||[]).length))
    out.push({role:'user', by:t.user, text:t.message||'', at:t.createdAt, files:t.files||[]});
  if(t && t.adminReply)
    out.push({role:'admin', by:t.repliedBy||'', text:t.adminReply, at:t.repliedAt, files:[]});
  for(const m of (t && Array.isArray(t.thread) ? t.thread : []))
    out.push({role:m.role==='admin'?'admin':'user', by:m.by||'', text:m.text||'',
              at:m.at, files:Array.isArray(m.files)?m.files:[]});
  return out;
}
// Who still has to look at this ticket. Both flags are written by whoever posts
// (see _supPostMessage) and cleared by the side that reads it, so "unread" means
// exactly "something happened that you have not opened yet" rather than being
// re-derived from timestamps that two clocks would disagree about.
//
// A ticket written before this version has neither flag. It reads as "nothing
// new", which is the honest answer: nobody can know today whether it was seen
// back then, and lighting up every old ticket would train people to ignore the
// marker on the first day.
export function _supportNeedsUser(t){ return t && t.userUnread===true; }
export function _supportNeedsAdmin(t){ return t && t.adminUnread===true; }
export function _supportUnreadDot(on,title){
  return on ? `<span title="${esc(title||'Unread')}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#E53E3E;flex-shrink:0"></span>` : '';
}

// ── Attachments ─────────────────────────────────────────────────────────────
// A screenshot of what went wrong is worth more than a paragraph describing it,
// so a ticket and every reply can carry files.
//
// There is no Firebase Storage bucket in this build, so a file is stored as a
// base64 data URL in a document of its own — in the SAME support_tickets
// collection, deliberately WITHOUT a `createdAt` field. Firestore's orderBy
// only returns documents that actually carry the ordered field, and every query
// that lists tickets orders by createdAt, so attachment documents never come
// back with the ticket list however large they get. They are fetched one at a
// time, by id, when someone clicks the attachment. (Both list paths also filter
// on `kind` — belt and braces, not a substitute: the ordering is what keeps the
// bytes off the wire.)
//
// A Firestore document is capped at 1 MiB, so the base64 payload is capped well
// below that. Images are re-encoded down to fit; anything else has to arrive
// small enough on its own.
export const _SUP_FILE_MAX_B64=900000;       // ≈ 660 KB of original bytes
export const _SUP_IMG_MAX_PX=1600;
export const _SUP_IMG_QUALITIES=[0.82,0.7,0.58,0.45,0.35];
export const _SUP_MAX_FILES=4;
export function _supFmtBytes(n){
  const b=Number(n)||0;
  return b<1024 ? `${b} B` : b<1048576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`;
}
export function _supReadDataUrl(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res(String(fr.result||''));
    fr.onerror=()=>rej(new Error('Could not read '+file.name));
    fr.readAsDataURL(file);
  });
}
// Screenshots off a 4K monitor are several megabytes of mostly empty desktop.
// Re-encoding at 1600px is invisible for reading an error message and is what
// makes "attach a screenshot" work at all within the document limit.
export async function _supShrinkImage(file, dataUrl){
  if(!/^image\//.test(file.type||'') || /svg/i.test(file.type||'')) return dataUrl;
  try{
    const img=await new Promise((res,rej)=>{
      const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('bad image')); i.src=dataUrl;
    });
    const scale=Math.min(1,_SUP_IMG_MAX_PX/Math.max(img.width,img.height));
    if(scale>=1 && dataUrl.length<=_SUP_FILE_MAX_B64) return dataUrl;
    const cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(img.width*scale));
    cv.height=Math.max(1,Math.round(img.height*scale));
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
    let out=dataUrl;
    for(const q of _SUP_IMG_QUALITIES){
      out=cv.toDataURL('image/jpeg',q);
      if(out.length<=_SUP_FILE_MAX_B64) return out;
    }
    return out;
  }catch{ return dataUrl; }   // not decodable as an image — fall through to the size check
}
// Turns the File objects picked in the dialog into records ready to be written.
// Anything too big is reported by name rather than silently dropped.
export async function _supPrepareFiles(files){
  const ready=[], rejected=[];
  for(const f of Array.from(files||[]).slice(0,_SUP_MAX_FILES)){
    let data;
    try{ data=await _supShrinkImage(f, await _supReadDataUrl(f)); }
    catch(e){ rejected.push(`${f.name} (${e.message})`); continue; }
    if(data.length>_SUP_FILE_MAX_B64){
      rejected.push(`${f.name} — ${_supFmtBytes(f.size)}, too large (max ≈ ${_supFmtBytes(_SUP_FILE_MAX_B64*0.73)})`);
      continue;
    }
    ready.push({name:f.name||'attachment', type:f.type||'application/octet-stream',
                size:f.size||0, data});
  }
  return {ready, rejected};
}
export async function _supUploadFiles(ticketId, prepared){
  const metas=[];
  for(const p of prepared){
    const fileId=await addTicketFile({
      kind:'file', ticketId, name:p.name, type:p.type, size:p.size, data:p.data,
      by:S.currentUserEmail, at:new Date().toISOString()
    });
    metas.push({id:fileId, name:p.name, type:p.type, size:p.size});
  }
  return metas;
}
export function _supFileIcon(type){
  const t=String(type||'');
  return /^image\//.test(t) ? '🖼️' : /pdf/.test(t) ? '📕'
       : /sheet|excel|csv/.test(t) ? '📊' : /word|document/.test(t) ? '📄' : '📎';
}
export function _supFileChips(files){
  if(!files || !files.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${files.map(f=>
    `<button class="sup-file" data-id="${esc(f.id)}" data-name="${esc(f.name)}"
       title="Download ${esc(f.name)}">${_supFileIcon(f.type)} ${esc(f.name)}
       <span style="color:var(--muted);font-weight:400">${_supFmtBytes(f.size)}</span></button>`).join('')}</div>`;
}
// Attachments are downloaded rather than previewed: the data URL is already in
// hand, and a download works the same for a screenshot, a PDF and a workbook.
export async function _supDownloadFile(fileId, name){
  try{
    const file=await getTicketFile(fileId);
    if(!file){ toast('That attachment is no longer stored','error'); return; }
    const a=document.createElement('a');
    a.href=file.data; a.download=name||file.name||'attachment';
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){ toast('Could not open the attachment: '+e.message,'error'); }
}
export function _supBindFileButtons(root){
  (root||document).querySelectorAll('.sup-file').forEach(b=>b.addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation();
    _supDownloadFile(b.dataset.id, b.dataset.name);
  }));
}

// ── Posting a turn ──────────────────────────────────────────────────────────
// Any new turn re-opens the ticket. A "Done" ticket someone writes into again is
// not done — that is the whole reason they wrote. The admin can still pick a
// different status in the same breath (the reply dialog carries the dropdown),
// which is what makes this a default rather than a rule that fights them.
export async function _supPostMessage(ticketId, text, prepared, asAdmin, status){
  const metas=prepared && prepared.length ? await _supUploadFiles(ticketId, prepared) : [];
  const entry={role:asAdmin?'admin':'user', by:S.currentUserEmail, text:text||'',
               at:new Date().toISOString()};
  if(metas.length) entry.files=metas;
  await appendTicketTurn(ticketId, entry, {
    status:_SUPPORT_STATUSES.includes(status)?status:'open',
    lastMsgRole:entry.role,
    userUnread:!!asAdmin, adminUnread:!asAdmin,
  });
  logAudit(asAdmin?'ticket_replied':'ticket_user_replied',
    {ticketId, files:metas.length, chars:(text||'').length}, true);
  return entry;
}

// ── Unread markers ──────────────────────────────────────────────────────────
// Two counts, refreshed on a timer and after anything that could change them:
// what is waiting for THIS user on their own tickets, and — for an
// administrator — what is waiting for the admin on everyone else's. They are
// drawn on the Support button, in the top bar and on the Home screen, so the
// answer to "does anything need me?" is visible from every screen without
// opening anything.
export let _supUserAlerts=0, _supAdminAlerts=0, _supPollTimer=null;
export const _SUP_POLL_MS=90000;
export function _supCanAdminSupport(){ return currentUserRole===PROTECTED_ROLE || allowedViews().includes('admin'); }
export async function _supRefreshBadges(){
  if(!companyId || !S.currentUserEmail) return;
  try{
    _supUserAlerts=await countUnreadForUser(S.currentUserEmail);
  }catch(e){ console.warn('support badge (user)', e.message); }
  if(_supCanAdminSupport()){
    try{
      const pending=await listUnreadForAdmin();
      // An admin's own ticket already shows on their Support button; counting it
      // again as "someone needs you" would be the same news twice.
      _supAdminAlerts=pending.filter(t=>t.user!==S.currentUserEmail).length;
    }catch(e){ console.warn('support badge (admin)', e.message); }
  } else _supAdminAlerts=0;
  _supRenderBadges();
}
export function _supRenderBadges(){
  const fab=document.getElementById('btn-support-fab');
  if(fab){
    let b=document.getElementById('sup-fab-badge');
    if(_supUserAlerts>0){
      if(!b){ b=mkEl('span','sup-badge'); b.id='sup-fab-badge'; fab.appendChild(b); }
      b.textContent=String(_supUserAlerts);
      fab.title=`Support — ${_supUserAlerts} update${_supUserAlerts>1?'s':''} on your request${_supUserAlerts>1?'s':''}`;
    }else{
      if(b) b.remove();
      fab.title='Support — send a request or report a problem';
    }
  }
  const info=document.getElementById('topbar-info');
  if(info){
    let chip=document.getElementById('btn-adm-alert');
    if(_supAdminAlerts>0){
      if(!chip){
        chip=mkEl('button','adm-alert'); chip.id='btn-adm-alert';
        chip.addEventListener('click',()=>{
          route('admin');
          setTimeout(()=>document.getElementById('adm-tickets-body')
            ?.scrollIntoView({behavior:'smooth',block:'center'}),400);
        });
        info.insertBefore(chip, info.firstChild);
      }
      chip.textContent=`🛡️ ${_supAdminAlerts} support`;
      chip.title='Support requests from other users are waiting — click to open the Admin screen';
    } else if(chip) chip.remove();
  }
  const adminBtn=document.querySelector('.home-btn[data-view="admin"]');
  if(adminBtn){
    let hb=adminBtn.querySelector('.sup-badge');
    if(_supAdminAlerts>0){
      if(!hb){ hb=mkEl('span','sup-badge'); adminBtn.appendChild(hb); }
      hb.textContent=String(_supAdminAlerts);
    } else if(hb) hb.remove();
  }
}
export function _supStartBadgePolling(){
  _supRefreshBadges();
  if(_supPollTimer) clearInterval(_supPollTimer);
  _supPollTimer=setInterval(_supRefreshBadges,_SUP_POLL_MS);
}
// Clearing is per side and only ever done by the side that actually looked.
export async function _supMarkRead(ticketIds, asAdmin){
  const ids=(ticketIds||[]).filter(Boolean);
  if(!ids.length) return;
  try{
    await markTicketsRead(ids, asAdmin);
  }catch(e){ console.warn('support mark read', e.message); }
  _supRefreshBadges();
}

// ── The Support window (every user) ─────────────────────────────────────────
// Their own tickets as conversations: the whole exchange, an attachment button
// on every turn, a reply box per ticket, and a composer for a new request.
export let _supOpenTicket=null;    // which ticket is expanded, so a reload keeps your place
export async function openSupportModal(){
  showModal(`<div class="modal" style="width:min(94vw,680px)">
    <div class="modal-head"><h3>${_SUPPORT_ICON_SVG} Support</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="support-modal-body" style="max-height:58vh">
      <div style="text-align:center;padding:30px"><div class="ring" style="margin:0 auto"></div></div>
    </div>
    <div class="modal-foot" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">New request</div>
      <textarea id="support-new-msg" placeholder="Describe your request or the problem you're seeing…" rows="3"
        style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="file" id="support-new-files" multiple style="font-size:11px;flex:1;min-width:180px"
          accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.doc,.docx,.html">
        <button class="btn btn-blue" id="btn-support-send">Send to Admin</button>
      </div>
      <div style="font-size:10px;color:var(--muted)">Screenshots are resized automatically. Up to ${_SUP_MAX_FILES} files, ≈ 650 KB each.</div>
    </div>
  </div>`);
  const body=document.getElementById('support-modal-body');
  const loadMine=async()=>{
    try{
      const mine=(await listTickets()).filter(t=>t.user===S.currentUserEmail);
      if(!mine.length){
        body.innerHTML=`<p style="color:var(--muted);font-size:12px;text-align:center;padding:10px 0">No previous requests.</p>`;
        return;
      }
      if(!_supOpenTicket || !mine.some(t=>t._id===_supOpenTicket))
        _supOpenTicket=(mine.find(_supportNeedsUser)||mine[0])._id;
      body.innerHTML=mine.map(t=>_supTicketCard(t, t._id===_supOpenTicket)).join('');
      _supBindTicketCards(body, mine, loadMine);
      // Seeing the list is seeing the news: the status and the latest turn are
      // both on the card, so the marker has done its job by now.
      _supMarkRead(mine.filter(_supportNeedsUser).map(t=>t._id), false);
    }catch(e){ body.innerHTML=`<p style="color:red;font-size:12px">${esc(e.message)}</p>`; }
  };
  loadMine();

  document.getElementById('btn-support-send').addEventListener('click',async()=>{
    const ta=document.getElementById('support-new-msg');
    const message=ta.value.trim();
    const picker=document.getElementById('support-new-files');
    if(!message){ toast('Type a message first','error'); return; }
    const btn=document.getElementById('btn-support-send');
    btn.disabled=true; btn.textContent='Sending…';
    try{
      const {ready,rejected}=await _supPrepareFiles(picker.files);
      if(rejected.length) toast('Not attached: '+rejected.join('; '),'error');
      const ticketId=await createTicket({
        user:S.currentUserEmail, userId:auth.currentUser?.uid||'', message, status:'open',
        lastMsgRole:'user', userUnread:false, adminUnread:true
      });
      if(ready.length){
        const metas=await _supUploadFiles(ticketId, ready);
        await setTicketFields(ticketId,{files:metas});
      }
      logAudit('support_ticket_submitted',{message:message.slice(0,200),files:ready.length},true);
      ta.value=''; picker.value='';
      toast('Your request has been sent to the system administrator','success');
      _supOpenTicket=ticketId;
      await loadMine();
      _supRefreshBadges();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('support_ticket_submitted',{error:e.message},false); }
    btn.disabled=false; btn.textContent='Send to Admin';
  });
}
// One turn in the conversation. `userLabel` is who the reader is looking at
// when a user wrote it: "You" in the user's own Support window, their address
// in the administrator's copy of the same thread.
export function _supTurn(m, opts){
  const admin=m.role==='admin';
  const who=admin ? 'Admin' : ((opts && opts.userLabel) || 'You');
  return `<div style="margin-top:8px;padding:8px 10px;border-radius:7px;
      background:${admin?'#F0F7FF':'#F7FAFC'};border-left:3px solid ${admin?'#2E75B6':'#CBD5E1'}">
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--muted);margin-bottom:3px">
      <span style="font-weight:700;color:${admin?'var(--blue-dark)':'#475569'}">${esc(who)}${m.by&&m.by!==who?` · ${esc(m.by)}`:''}</span>
      <span>${esc(fmtDateTime(m.at))}</span>
    </div>
    ${m.text?`<div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${esc(m.text)}</div>`:''}
    ${_supFileChips(m.files)}
  </div>`;
}
export function _supTicketCard(t, expanded){
  const turns=_supportThread(t);
  const last=turns[turns.length-1];
  const unread=_supportNeedsUser(t);
  return `<div class="sup-card" data-id="${esc(t._id)}"
      style="border:1px solid ${unread?'#93C5FD':'var(--border)'};border-radius:8px;margin-bottom:8px;overflow:hidden">
    <div class="sup-card-head" data-id="${esc(t._id)}"
      style="display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;background:${unread?'#EFF6FF':'#fff'}">
      ${_supportUnreadDot(unread,'New activity on this request')}
      <span style="font-size:10px;color:var(--muted);white-space:nowrap">${esc(fmtDateTime(t.createdAt))}</span>
      <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((last&&last.text)||t.message||'')}</span>
      <span style="font-size:10px;color:var(--muted)">${turns.length} msg</span>
      ${_supportStatusBadge(t.status)}
      <span style="color:var(--muted);font-size:11px">${expanded?'▾':'▸'}</span>
    </div>
    ${expanded?`<div style="padding:0 11px 11px">
      ${turns.map(_supTurn).join('')}
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
        <textarea class="sup-reply-inp" data-id="${esc(t._id)}" rows="2" placeholder="Write a reply…"
          style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;resize:vertical"></textarea>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="file" class="sup-reply-files" data-id="${esc(t._id)}" multiple style="font-size:11px;flex:1;min-width:170px"
            accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.doc,.docx,.html">
          <button class="btn btn-blue btn-sm sup-reply-send" data-id="${esc(t._id)}">Send reply</button>
        </div>
        <div style="font-size:10px;color:var(--muted)">Replying re-opens this request so the administrator sees it again.</div>
      </div>
    </div>`:''}
  </div>`;
}
export function _supBindTicketCards(root, tickets, reload){
  root.querySelectorAll('.sup-card-head').forEach(h=>h.addEventListener('click',()=>{
    _supOpenTicket = _supOpenTicket===h.dataset.id ? null : h.dataset.id;
    const list=tickets.map(t=>_supTicketCard(t, t._id===_supOpenTicket)).join('');
    root.innerHTML=list;
    _supBindTicketCards(root, tickets, reload);
  }));
  _supBindFileButtons(root);
  root.querySelectorAll('.sup-reply-send').forEach(btn=>btn.addEventListener('click',async()=>{
    const id=btn.dataset.id;
    const ta=root.querySelector(`.sup-reply-inp[data-id="${id}"]`);
    const picker=root.querySelector(`.sup-reply-files[data-id="${id}"]`);
    const text=(ta?.value||'').trim();
    if(!text){ toast('Type a reply first','error'); return; }
    btn.disabled=true; btn.textContent='Sending…';
    try{
      const {ready,rejected}=await _supPrepareFiles(picker?picker.files:null);
      if(rejected.length) toast('Not attached: '+rejected.join('; '),'error');
      await _supPostMessage(id, text, ready, false, 'open');
      toast('Reply sent — the request is open again','success');
      await reload();
      _supRefreshBadges();
    }catch(e){ toast('Error: '+e.message,'error'); btn.disabled=false; btn.textContent='Send reply'; }
  }));
}
