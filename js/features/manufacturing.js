import { S } from '../core/state.js';
import { _mfgWriteSteps } from '../ai/manufacturing.js';
import { logAudit } from '../core/audit.js';
import { companyId, companyName } from '../core/session.js';
import { closeModal, debounce, esc, fmtDateTime, setActions, setContent, showModal, toast } from '../core/ui.js';
import { APP_VER } from '../core/version.js';
import { deleteSpecDoc, listSpecDocs, writeSpecDoc } from '../data/specs.js';
import { _csSetPath } from '../domain/cutstrip.js';
import { _mfgBlank, _mfgDocId, _mfgFromSpec, _mfgIsDoc } from '../domain/manufacturing.js';
import { _CS_LANG_NAMES, _csLang, _csRTL, _csSetLang, _csT } from './cutstrip/i18n.js';
import { loadCutStripSpecs } from './cutstrip/list.js';

export let mfgDocs=[], _mfgEditing=false, _mfgBackup=null, _mfgListQuery='';
export async function loadMfgDocs(force){
  if(mfgDocs.length && !force) return mfgDocs;
  if(!companyId) return (mfgDocs=[]);
  mfgDocs=(await listSpecDocs()).filter(_mfgIsDoc);
  return mfgDocs;
}

// ── List ────────────────────────────────────────────────────────────────────
export async function renderManufacturing(){
  const T=_csT;
  S.mfgCurrent=null; _mfgEditing=false; _mfgBackup=null;
  setActions(`<button class="btn btn-blue btn-sm" id="btn-mfg-new">＋ ${esc(T('New instruction'))}</button>
    <button class="btn btn-ghost btn-sm" id="btn-mfg-from-cs">↧ ${esc(T('From a Cut & Strip spec'))}</button>`);
  setContent(`<div style="text-align:center;padding:60px"><div class="ring" style="margin:0 auto"></div></div>`);
  document.getElementById('btn-mfg-new')?.addEventListener('click',_mfgNew);
  document.getElementById('btn-mfg-from-cs')?.addEventListener('click',_mfgImportModal);

  let list=[];
  try{ list=await loadMfgDocs(true); }
  catch(e){ setContent(`<div class="card" style="color:var(--danger)">Could not load: ${esc(e.message)}</div>`); return; }

  if(!list.length){
    setContent(`<div class="card" style="max-width:640px;margin:30px auto;text-align:center;padding:40px 30px">
      <div style="font-size:44px;margin-bottom:10px">🛠️</div>
      <h3 style="margin-bottom:6px">${esc(T('No manufacturing instructions yet'))}</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
        ${esc(T('A manufacturing instruction holds the material list, the order of operations, the inspection checks and the tooling for one assembly. Write one from scratch, or take the starting content from a cut & strip specification and edit it.'))}</p>
      <button class="btn btn-blue" id="btn-mfg-new2">＋ ${esc(T('New instruction'))}</button>
      <button class="btn btn-ghost" id="btn-mfg-from-cs2" style="margin-inline-start:8px">↧ ${esc(T('From a Cut & Strip spec'))}</button>
    </div>`);
    document.getElementById('btn-mfg-new2')?.addEventListener('click',_mfgNew);
    document.getElementById('btn-mfg-from-cs2')?.addEventListener('click',_mfgImportModal);
    return;
  }

  const q=_mfgListQuery.trim().toLowerCase();
  const words=q?q.split(/\s+/):[];
  const rows=list.filter(d=>{
    if(!words.length) return true;
    const hay=[d.doc_no,d.title,d.drawing_number,d.customer,d.project].join(' ').toLowerCase();
    return words.every(w=>hay.includes(w));
  });
  setContent(`
    <div class="toolbar" style="margin-bottom:10px;gap:8px">
      <input class="search-box" id="mfg-search" placeholder="${esc(T('Search instructions…'))}" value="${esc(_mfgListQuery)}" style="max-width:320px">
      <span class="count-badge">${rows.length} of ${list.length}</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th style="width:16%">${esc(T('Doc no.'))}</th><th>${esc(T('Title'))}</th><th style="width:13%">${esc(T('Drawing #'))}</th>
        <th style="width:14%">${esc(T('Customer'))}</th><th style="width:7%">${esc(T('Rev'))}</th>
        <th style="width:7%">${esc(T('Steps'))}</th><th style="width:12%">${esc(T('Updated'))}</th><th style="width:70px"></th></tr></thead>
      <tbody>${rows.length?rows.map(d=>`<tr class="mfg-row" data-id="${esc(d._id)}" style="cursor:pointer">
        <td class="cs-ltr" style="font-weight:700">${esc(d.doc_no||'')}</td>
        <td>${esc(d.title||'')}</td>
        <td class="cs-ltr">${esc(d.drawing_number||'')}</td>
        <td>${esc(d.customer||'')}</td>
        <td class="cs-ltr" style="text-align:center">${esc(d.revision||'')}</td>
        <td style="text-align:center">${(d.steps||[]).length}</td>
        <td style="font-size:11px;color:var(--muted)">${fmtDateTime(d.updatedAt)}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm mfg-del" data-id="${esc(d._id)}"
          data-name="${esc(d.doc_no||d.title||d._id)}" title="Delete">🗑</button></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="8">${esc(T('Nothing matches that search'))}</td></tr>`}
      </tbody></table></div>`);
  document.getElementById('mfg-search')?.addEventListener('input',debounce(e=>{
    _mfgListQuery=e.target.value; renderManufacturing();
  },250));
  document.querySelectorAll('.mfg-row').forEach(tr=>tr.addEventListener('click',e=>{
    if(e.target.closest('.mfg-del')) return;
    S.mfgCurrent=mfgDocs.find(d=>d._id===tr.dataset.id)||null;
    if(S.mfgCurrent) renderMfgDoc();
  }));
  document.querySelectorAll('.mfg-del').forEach(b=>b.addEventListener('click',async e=>{
    e.stopPropagation();
    if(!confirm(`Delete manufacturing instruction "${b.dataset.name}"? This cannot be undone.`)) return;
    try{
      await deleteSpecDoc(b.dataset.id);
      logAudit('mfg_deleted',{id:b.dataset.id},true);
      toast('Deleted','success');
      mfgDocs=[]; renderManufacturing();
    }catch(err){ toast('Error: '+err.message,'error'); }
  }));
}
export function _mfgNew(){
  S.mfgCurrent=_mfgBlank();
  S.mfgCurrent._id=null;
  _mfgEditing=true; _mfgBackup=null;
  renderMfgDoc();
}
// Seeding from a specification is a copy, so the picker lists every spec and
// says plainly what will be taken across.
export async function _mfgImportModal(){
  showModal(`<div class="modal" style="width:min(94vw,680px)">
    <div class="modal-head"><h3>↧ Start from a Cut &amp; Strip specification</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="mfg-imp-body" style="max-height:58vh">
      <div style="text-align:center;padding:30px"><div class="ring" style="margin:0 auto"></div></div>
    </div>
  </div>`);
  const body=document.getElementById('mfg-imp-body');
  let specs=[];
  try{ specs=await loadCutStripSpecs(true); }
  catch(e){ body.innerHTML=`<p style="color:red">${esc(e.message)}</p>`; return; }
  if(!specs.length){ body.innerHTML=`<p style="color:var(--muted);font-size:13px">There are no cut &amp; strip specifications yet.</p>`; return; }
  body.innerHTML=`<p style="font-size:12px;color:var(--muted);margin-bottom:10px">
      The material list is copied into a new instruction document, and the build sequence is written
      from the specification. The specification itself is left untouched.</p>
    <div class="table-wrap"><table><thead><tr><th>Drawing #</th><th>Name</th>
      <th style="width:60px">Steps</th><th style="width:60px">Tools</th><th style="width:90px"></th></tr></thead>
      <tbody>${specs.map(s=>`<tr>
        <td class="cs-ltr">${esc(s.drawing_number||s._id)}</td>
        <td>${esc(s.drawing_name||s.title||'')}</td>
        <td style="text-align:center">${(s.steps||[]).length}</td>
        <td style="text-align:center">${(s.tools||[]).length}</td>
        <td><button class="btn btn-blue btn-sm mfg-imp" data-id="${esc(s._id)}">Use</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  body.querySelectorAll('.mfg-imp').forEach(b=>b.addEventListener('click',async ()=>{
    const spec=specs.find(s=>s._id===b.dataset.id);
    if(!spec) return;
    S.mfgCurrent=_mfgFromSpec(spec);
    S.mfgCurrent._id=null;
    _mfgEditing=true; _mfgBackup=null;
    // A specification analysed since the cutting form stopped asking for the
    // build sequence has none to copy. Rather than hand over an empty
    // document, it is written now, from the specification, in its own small
    // request — and if that request fails the document still opens: an empty
    // sequence someone types is a nuisance, a lost import is a re-analysis.
    const needsSteps=!S.mfgCurrent.steps.length;
    closeModal();
    renderMfgDoc();
    if(!needsSteps){ toast('Content copied — review it and save','success'); return; }
    toast('Writing the build sequence…','info');
    try{
      const w=await _mfgWriteSteps(spec);
      if(S.mfgCurrent && !S.mfgCurrent._id){
        S.mfgCurrent.steps=w.steps; S.mfgCurrent.inspection=w.inspection; S.mfgCurrent.tools=w.tools;
        renderMfgDoc();
        logAudit('mfg_steps_written',{drawing:spec.drawing_number, steps:w.steps.length},true);
        toast(w.steps.length ? 'Sequence drafted — review it and save'
                             : 'Content copied — review it and save','success');
      }
    }catch(e){
      console.warn('[Mfg] build sequence', e.message);
      toast('Copied, but the build sequence could not be written: '+e.message,'warn');
    }
  }));
}

