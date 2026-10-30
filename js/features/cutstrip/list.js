import { S } from '../../core/state.js';
import { companyId } from '../../core/session.js';
import { esc, setActions, setContent, toast } from '../../core/ui.js';
import { deleteSpecDoc, listSpecDocs } from '../../data/specs.js';
import { _csConnectors, _csNormalize, _csNum, _csSegments } from '../../domain/cutstrip.js';
import { _mfgIsDoc } from '../../domain/manufacturing.js';
import { _csEnsureLang, _csLang, _csT } from './i18n.js';
import { openCSFileModal } from './import.js';
import { renderCutStripSheet } from './sheet.js';

export function _csDocId(dwg){
  return String(dwg||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120)
         || ('UNTITLED_'+Date.now());
}

// ── Rendering: list ───────────────────────────────────────────────────────────
export async function loadCutStripSpecs(force){
  if(S.csSpecs.length && !force) return S.csSpecs;
  if(!companyId) return (S.csSpecs=[]);
  const docs=await listSpecDocs();
  // Migrated on read so a spec saved under the old single-cable shape renders
  // through exactly the same code path as one made today.
  // Manufacturing instructions share this collection (see the Manufacturing
  // Instructions screen for why) and are not cut & strip specifications.
  S.csSpecs=docs.filter(d=>!_mfgIsDoc(d)).map(d=>_csNormalize(d));
  return S.csSpecs;
}

export function _csTBCCount(spec){
  let n=0;
  _csSegments(spec).forEach(seg=>{
    (seg.ends||[]).forEach(e=>(e.strip||[]).forEach(x=>{ if(x.confirmed===false) n++; }));
    (seg.allowances||[]).forEach(a=>{ if(a.confirmed===false) n++; });
    if(seg.cut_length_tolerance_confirmed===false && _csNum(seg.cut_length_tolerance_mm)!=null) n++;
    if(seg.trim_allowance_confirmed===false && (_csNum(seg.trim_allowance_mm)||0)!==0) n++;
    if(seg.conductor_strip_confirmed===false && _csNum(seg.conductor_strip_mm)!=null) n++;
  });
  (spec.markers||[]).forEach(m=>{ if(m.confirmed===false) n++; });
  return n;
}