// ── The document ────────────────────────────────────────────────────────────
export function _mfgF(path, value, opts){
  const o=opts||{};
  if(!_mfgEditing) return esc(value==null?'':String(value));
  if(o.area) return `<textarea class="cs-in" data-mfg-path="${esc(path)}" rows="${o.rows||2}" style="width:100%">${esc(value||'')}</textarea>`;
  return `<input class="cs-in" data-mfg-path="${esc(path)}" value="${esc(value==null?'':String(value))}"${
    o.ph?` placeholder="${esc(o.ph)}"`:''}>`;
}
export function _mfgRowDel(kind,i){
  return _mfgEditing ? `<button class="cs-del" data-mfg-act="${kind}" data-mfg-idx="${i}" title="Delete">✕</button>` : '';
}
export function renderMfgDoc(){
  const d=S.mfgCurrent;
  // The form is Hebrew by default and translates on the same switch the cutting
  // form uses, so the two documents on one bench are never in two languages.
  const T=_csT;
  if(!d){ renderManufacturing(); return; }
  setActions(_mfgEditing ? `
    <button class="btn btn-sm btn-blue" id="btn-mfg-save">💾 ${esc(T('Save'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-mfg-cancel">${esc(T('Cancel'))}</button>` : `
    <span style="display:inline-flex;gap:4px;margin-inline-end:10px">
      ${['en','he','ru'].map(L=>`<button class="btn btn-sm ${_csLang===L?'btn-blue':'btn-ghost'}"
          data-mfg-lang="${L}" ${_csLang===L?'disabled':''}>${_CS_LANG_NAMES[L]}</button>`).join('')}
    </span>
    <button class="btn btn-sm btn-ghost" id="btn-mfg-edit">✎ ${esc(T('Edit'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-mfg-print">🖨 ${esc(T('Print'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-mfg-back">← ${esc(T('Back'))}</button>`);

  setContent(`<div id="cs-sheet" class="cs-sheet" dir="${_csRTL()?'rtl':'ltr'}">
    ${_mfgEditing?`<div class="cs-edit-bar"><b>✎ ${esc(T('Editing'))}</b>
      <span>${esc(T('This document is independent of the cut & strip specification it came from — saving here changes nothing there.'))}</span></div>`:''}

    <div class="cs-form-head">
      <div class="cs-form-co">${S.companyLogoB64?`<img src="${S.companyLogoB64}" alt="">`:`<div class="cs-form-co-n">${esc(companyName||'')}</div>`}</div>
      <div class="cs-form-t">
        <div class="cs-form-t1">${esc(T('Manufacturing instructions'))}</div>
        <div class="cs-form-t2 cs-ltr">${_mfgF('title', d.title, {ph:T('Assembly name')})}</div>
      </div>
    </div>

    <h2 class="cs-h2"><span class="cs-n">1</span>${esc(T('Document'))}</h2>
    <div class="cs-pad"><table class="cs-tbl cs-form-tbl">
      <thead><tr><th style="width:18%">${esc(T('Doc no.'))}</th><th style="width:16%">${esc(T('Date'))}</th><th style="width:22%">${esc(T('Customer'))}</th>
        <th style="width:20%">${esc(T('Drawing #'))}</th><th style="width:10%">${esc(T('Rev'))}</th><th style="width:14%">${esc(T('Prepared by'))}</th></tr></thead>
      <tbody><tr>
        <td class="cs-ctr cs-ltr">${_mfgF('doc_no', d.doc_no, {ph:'MI-…'})}</td>
        <td class="cs-ctr cs-ltr">${_mfgF('form_date', d.form_date)}</td>
        <td class="cs-ctr">${_mfgF('customer', d.customer)}</td>
        <td class="cs-ctr cs-ltr">${_mfgF('drawing_number', d.drawing_number)}</td>
        <td class="cs-ctr cs-ltr">${_mfgF('revision', d.revision)}</td>
        <td class="cs-ctr">${_mfgF('prepared_by', d.prepared_by)}</td>
      </tr></tbody></table>
      ${d.standard?`<p class="cs-note cs-ltr">${esc(T('Workmanship'))}: ${esc(d.standard)}</p>`:''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">2</span>${esc(T('Material list'))}</h2>
    <div class="cs-pad"><table class="cs-tbl">
      <thead><tr><th style="width:5%">#</th><th style="width:22%">${esc(T('Part number'))}</th><th style="width:13%">${esc(T('Manufacturer'))}</th>
        <th style="width:39%">${esc(T('Description'))}</th><th style="width:11%">${esc(T('Qty'))}</th><th style="width:10%">${esc(T('Ref'))}</th></tr></thead>
      <tbody>${(d.materials||[]).map((m,i)=>`<tr>
        <td class="cs-ctr">${_mfgRowDel('del-mat',i)}${_mfgF(`materials.${i}.item`, m.item)}</td>
        <td class="cs-ltr">${_mfgF(`materials.${i}.part_number`, m.part_number)}</td>
        <td class="cs-ltr">${_mfgF(`materials.${i}.manufacturer`, m.manufacturer)}</td>
        <td>${_mfgF(`materials.${i}.description`, m.description)}</td>
        <td class="cs-ctr">${_mfgF(`materials.${i}.qty`, m.qty)}</td>
        <td class="cs-ctr cs-ltr">${_mfgF(`materials.${i}.ref`, m.ref)}</td></tr>`).join('')
        || `<tr class="empty-row"><td colspan="6">—</td></tr>`}
      </tbody></table>
      ${_mfgEditing?`<button class="btn btn-sm btn-ghost" style="margin-top:10px" data-mfg-act="add-mat">＋ ${esc(T('Add material'))}</button>`:''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">3</span>${esc(T('Operation sequence'))}</h2>
    <div class="cs-pad">${(d.steps||[]).map((s,i)=>`
      <div class="cs-step">
        <div class="cs-step-n">${esc(String(s.n??(i+1)))}</div>
        <div>
          <h4>${_mfgRowDel('del-step',i)}${_mfgF(`steps.${i}.title`, s.title, {ph:T('Step title')})}</h4>
          <div>${_mfgF(`steps.${i}.body`, s.body, {area:true, rows:3})}</div>
          ${(s.critical||_mfgEditing)?`<div class="cs-crit"><b>${esc(T('CRITICAL'))}:</b> ${_mfgF(`steps.${i}.critical`, s.critical, {area:true})}</div>`:''}
        </div>
      </div>`).join('') || `<p class="cs-note">${esc(T('No steps yet.'))}</p>`}
      ${_mfgEditing?`<button class="btn btn-sm btn-ghost" style="margin-top:12px" data-mfg-act="add-step">＋ ${esc(T('Add step'))}</button>`:''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">4</span>${esc(T('Inspection'))}</h2>
    <div class="cs-pad"><ul class="cs-chk">${(d.inspection||[]).map((c,i)=>
      `<li><span class="cs-b"></span><span>${_mfgRowDel('del-chk',i)}${_mfgF(`inspection.${i}`, c, {area:true})}</span></li>`).join('')
      || `<p class="cs-note">${esc(T('No checks yet.'))}</p>`}</ul>
      ${_mfgEditing?`<button class="btn btn-sm btn-ghost" style="margin-top:12px" data-mfg-act="add-chk">＋ ${esc(T('Add check'))}</button>`:''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">5</span>${esc(T('Tools & consumables'))}</h2>
    <div class="cs-pad"><table class="cs-tbl">
      <thead><tr><th style="width:30%">${esc(T('Tool'))}</th><th style="width:20%">${esc(T('Setting'))}</th><th style="width:50%">${esc(T('Note'))}</th></tr></thead>
      <tbody>${(d.tools||[]).map((t,i)=>`<tr>
        <td>${_mfgRowDel('del-tool',i)}${_mfgF(`tools.${i}.tool`, t.tool)}</td>
        <td class="cs-ctr">${_mfgF(`tools.${i}.setting`, t.setting)}</td>
        <td>${_mfgF(`tools.${i}.note`, t.note)}</td></tr>`).join('')
        || `<tr class="empty-row"><td colspan="3">—</td></tr>`}
      </tbody></table>
      ${_mfgEditing?`<button class="btn btn-sm btn-ghost" style="margin-top:10px" data-mfg-act="add-tool">＋ ${esc(T('Add tool'))}</button>`:''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">6</span>${esc(T('Notes'))}</h2>
    <div class="cs-pad">${_mfgEditing
      ? _mfgF('notes', d.notes, {area:true, rows:3})
      : `<div class="cs-notes-box">${d.notes?esc(d.notes):'&nbsp;'}</div>`}</div>

    <h2 class="cs-h2"><span class="cs-n">7</span>${esc(T('Approval'))}</h2>
    <div class="cs-pad"><table class="cs-tbl cs-form-tbl">
      <thead><tr><th style="width:28%">${esc(T('Name'))}</th><th style="width:26%">${esc(T('Signature'))}</th>
        <th style="width:18%">${esc(T('Date'))}</th><th style="width:28%">${esc(T('Notes'))}</th></tr></thead>
      <tbody>
        <tr><td class="cs-ctr">${_mfgF('prepared_by', d.prepared_by)}<div class="cs-role">${esc(T('Prepared by'))}</div></td>
          <td class="cs-sig-cell"></td><td class="cs-ctr cs-ltr">${_mfgF('prepared_date', d.prepared_date)}</td><td></td></tr>
        <tr><td class="cs-ctr">${_mfgF('approved_by', d.approved_by)}<div class="cs-role">${esc(T('Approved for production'))}</div></td>
          <td class="cs-sig-cell"></td><td class="cs-ctr cs-ltr">${_mfgF('approved_date', d.approved_date)}</td><td></td></tr>
      </tbody></table>
      <div class="cs-foot">
        <span class="cs-ltr">${esc(d.doc_no||'')} ${esc(d.revision?('Rev '+d.revision):'')}${d.drawing_number?' · '+esc(d.drawing_number):''}</span>
        <span class="cs-ltr">${d.edited_by?`✎ ${esc(d.edited_by)} ${esc(String(d.edited_at||'').slice(0,10))} · `:''}v${APP_VER}</span>
      </div>
    </div>
  </div>`);

  document.querySelectorAll('[data-mfg-lang]').forEach(b=>b.addEventListener('click',()=>{
    _csSetLang(b.dataset.mfgLang); renderMfgDoc();
  }));
  document.getElementById('btn-mfg-back')?.addEventListener('click',()=>renderManufacturing());
  document.getElementById('btn-mfg-print')?.addEventListener('click',()=>window.print());
  document.getElementById('btn-mfg-edit')?.addEventListener('click',()=>{
    _mfgBackup=JSON.parse(JSON.stringify(S.mfgCurrent)); _mfgEditing=true; renderMfgDoc();
  });
  document.getElementById('btn-mfg-cancel')?.addEventListener('click',()=>{
    if(!confirm('Discard unsaved changes?')) return;
    if(_mfgBackup) S.mfgCurrent=_mfgBackup;
    else { _mfgEditing=false; _mfgBackup=null; renderManufacturing(); return; }
    _mfgBackup=null; _mfgEditing=false; renderMfgDoc();
  });
  document.getElementById('btn-mfg-save')?.addEventListener('click',_mfgSave);

  // Structural edits collect what is typed first, so adding a row never throws
  // away the edits already made in the other fields.
  document.querySelectorAll('#cs-sheet [data-mfg-act]').forEach(b=>b.addEventListener('click',()=>{
    _mfgCollect();
    const i=parseInt(b.dataset.mfgIdx,10);
    const d2=S.mfgCurrent;
    switch(b.dataset.mfgAct){
      case 'add-mat':  (d2.materials=d2.materials||[]).push({item:(d2.materials.length+1),part_number:'',manufacturer:'',description:'',qty:'',ref:''}); break;
      case 'del-mat':  d2.materials.splice(i,1); break;
      case 'add-step': (d2.steps=d2.steps||[]).push({n:(d2.steps.length+1),title:'',body:'',critical:''}); break;
      case 'del-step': d2.steps.splice(i,1); d2.steps.forEach((s,k)=>s.n=k+1); break;
      case 'add-chk':  (d2.inspection=d2.inspection||[]).push(''); break;
      case 'del-chk':  d2.inspection.splice(i,1); break;
      case 'add-tool': (d2.tools=d2.tools||[]).push({tool:'',setting:'',note:''}); break;
      case 'del-tool': d2.tools.splice(i,1); break;
    }
    renderMfgDoc();
  }));
}
// One generic pass over the form. Every control carries the field it writes to,
// so there is no per-field reader to forget to update when a field is added.
export function _mfgCollect(){
  if(!_mfgEditing || !S.mfgCurrent) return;
  document.querySelectorAll('#cs-sheet [data-mfg-path]').forEach(el=>{
    _csSetPath(S.mfgCurrent, el.dataset.mfgPath, el.value);
  });
}
export async function _mfgSave(){
  const btn=document.getElementById('btn-mfg-save');
  if(btn){ btn.disabled=true; btn.textContent='Saving…'; }
  try{
    _mfgCollect();
    const d=S.mfgCurrent;
    if(!String(d.title||'').trim() && !String(d.doc_no||'').trim())
      throw new Error('Give the document a title or a document number first');
    const id=d._id || _mfgDocId(d);
    const {_id, ...body}=d;
    await writeSpecDoc(id,
      {...body, kind:'mfg', edited_by:S.currentUserEmail||'', edited_at:new Date().toISOString()});
    S.mfgCurrent._id=id;
    logAudit('mfg_saved',{id, steps:(d.steps||[]).length},true);
    mfgDocs=[]; _mfgEditing=false; _mfgBackup=null;
    toast('Manufacturing instruction saved','success');
    renderMfgDoc();
  }catch(e){
    logAudit('mfg_saved',{error:e.message},false);
    toast('Save failed: '+e.message,'error');
    if(btn){ btn.disabled=false; btn.textContent='💾 Save'; }
  }
}