export async function renderCutStrip(){
  S.csCurrent=null;
  setActions(`<button class="btn btn-blue" id="btn-cs-new">＋ New from Drawing</button>`);
  setContent(`<div style="text-align:center;padding:60px"><div class="ring" style="margin:0 auto"></div></div>`);
  document.getElementById('btn-cs-new')?.addEventListener('click',openCSFileModal);

  let list=[];
  try{ list=await loadCutStripSpecs(true); }
  catch(e){ setContent(`<div class="card" style="color:var(--danger)">Could not load saved specifications: ${esc(e.message)}</div>`); return; }

  if(!list.length){
    setContent(`<div class="card" style="max-width:640px;margin:30px auto;text-align:center;padding:40px 30px">
      <div style="font-size:44px;margin-bottom:10px">✂️</div>
      <h3 style="margin-bottom:6px">No cut &amp; strip specifications yet</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
        Upload a cable or harness drawing and the analysis produces a bench-ready sheet:
        verbal steps plus scaled diagrams carrying the actual cut, strip and marker dimensions.</p>
      <button class="btn btn-blue" id="btn-cs-new2">＋ New from Drawing</button>
    </div>`);
    document.getElementById('btn-cs-new2')?.addEventListener('click',openCSFileModal);
    return;
  }

  // Search and sort live here rather than in the query: the list is small and
  // already in memory, so a round trip to re-sort a dozen rows would be slower
  // than the keystroke that asked for it.
  const COLS=[
    {k:'drawing_number', h:'Drawing #',       v:s=>s.drawing_number||s._id||''},
    {k:'drawing_name',   h:'Name',            v:s=>s.drawing_name||s.title||''},
    {k:'project',        h:'Project',         v:s=>s.project||''},
    {k:'runs',           h:'Runs',            v:s=>_csSegments(s).length,  num:true, mid:true},
    {k:'connectors',     h:'Connectors',      v:s=>_csConnectors(s).length,num:true, mid:true},
    {k:'tbc',            h:'Unverified dims', v:s=>_csTBCCount(s),         num:true, mid:true},
    {k:'updated',        h:'Updated',         v:s=>s.updatedAt?.toDate ? s.updatedAt.toDate().getTime() : 0, num:true},
  ];
  let wireRowButtons=()=>{};
  const paint=()=>{
    const q=_csListQuery.trim().toLowerCase();
    // Every word must appear somewhere in the row, so a second word narrows
    // instead of widening — the behaviour the other tables already have.
    const words=q ? q.split(/\s+/) : [];
    let rows=list.filter(sp=>{
      if(!words.length) return true;
      const hay=(COLS.map(c=>String(c.v(sp))).join(' ')+' '+
                 _csConnectors(sp).map(c=>c.ref||'').join(' ')).toLowerCase();
      return words.every(w=>hay.includes(w));
    });
    const col=COLS.find(c=>c.k===_csListSort.k);
    if(col){
      const dir=_csListSort.dir;
      rows=rows.slice().sort((a,b)=>{
        const x=col.v(a), y=col.v(b);
        const r=col.num ? (x-y) : String(x).localeCompare(String(y),undefined,{numeric:true});
        return dir==='asc' ? r : -r;
      });
    }
    const arrow=k=>_csListSort.k===k ? (_csListSort.dir==='asc'?' ▲':' ▼') : '';
    const body=document.getElementById('cs-list-body');
    body.innerHTML = rows.length ? rows.map(s=>{
      const tbc=_csTBCCount(s);
      return `<tr>
        <td style="font-weight:700">${esc(s.drawing_number||s._id)}</td>
        <td class="cs-ltr" style="font-size:12.5px">${esc(s.drawing_name||s.title||'')}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(s.project||'')}</td>
        <td style="text-align:center">${_csSegments(s).length||'—'}</td>
        <td style="text-align:center">${_csConnectors(s).length||'—'}</td>
        <td style="text-align:center">${tbc
            ? `<span style="background:#DC2626;color:#fff;border-radius:3px;padding:2px 8px;font-size:11px;font-weight:700">${tbc} TBC</span>`
            : `<span style="color:#15803D;font-weight:700">✓</span>`}</td>
        <td style="font-size:12px;color:var(--muted)">${s.updatedAt?.toDate ? esc(s.updatedAt.toDate().toLocaleString()) : ''}</td>
        <td style="text-align:right">
          <button class="btn btn-sm btn-blue cs-open" data-id="${esc(s._id)}">Open</button>
          <button class="btn btn-sm btn-ghost cs-del" data-id="${esc(s._id)}">🗑</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="8" style="text-align:center;padding:26px;color:var(--muted)">
        ${esc(_csT('No saved specification matches that search.'))}</td></tr>`;
    document.getElementById('cs-list-count').textContent=`${rows.length} / ${list.length}`;
    document.querySelectorAll('#cs-list-head th[data-k]').forEach(th=>{
      th.textContent = COLS.find(c=>c.k===th.dataset.k).h + arrow(th.dataset.k);
    });
    wireRowButtons();
  };

  setContent(`<div class="card">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div class="search-wrap" style="position:relative">
        <input id="cs-search" class="search-box" placeholder="${esc(_csT('Search saved specifications…'))}"
               value="${esc(_csListQuery)}" style="padding-inline-end:26px">
        <button id="cs-search-x" title="${esc(_csT('Clear'))}"
                style="position:absolute;inset-inline-end:6px;top:50%;transform:translateY(-50%);
                       border:0;background:none;cursor:pointer;color:var(--muted);font-size:15px;
                       display:${_csListQuery?'block':'none'}">✕</button>
      </div>
      <span id="cs-list-count" style="font-size:12px;color:var(--muted)"></span>
    </div>
    <table class="tbl"><thead><tr id="cs-list-head">
      ${COLS.map(c=>`<th data-k="${c.k}" style="cursor:pointer;user-select:none${c.mid?';text-align:center':''}"
         title="${esc(_csT('Sort by this column'))}">${esc(c.h)}</th>`).join('')}
      <th style="width:150px"></th>
    </tr></thead><tbody id="cs-list-body"></tbody></table></div>`);

  wireRowButtons=()=>{
    document.querySelectorAll('.cs-open').forEach(b=>b.addEventListener('click',async()=>{
      const s=S.csSpecs.find(x=>x._id===b.dataset.id);
      if(!s) return;
      S.csCurrent=s; S._csEditing=false; S._csEditBackup=null;
      // Hebrew is the default, so the translation has to be in hand BEFORE the
      // first paint — otherwise the sheet flashes up half English.
      b.disabled=true; b.textContent=_csT('Translating…');
      await _csEnsureLang(s, _csLang);
      renderCutStripSheet();
    }));
    document.querySelectorAll('.cs-del').forEach(b=>b.addEventListener('click',async()=>{
      const s=S.csSpecs.find(x=>x._id===b.dataset.id);
      if(!s || !confirm(`Delete the cut & strip specification for ${s.drawing_number||s._id}?`)) return;
      try{
        await deleteSpecDoc(s._id);
        toast('Specification deleted','success');
        renderCutStrip();
      }catch(e){ toast('Error: '+e.message,'error'); }
    }));
  };

  document.querySelectorAll('#cs-list-head th[data-k]').forEach(th=>{
    th.addEventListener('click',()=>{
      const k=th.dataset.k;
      // The same column toggles direction; a new one starts ascending, except
      // the date and the unverified count, where the interesting end is the top.
      _csListSort = (_csListSort.k===k)
        ? {k, dir:_csListSort.dir==='asc'?'desc':'asc'}
        : {k, dir:(k==='updated'||k==='tbc')?'desc':'asc'};
      paint();
    });
  });
  const box=document.getElementById('cs-search');
  box?.addEventListener('input',()=>{
    _csListQuery=box.value;
    document.getElementById('cs-search-x').style.display = _csListQuery ? 'block' : 'none';
    paint();                       // no re-render, so the cursor never jumps
  });
  document.getElementById('cs-search-x')?.addEventListener('click',()=>{
    _csListQuery=''; box.value='';
    document.getElementById('cs-search-x').style.display='none'; box.focus(); paint();
  });
  paint();
}
// Search text and sort order for the saved-specs list. Kept outside the render
// so deleting a row, or coming back from a sheet, lands you where you were.
export let _csListQuery='', _csListSort={k:'updated', dir:'desc'};
