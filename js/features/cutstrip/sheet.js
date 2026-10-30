import { S } from '../../core/state.js';
import { logAudit } from '../../core/audit.js';
import { companyName } from '../../core/session.js';
import { esc, setActions, setContent, toast } from '../../core/ui.js';
import { APP_VER } from '../../core/version.js';
import { writeSpecDoc } from '../../data/specs.js';
import { _CS_BASIS_LABEL, _CS_BASIS_OVER, _csAssignedRefs, _csBreakouts, _csConnectors, _csCutLength, _csDatum, _csEndLegs, _csKnownNumbers, _csMM, _csNum, _csOverall, _csPinout, _csR, _csRecomputeDerived, _csRouteMismatches, _csSegEnds, _csSegLabel, _csSegments, _csSetPath, _csStripSummary, _csSyncCutLength, _csToday, _csWireBuild } from '../../domain/cutstrip.js';
import { _csBackfillDatasheets, _csPartDocLink } from './datasheets.js';
import { _csHarnessSVG, _csSourceFigure, _csStripSVG } from './figures.js';
import { _CS_LABELS, _CS_LANG_NAMES, _csCache, _csEnsureLang, _csLang, _csP, _csProseStrings, _csRTL, _csSetLang, _csSrcLang, _csT } from './i18n.js';
import { _csTBCCount, renderCutStrip } from './list.js';
import { _csExportPDF } from '../../io/pdfExport.js';

export function _csCutFormula(seg, spec){
  const r=_csCutLength(seg, spec);
  if(!r.hasBreakdown) return '';
  const parts=[`${r.finished}`]
    // Each end is spelled out as strip + margin, so the operator can see both
    // numbers and check them against the strip table rather than trusting a total.
    .concat((r.endCosts||[]).map(e=>
      r.basis===_CS_BASIS_OVER
        ? (e.conn ? `− ${e.conn} (${e.ref||e.code})` : '')
        : `+ ${e.strip} + ${e.margin} (${e.ref||e.code})`).filter(Boolean))
    .concat(r.allowances.map(a=>`${a.mm<0?'−':'+'} ${Math.abs(a.mm)}${a.ref?` (${a.ref})`:''}`))
    .concat(r.trim ? [`+ ${r.trim} (${_csT('trim')})`] : []);
  return `${parts.join(' ')} = ${r.total} mm`;
}
export function _csNumberConflicts(spec){
  const known=_csKnownNumbers(spec), out=[];
  const scan=(text, where)=>{
    String(text||'').replace(/(\d+(?:[.,]\d+)?)\s*(?:mm|מ״מ|מ"מ|מ׳׳מ)/gi, (m,d)=>{
      const v=_csR(parseFloat(String(d).replace(',','.')));
      if(v!=null && !known.has(v)) out.push({value:v, where, text:String(text).slice(0,120)});
      return m;
    });
  };
  (spec?.steps||[]).forEach((st,i)=>{ scan(st.title,`${_csT('Step')} ${st.n??i+1}`);
    scan(st.body,`${_csT('Step')} ${st.n??i+1}`); scan(st.critical,`${_csT('Step')} ${st.n??i+1}`); });
  (spec?.inspection||[]).forEach(t=>scan(t, _csT('Inspection')));
  (spec?.engineering_notes||[]).forEach(nt=>scan(nt.action, _csT('Engineering notes from the drawing')));
  // one report per distinct number, not one per mention
  const seen=new Set();
  return out.filter(o=>{ const k=o.value+'|'+o.where; if(seen.has(k)) return false; seen.add(k); return true; });
}
// ── Step by step ──────────────────────────────────────────────────────────────
// The same facts as the tables, told in the order the bench does them: cut the
// cable, then side A, then side B, each end in its own words — jacket, then
// the conductors, then what goes on their tips. This is the part of the sheet
// an operator actually reads while working; the tables are there to check it
// against. Everything here is DERIVED from the specification, never written
// separately, so the two can never say different things.
export function _csStepsFor(spec){
  const T=_csT, steps=[];
  const tbc=v=>v===false ? ' *' : '';
  _csSegments(spec).forEach(seg=>{
    const cut=_csCutLength(seg, spec);
    const build=_csWireBuild(seg, spec);
    const cable=[seg.cable_part_number, seg.cable_description].map(x=>String(x||'').trim()).filter(Boolean).join(' — ');
    if(!build && cut && _csNum(cut.total)!=null)
      steps.push({title:_csSay('Cut the cable'), items:[
        _csSay('Cut {cable} to {len}.', {cable:cable||seg.id||'', len:_csMM(cut.total)})
        + (cut.basis===_CS_BASIS_OVER ? ` <span class="cs-step-why">${esc(T('The length includes the connectors; nothing is added for the ends.'))}</span>` : '')]});
    (_csSegEnds(seg, spec)||[]).forEach(e=>{
      if(e._breakout) return;
      const conn=_csConnectors(spec).find(c=>String(c.ref||'').toUpperCase()===String(e.ref||'').toUpperCase());
      const what=conn ? [conn.description, conn.part_number].map(x=>String(x||'').trim()).filter(Boolean).join(' · ') : '';
      const items=[];
      (e.strip||[]).filter(x=>!x.derived && _csNum(x.value_mm)!=null).forEach((x,i)=>{
        const txt = i===0
          ? _csSay('Strip {mm} of the outer jacket.', {mm:_csMM(x.value_mm)+tbc(x.confirmed)})
          : _csSay('{label}: {mm}.', {label:_csP(x.label||x.code||''), mm:_csMM(x.value_mm)+tbc(x.confirmed)});
        const why = x.confirmed!==false && String(x.basis||'').trim() && !x.proposed
          ? ` <span class="cs-step-why">${esc(_csP(x.basis))}</span>` : '';
        items.push(txt+why);
      });
      const legs=_csEndLegs(e);
      if(legs.length){
        // A Map, not an object: numeric keys on an object come back sorted,
        // which listed T2/T3 before T1 — not the order the drawing gives them.
        const byLen=new Map();
        legs.forEach(l=>{ const k=String(_csNum(l.length_mm)??'?'); if(!byLen.has(k)) byLen.set(k,[]); byLen.get(k).push(l); });
        const keys=[...byLen.keys()];
        if(keys.length>1 || keys[0]!=='?')
          items.push(_csSay('Trim the conductors, measured from the jacket end:')
            + ' ' + keys.map(k=>`<span style="unicode-bidi:isolate;white-space:nowrap"><b>${
                byLen.get(k).map(l=>esc([l.to, l.conductor&&`(${l.conductor})`].filter(Boolean).join(' '))).join(', ')
              }</b> — ${esc(k==='?'?'—':_csMM(k))}${tbc(byLen.get(k)[0].confirmed)}</span>`).join(' · '));
        const byStrip={};
        legs.filter(l=>_csNum(l.strip_mm)!=null).forEach(l=>{
          const k=`${_csNum(l.strip_mm)}|${l.terminal_pn||''}`; (byStrip[k]=byStrip[k]||[]).push(l); });
        Object.keys(byStrip).forEach(k=>{
          const [mm, pn]=k.split('|'); const g=byStrip[k];
          items.push(pn
            ? _csSay('Strip {mm} at the tip of each conductor and crimp terminal {pn}.', {mm:_csMM(mm)+tbc(g[0].confirmed), pn})
            : _csSay('Strip {mm} at the tip of each conductor.', {mm:_csMM(mm)+tbc(g[0].confirmed)}));
        });
      } else if(_csNum(seg.conductor_strip_mm)!=null){
        const pn=conn && (conn.contact_pn || conn.part_number);
        items.push(pn
          ? _csSay('Strip {mm} from each conductor for the contacts of {pn}.', {mm:_csMM(seg.conductor_strip_mm)+tbc(seg.conductor_strip_confirmed), pn})
          : _csSay('Strip {mm} from each conductor.', {mm:_csMM(seg.conductor_strip_mm)+tbc(seg.conductor_strip_confirmed)}));
      }
      if(items.length)
        steps.push({title:_csSay('Prepare end {ref}', {ref:e.ref||''}) + (what?` <span class="cs-step-sub">${esc(what)}</span>`:''), items});
    });
  });
  return steps;
}
export function _csStepsHtml(spec){
  const T=_csT, steps=_csStepsFor(spec), pins=_csPinout(spec);
  if(!steps.length) return '';
  const anyTbc=/\s\*<\/span>|\s\*</.test(steps.map(s=>s.items.join('')).join(''));
  return `
      <h3 class="cs-h3">${esc(T('Cutting and stripping, step by step'))}</h3>
      ${pins.length ? `<table class="cs-tbl cs-form-tbl" style="max-width:520px;margin-bottom:12px">
        <thead><tr><th>${esc(T('Pin'))}</th><th>${esc(T('Colour'))}</th><th>${esc(T('To'))}</th></tr></thead>
        <tbody>${pins.map(r=>`<tr><td class="cs-ctr cs-ltr">${esc(r.from||'—')}</td>
          <td class="cs-ctr cs-ltr">${esc(r.color||'—')}</td><td class="cs-ctr cs-ltr">${esc(r.to||'—')}</td></tr>`).join('')}</tbody>
      </table>` : ''}
      <ol class="cs-steps">${steps.map(st=>`<li><div class="cs-step-t">${st.title}</div>
        <ol class="cs-do">${st.items.map(i=>`<li>${i}</li>`).join('')}</ol></li>`).join('')}</ol>
      ${anyTbc ? `<p class="cs-note">* ${esc(T('To be confirmed against the contact or terminal datasheet before cutting.'))}</p>` : ''}`;
}
export function _csStripRows(spec){
  const out=[];
  _csSegments(spec).forEach(seg=>{
    (_csSegEnds(seg, spec)||[]).forEach(e=>{
      (e.strip||[]).filter(x=>!x.derived && _csNum(x.value_mm)!=null).forEach(x=>
        out.push({seg:seg.id, ref:e.ref, code:x.code, label:x.label, mm:x.value_mm,
                  ok:x.confirmed!==false, proposed:x.proposed===true, basis:x.basis||''}));
    });
    (_csSegEnds(seg, spec)||[]).forEach(e=>{
      _csEndLegs(e).filter(l=>_csNum(l.strip_mm)!=null).forEach(l=>
        out.push({seg:seg.id, ref:`${e.ref||''} → ${l.to||l.conductor||''}`, code:'W',
                  label:[l.conductor, l.terminal_pn].filter(Boolean).join(' · '),
                  mm:l.strip_mm, ok:l.confirmed!==false, proposed:false, basis:''}));
    });
    if(_csNum(seg.conductor_strip_mm)!=null)
      out.push({seg:seg.id, ref:_csT('each conductor'), code:'W', label:_csT('Insulation removed from each individual conductor for its contact'),
                mm:seg.conductor_strip_mm, ok:seg.conductor_strip_confirmed!==false,
                proposed:seg.conductor_strip_proposed===true});
  });
  return out;
}
export function _csFormRows(spec){
  return _csSegments(spec).map(seg=>{
    const cut=_csCutLength(seg, spec);
    const st=_csStripSummary(seg, spec);
    return {
      id: seg.id||'',
      pn: seg.cable_part_number||'',
      desc: seg.cable_description || _csSegLabel(seg) || '',
      cut: _csNum(cut.total),
      formula: cut.hasBreakdown ? _csCutFormula(seg, spec) : '',
      strip: st.text,
      tbc: st.tbc,
      qty: _csNum(seg.qty)!=null ? _csNum(seg.qty) : 1,
    };
  });
}

// ── Rendering: the sheet ──────────────────────────────────────────────────────
// A whole sentence, translated whole, with its numbers dropped in afterwards.
// Stitching a line out of "Cut" + "of" + "into" gives a phrasebook, not a
// sentence: in Hebrew those words each want a different form depending on what
// follows them, and the result read like an instruction manual translated by a
// machine. The placeholders are escaped; the sentence is not, so a translation
// can put a number in bold where that language wants the emphasis.
// The emphasis is a span, not a <b>: inside .cs-box a <b> is display:block,
// which took "Cut 12000 mm of 55A0111-22-0" and stacked it down the page one
// value per line. And it is bidi-isolated rather than forced LTR, so a number
// or a part number keeps its own direction inside a Hebrew sentence without
// dragging the words after it across the page.
export function _csSay(tpl, vars){
  const txt=esc(_csT(tpl));
  return txt.replace(/\{(\w+)\}/g, (m,k)=>
    Object.prototype.hasOwnProperty.call(vars||{}, k)
      ? `<span style="font-weight:800;unicode-bidi:isolate">${esc(String(vars[k]))}</span>` : m);
}
export function _csTBC(){ return `<span class="cs-tag cs-tbc">${esc(_csT('TO BE CONFIRMED'))}</span>`; }
export function _csDim(value, confirmed){
  const v=_csNum(value);
  const txt = v==null ? '—' : v+' mm';
  return confirmed===false
    ? `<span style="color:#DC2626;font-weight:700">${esc(txt)}</span> ${_csTBC()}`
    : `<span style="font-weight:700">${esc(txt)}</span>`;
}

// Renders a value as plain text, or as an input when editing.
export function _csFNum(path, value, unit){
  if(!S._csEditing) return `<span class="cs-ltr">${esc(_csNum(value)==null?'—':value+(unit||''))}</span>`;
  return `<input class="cs-in cs-in-num" type="number" step="any" data-cs-path="${esc(path)}" data-cs-type="num"
            value="${_csNum(value)==null?'':esc(value)}">${unit?`<span class="cs-unit">${esc(unit)}</span>`:''}`;
}
// Language-independent strings — part numbers, refs, codes, settings. Saved as
// typed, in whatever language the sheet happens to be showing.
export function _csFRaw(path, value){
  if(!S._csEditing) return esc(value||'');
  return `<input class="cs-in cs-ltr" type="text" data-cs-path="${esc(path)}" data-cs-type="raw" value="${esc(value||'')}">`;
}
// Prose. Displayed translated; edited in whatever language is on screen. See
// _csCollectEdits for where the edit actually lands.
export function _csFText(path, source, multiline){
  const shown=_csP(source||'');
  if(!S._csEditing) return esc(shown);
  const a=`data-cs-path="${esc(path)}" data-cs-type="text" data-cs-en="${esc(source||'')}"`;
  return multiline
    ? `<textarea class="cs-in" rows="${Math.min(6,Math.max(2,Math.ceil((shown.length||1)/90)))}" ${a}>${esc(shown)}</textarea>`
    : `<input class="cs-in" type="text" ${a} value="${esc(shown)}">`;
}
export function _csFChk(path, checked, label){
  if(!S._csEditing) return '';
  return `<label class="cs-chk-lbl"><input type="checkbox" data-cs-path="${esc(path)}" data-cs-type="bool"
            ${checked===true?'checked':''}> ${esc(label)}</label>`;
}
export function _csDelBtn(act, idx){
  return S._csEditing ? `<button class="cs-del-btn" data-cs-act="${esc(act)}" data-cs-idx="${idx}"
    title="${esc(_csT('Remove'))}">✕</button>` : '';
}

// One pass over the DOM, writing every control back into csCurrent.
export function _csCollectEdits(){
  const spec=S.csCurrent; if(!spec) return;
  spec.overrides = spec.overrides || {};
  document.querySelectorAll('#cs-sheet [data-cs-path]').forEach(el=>{
    const path=el.dataset.csPath, type=el.dataset.csType;
    if(type==='bool'){ _csSetPath(spec, path, !!el.checked); return; }
    if(type==='num'){
      const v=el.value.trim();
      _csSetPath(spec, path, v==='' ? null : (Number.isFinite(parseFloat(v))?parseFloat(v):null));
      return;
    }
    if(type==='raw'){ _csSetPath(spec, path, el.value.trim()); return; }
    // type === 'text'
    const src=el.dataset.csEn||'';                 // the STORED text this field renders
    const val=(el.value!=null?el.value:el.textContent).trim();
    if(_csLang===_csSrcLang(spec)){
      // Editing in the language the spec is written in — this IS the source, so
      // write it straight through.
      if(val===src) return;
      _csSetPath(spec, path, val);
      // The old source string is gone, so any translation stored against it is
      // orphaned. Drop it rather than shipping wording that can never be reached.
      ['he','ru','en'].forEach(L=>{ if(spec.overrides[L]) delete spec.overrides[L][src]; });
    } else {
      // Editing a translation — keep the source intact and save the corrected
      // wording against it, so the fix survives re-opening.
      if(val===_csP(src)) return;
      (spec.overrides[_csLang] = spec.overrides[_csLang] || {})[src] = val;
    }
  });
  _csSegments(spec).forEach(seg=>(seg.ends||[]).forEach(_csRecomputeDerived));
  _csSyncCutLength(spec);
}

export function _csEnterEdit(){
  S._csEditBackup=JSON.parse(JSON.stringify(S.csCurrent));
  S._csEditing=true;
  renderCutStripSheet();
}
export function _csCancelEdit(){
  if(S._csEditBackup) S.csCurrent=S._csEditBackup;
  S._csEditBackup=null; S._csEditing=false;
  renderCutStripSheet();
}
export async function _csSaveSpec(){
  const btn=document.getElementById('btn-cs-save');
  if(btn){ btn.disabled=true; btn.textContent=_csT('Saving…'); }
  try{
    _csCollectEdits();
    const {_id, ...body}=S.csCurrent;
    await writeSpecDoc(_id,
      {...body, edited_by:S.currentUserEmail||'', edited_at:new Date().toISOString()});
    S.csCurrent.edited_by=S.currentUserEmail||'';
    S.csCurrent.edited_at=new Date().toISOString();
    logAudit('cut_strip_edited',{drawing:S.csCurrent.drawing_number, unverified:_csTBCCount(S.csCurrent)},true);
    S.csSpecs=[];                       // list is now stale
    S._csEditBackup=null; S._csEditing=false;
    toast('Specification saved','success');
    renderCutStripSheet();
  }catch(e){
    logAudit('cut_strip_edited',{drawing:S.csCurrent?.drawing_number, error:e.message},false);
    toast('Save failed: '+e.message,'error');
    // Deliberately stays in edit mode — dropping the user's unsaved changes
    // because the network hiccuped would be worse than the failed save.
    if(btn){ btn.disabled=false; btn.textContent='💾 '+_csT('Save'); }
  }
}

export function renderCutStripSheet(){
  const spec=S.csCurrent; if(!spec){ renderCutStrip(); return; }
  const T=_csT, rtl=_csRTL();
  const tbc=_csTBCCount(spec);

  // Print and PDF are hidden while editing: exporting a half-typed sheet is
  // never what someone means to do, and an unsaved export is a document that
  // exists nowhere in the system.
  setActions(S._csEditing ? `
    <button class="btn btn-sm btn-blue" id="btn-cs-save">💾 ${esc(T('Save'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-cs-cancel">${esc(T('Cancel'))}</button>` : `
    <span style="display:inline-flex;gap:4px;margin-inline-end:10px">
      ${['en','he','ru'].map(L=>`<button class="btn btn-sm ${_csLang===L?'btn-blue':'btn-ghost'}"
          data-cs-lang="${L}" ${_csLang===L?'disabled':''}>${_CS_LANG_NAMES[L]}</button>`).join('')}
    </span>
    <button class="btn btn-sm btn-ghost" id="btn-cs-edit">✎ ${esc(T('Edit'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-cs-print">🖨 ${esc(T('Print'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-cs-pdf">📄 ${esc(T('Export PDF'))}</button>
    <button class="btn btn-sm btn-ghost" id="btn-cs-back">← ${esc(T('Back'))}</button>`);

  const layers=spec.cable?.layers||[];
  const ends=spec.ends||[];

  // ── The sheet, laid out as the shop's own form ──────────────────────────
  // This screen used to print everything the analysis produced — material
  // lists, operation steps, inspection checks, tooling, wiring tables — and the
  // person at the bench had to find two numbers in eleven pages. It is now the
  // works' "Wire & cable cutting and stripping form" and nothing else: who
  // planned it, what to cut, what to strip, the figures, and a signature block.
  //
  // Everything that left this sheet is manufacturing instruction, not cutting
  // instruction, and lives on the Manufacturing Instructions screen — one click
  // away, through "Send to Manufacturing Instructions".
  setContent(`<div id="cs-sheet" class="cs-sheet" dir="${rtl?'rtl':'ltr'}">

    ${S._csEditing ? `<div class="cs-edit-bar">
      <b>✎ ${esc(T('Editing'))}</b>
      <span>${esc(T('Tick Confirmed once a dimension is verified against a datasheet — the red TBC marking disappears from the sheet and the diagrams.'))}</span>
      <span class="cs-edit-lang">${esc(T(_csLang===_csSrcLang(spec)
        ? 'You are editing the specification itself. Saved translations of any line you change will be re-translated.'
        : 'You are editing a translation. The original is left unchanged and your wording is saved for this specification.'))}</span>
    </div>` : ''}

    <div class="cs-form-head">
      <div class="cs-form-co">${S.companyLogoB64
        ? `<img src="${S.companyLogoB64}" alt="">`
        : `<div class="cs-form-co-n">${esc(companyName||'')}</div>`}</div>
      <div class="cs-form-t">
        <div class="cs-form-t1">${esc(T('Wire & cable cutting and stripping form'))}</div>
        <div class="cs-form-t2 cs-ltr">${esc(spec.drawing_name||spec.title||'')}</div>
      </div>
    </div>

    <h2 class="cs-h2"><span class="cs-n">1</span>${esc(T('Planning'))}</h2>
    <div class="cs-pad"><table class="cs-tbl cs-form-tbl">
      <thead><tr>
        <th style="width:15%">${esc(T('Date'))}</th>
        <th style="width:27%">${esc(T('Customer'))}</th>
        <th style="width:13%">${esc(T('Revision'))}</th>
        <th style="width:25%">${esc(T('Part number'))}</th>
        <th style="width:20%">${esc(T('Approved by'))}</th>
      </tr></thead>
      <!-- Its own field, not a second input on approved_by: two controls writing
           one field means whichever the collector reached last silently wins,
           and the other person's typing disappears. -->
      <tbody><tr>
        <td class="cs-ctr cs-ltr">${_csFRaw('form_date', spec.form_date || _csToday())}</td>
        <td class="cs-ctr">${_csFRaw('customer', spec.customer || spec.project || '')}</td>
        <td class="cs-ctr cs-ltr">${_csFRaw('revision', spec.revision)}</td>
        <td class="cs-ctr cs-ltr"><b>${_csFRaw('drawing_number', spec.drawing_number)}</b></td>
        <td class="cs-ctr">${_csFRaw('planning_approval', spec.planning_approval)}</td>
      </tr></tbody></table>
      <p class="cs-note cs-ltr">${esc(T('Spec no.'))}: ${esc(spec.spec_no||'—')}
        ${spec.source_file?` · ${esc(T('Drawing'))}: ${esc(spec.source_file)}`:''}
        ${spec.standard?` · ${esc(T('Workmanship'))}: ${esc(spec.standard)}`:''}</p>
    </div>

    <h2 class="cs-h2"><span class="cs-n">2</span>${esc(T('Harness layout'))}</h2>
    <div class="cs-pad">
      <div class="cs-box cs-info" style="border-color:#2563EB;background:#EFF6FF;color:#1E3A8A">
        <b>${esc(T('This harness has'))} ${_csSegments(spec).length} ${esc(T('cable run(s)'))} ${esc(T('and'))} ${_csConnectors(spec).length} ${esc(T('connector(s)'))}${
          _csBreakouts(spec).length?` + ${_csBreakouts(spec).length} ${esc(T('Breakout'))}`:''}.</b>
        <p>${_csSegments(spec).map(s=>`<span class="cs-ltr">${esc(s.id)}: ${esc(_csSegLabel(s))}</span>`).join(' &nbsp;·&nbsp; ')}</p>
      </div>
      ${_csAssignedRefs(spec).length ? `
      <div class="cs-box cs-warn">
        <b>${esc(T('These names are not printed on the drawing'))}</b>
        <p>${esc(T('The drawing gives no designator for them, so this sheet assigned one. Match them by position, not by looking for the label.'))}</p>
        <ul>${_csAssignedRefs(spec).map(a=>`<li><span class="cs-ltr"><b>${esc(a.ref)}</b></span>${
          a.desc?` — ${esc(_csP(a.desc))}`:''}${a.seen?` <span style="color:#64748B">(${esc(T('seen on the drawing as'))}: ${esc(a.seen)})</span>`:''}</li>`).join('')}</ul>
      </div>` : ''}
      ${(()=>{ const ov=_csOverall(spec); if(ov.value==null) return '';
        return `<div class="cs-box cs-info" style="border-color:#0F172A;background:#F8FAFC;color:#0F172A">
          <b>${esc(T('Overall length of the whole harness'))}: <span class="cs-ltr">${esc(_csMM(ov.value))}</span></b>
          ${ov.span?`<span class="cs-ltr" style="font-size:12px;color:#64748B"> (${esc(ov.span)})</span>`:''}
          ${ov.mismatch?`<p style="color:#B45309;font-weight:700">${esc(T('The drawing states'))}
            <span class="cs-ltr">${ov.mismatch.stated} mm</span>, ${esc(T('but the longest route through this harness is'))}
            <span class="cs-ltr">${ov.mismatch.longest} mm</span> — ${esc(T('confirm before cutting.'))}</p>`:''}
        </div>`; })()}
      ${spec.source_image ? _csSourceFigure(spec) : `<figure class="cs-fig">${_csHarnessSVG(spec)}</figure>`}
      ${_csRouteMismatches(spec).length ? `
      <div class="cs-box cs-stop" style="margin-top:12px">
        <b>${esc(T('A dimension on the drawing does not match the runs below'))}</b>
        <ul>${_csRouteMismatches(spec).map(m=>`<li><span class="cs-ltr"><b>${esc(m.from)} → ${esc(m.to)}</b>:
          ${esc(T('drawing says'))} <b>${m.drawn} mm</b>, ${esc(T('the runs add up to'))} <b>${m.got} mm</b></span>
          ${m.what?` — ${esc(T(m.what))}`:''}</li>`).join('')}</ul>
        <p>${esc(T('The drawing is the authority. Fix the run lengths before cutting — a run split at the wrong point cuts wire short, and short wire is scrap.'))}</p>
      </div>` : ''}
    </div>

    <h2 class="cs-h2"><span class="cs-n">3</span>${esc(T('Execution — cut & strip'))}</h2>
    <div class="cs-pad">
      <table class="cs-tbl cs-form-tbl">
        <thead><tr>
          <th style="width:16%">${esc(T('Part number'))}</th>
          <th style="width:28%">${esc(T('Description'))}</th>
          <th style="width:12%">${esc(T('Length [mm]'))}</th>
          <th style="width:14%">${esc(T('Strip [mm]'))}</th>
          <th style="width:8%">${esc(T('Qty'))}</th>
          <th style="width:11%">${esc(T('Date'))}</th>
          <th style="width:11%">${esc(T('Operator'))}</th>
        </tr></thead>
        <tbody>${_csFormRows(spec).map(r=>`<tr>
          <td class="cs-ltr">${esc(r.pn||'')}</td>
          <td><span class="cs-ltr">${esc(r.id)}</span> — ${esc(_csP(r.desc||''))}
            ${r.formula?`<div class="cs-formula cs-ltr">${esc(r.formula)}</div>`:''}</td>
          <td class="cs-ctr cs-ltr"><b style="font-size:15px;color:#7C2D12">${esc(r.cut==null?'—':String(r.cut))}</b></td>
          <td class="cs-ctr cs-ltr"><b>${esc(r.strip||'—')}</b>${r.tbc?` <span class="cs-tag cs-tbc">${esc(T('TBC'))}</span>`:''}</td>
          <td class="cs-ctr cs-ltr">${esc(String(r.qty??1))}</td>
          <td></td><td></td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="cs-note">${esc(T('The Length column is what you CUT. It is worked out from the drawing\u2019s dimension and from what that dimension measures — stated per run below. Strip is jacket / conductor.'))}</p>

      ${_csSegments(spec).map((seg,si)=>{
        const cut=_csCutLength(seg, spec);
        const d=cut.datum||_csDatum(seg, spec);
        const build=_csWireBuild(seg, spec);
        return `
        <div class="cs-datum">
          <b class="cs-ltr">${esc(seg.id||'')}</b>
          <span>${esc(T('The drawing\u2019s length is measured'))}:</span>
          ${S._csEditing
            ? `<select class="cs-in" data-cs-path="segments.${si}.length_basis" data-cs-type="raw">
                 ${['to_jacket_end','cable_only','over_connectors','unclear'].map(b=>
                   `<option value="${b}" ${String(seg.length_basis||'unclear')===b?'selected':''}>${esc(T(_CS_BASIS_LABEL[b]))}</option>`).join('')}
               </select>`
            : `<b>${esc(T(d.label))}</b>`}
          ${d.stated ? '' : `<span class="cs-tag cs-tbc">${esc(T('assumed — the drawing does not say'))}</span>`}
        </div>
        ${d.basis===_CS_BASIS_OVER ? `<p class="cs-note">${
          esc(T('The dimension is the finished harness, connectors included — so nothing is added for the ends, each connector body comes OFF, and the piece is never cut longer than the drawn length. The strip is taken OUT of this length, not added to it.'))}${
          ''}${
          cut.capped?` <b>${esc(T('Allowances were held back to keep the piece within the drawn length.'))}</b>`:''}</p>` : ''}
        ${''/* the override itself stays; the sheet no longer argues about it */}
        ${!d.stated ? `<div class="cs-box cs-warn">
          <b>${esc(T('The drawing does not say where the length is measured from'))}</b>
          <p>${esc(d.assumed===_CS_BASIS_OVER
            ? T('Both ends of this run are connectors, so the dimension was taken to span them — the finished harness, connectors included. The piece is therefore cut to the drawn length and no further: the strip comes out of it. If this drawing measures to the jacket end instead, the cable is LONGER than the figure above: set it in Edit before anyone cuts.')
            : T('The shop default was used — to the jacket end at each end, with the connector allowance added. If this drawing dimensions over the connectors instead, the cable is SHORTER than the figure above: set it in Edit before anyone cuts.'))}</p>
        </div>` : ''}

        ${!build && !(spec.materials||[]).length ? `<div class="cs-box cs-stop">
          <b>${esc(T('No part list came back for this drawing'))}</b>
          <p>${esc(T('Without the BOM the sheet cannot say whether this run is a ready-made cable or a bundle built from separate wires, and it cannot work out how many pieces to cut from each reel. Re-run the analysis, or type the wire lines into the materials list in Edit.'))}</p>
        </div>` : ''}
        ${build ? `<div class="cs-box cs-stop">
          <b>${esc(T('This is not a ready-made cable — it is built from individual wires'))}</b>
          <p>${esc(T('Cut the stock below into pieces, then lay the pieces together into the harness.'))}</p>
          <!-- The instruction in the words the bench uses, before any table.
               An operator reading this sheet should not have to derive "cut
               four pieces" from a column headed "Cut into": the sentence that
               tells them what to do at the reel comes first, and the table
               underneath is the checkable arithmetic behind it. -->
          <ol class="cs-do">
            ${build.byPn.map(b=>`<li>${_csSay('Cut {stock} of {pn} into {n} pieces of {each}.', {
              stock:_csMM(b.totalMm), pn:b.pn||'—', n:b.pieces, each:_csMM(build.perWireMm)})}</li>`).join('')}
            <li>${_csSay('Lay the {n} pieces together — that bundle is the harness. Strip and terminate each end out of this length; do not cut any piece longer.',
              {n:build.pieces})}</li>
          </ol>
          <table class="cs-tbl cs-form-tbl" style="margin-top:8px">
            <thead><tr><th style="width:30%">${esc(T('Part number'))}</th>
              <th style="width:20%">${esc(T('On the BOM'))}</th>
              <th style="width:26%">${esc(T('Cut into'))}</th>
              <th style="width:24%">${esc(T('Left over'))}</th></tr></thead>
            <tbody>${build.lines.map(l=>`<tr>
              <td class="cs-ltr">${esc(l.pn||'—')}</td>
              <td class="cs-ctr cs-ltr">${_csMM(l.totalMm)}${l.qty>1?` <span style="color:#64748B">(${l.qty} × ${_csMM(l.reelMm)})</span>`:''}</td>
              <td class="cs-ctr cs-ltr" style="white-space:nowrap"><span style="font-size:16px;font-weight:800">${l.pieces}</span> × <span style="font-size:16px;font-weight:800;color:#7C2D12">${_csMM(build.perWireMm)}</span></td>
              <td class="cs-ctr cs-ltr">${l.leftoverMm?_csMM(l.leftoverMm):'—'}</td>
            </tr>`).join('')}</tbody></table>
          <p style="font-size:14px"><b>${esc(T('The harness is made of'))}:</b>
            ${build.byPn.map(b=>`<span class="cs-ltr" style="font-weight:800;white-space:nowrap">${b.pieces} × ${esc(b.pn||'—')}</span>`).join(' &nbsp;+&nbsp; ')}
            — ${esc(T('each'))} <span class="cs-ltr" style="font-weight:800">${esc(_csMM(build.perWireMm))}</span>
            (${esc(T('total'))} ${build.pieces} ${esc(T('wires'))})
            ${build.conductors?` · ${esc(T('the wiring table lists'))} ${build.conductors} ${esc(T('conductors'))}`:''}</p>
          ${build.conductorMismatch?`<p style="color:#B91C1C;font-weight:700">${
            esc(T('The BOM gives'))} ${build.pieces} ${esc(T('pieces but the wiring table lists'))} ${build.conductorMismatch} —
            ${esc(T('one of the two is wrong. Resolve it before cutting.'))}</p>`:''}
        </div>` : ''}`;}).join('')}

      ${_csStepsHtml(spec)}

      ${(()=>{ const strips=_csStripRows(spec); return strips.length ? `
      <h3 class="cs-h3">${esc(T('Strip detail'))}</h3>
      <table class="cs-tbl"><thead><tr><th style="width:34%">${esc(T('End'))}</th>
        <th style="width:14%">${esc(T('Code'))}</th><th style="width:20%">${esc(T('Value'))}</th>
        <th style="width:32%">${esc(T('Description'))}</th></tr></thead>
        <tbody>${strips.map(x=>`<tr>
          <td class="cs-ltr">${esc(x.seg)} · ${esc(x.ref)}</td>
          <td class="cs-ctr cs-ltr"><b>${esc(x.code)}</b></td>
          <td class="cs-ctr cs-ltr"><b>${esc(_csMM(x.mm))}</b>${x.ok?'':` <span class="cs-tag cs-tbc">${esc(T('TBC'))}</span>`}</td>
          <td style="font-size:12px">${esc(_csP(x.label||''))}
            ${x.proposed?`<div style="font-size:11px;color:#B45309;margin-top:2px">${
              esc(T('Not on the drawing — proposed from the wire gauge. Confirm against the contact datasheet.'))}</div>`:''}</td></tr>`).join('')}
        </tbody></table>` : ''; })()}
    </div>

    ${_csConnectors(spec).length ? `
    <h2 class="cs-h2"><span class="cs-n">4</span>${esc(T('Connectors'))}</h2>
    <div class="cs-pad"><table class="cs-tbl">
      <thead><tr><th style="width:5%">${esc(T('Ref'))}</th><th style="width:7%">${esc(T('Kind'))}</th>
        <th style="width:14%">${esc(T('Part number'))}</th>
        <th style="width:10%">${esc(T('Manufacturer'))}</th><th style="width:5%">${esc(T('Positions'))}</th>
        <th style="width:8%">${esc(T('Termination'))}</th><th style="width:13%">${esc(T('Contact P/N'))}</th>
        <th style="width:26%">${esc(T('Description'))}</th>
        <th style="width:12%">${esc(T('Datasheet'))}</th></tr></thead>
      <tbody>${_csConnectors(spec).map((c,i)=>`<tr>
        <td class="cs-ctr cs-ltr"><b>${esc(c.ref||'')}</b></td>
        <td class="cs-ctr" style="font-size:12px">${esc(T(c.kind==='open_wires'?'Open wires':(c.kind||'connector')))}</td>
        <td>${_csFRaw(`connectors.${i}.part_number`, c.part_number)}</td>
        <td>${_csFRaw(`connectors.${i}.manufacturer`, c.manufacturer)}</td>
        <td class="cs-ctr">${_csFNum(`connectors.${i}.positions`, c.positions, '')}</td>
        <td class="cs-ctr cs-ltr">${esc(c.termination||'—')}</td>
        <td>${_csFRaw(`connectors.${i}.contact_pn`, c.contact_pn)}</td>
        <td>${_csFText(`connectors.${i}.description`, c.description)}
          ${c._inferred?`<span class="cs-tag cs-tbc">${esc(T('not described on the sheet'))}</span>`:''}</td>
        <td>${_csPartDocLink(c.datasheet_url, c.datasheet_url_vendor, c.part_number, c.manufacturer)}
          ${String(c.contact_pn||'').trim()?`<div class="cs-links-sub">${esc(T('Contact'))}:</div>
            ${_csPartDocLink(c.contact_datasheet_url, c.contact_datasheet_url_vendor, c.contact_pn, c.manufacturer)}`:''}</td></tr>`).join('')}
      </tbody></table></div>` : ''}

    <h2 class="cs-h2"><span class="cs-n">5</span>${esc(T('Schematic — cut & strip'))}</h2>
    <div class="cs-pad">
      ${_csSegments(spec).map(seg=>{
        const ends=_csSegEnds(seg, spec);
        const figs=ends.map(e=>{
          const fig=_csStripSVG(seg,e,spec);
          return fig?`<figure class="cs-fig">${fig}</figure>`:'';
        }).join('');
        // Every end of every run must have a figure. If one is missing, the
        // sheet says which — silence would read as "this end needs nothing".
        const missing=ends.filter(e=>!_csStripSVG(seg,e,spec)).map(e=>e.ref||'?');
        return (figs||missing.length) ? `<h3 class="cs-h3"><span class="cs-ltr">${esc(seg.id)} — ${esc(_csSegLabel(seg))}</span>
          ${esc(T('cut'))}: <span class="cs-ltr">${esc(_csMM(_csCutLength(seg,spec).total))}</span></h3>${figs}
          ${missing.length?`<p class="cs-note" style="color:#B45309">${esc(T('No figure could be drawn for'))}
            <span class="cs-ltr">${esc(missing.join(', '))}</span> — ${esc(T('this end has no dimensions at all on the specification.'))}</p>`:''}` : '';
      }).join('')}
    </div>

    <h2 class="cs-h2"><span class="cs-n">6</span>${esc(T('Notes'))}</h2>
    <div class="cs-pad">
      <!-- Fixed, on every sheet, and not editable: the one thing about this
           document that must never be quietly dropped. It replaces the old
           "generated by AI" banner at the top of the page — same fact, said
           where a form puts its conditions, and said as what to DO. -->
      <p class="cs-ai-note">${esc(T('This analysis is based on the attached drawing and was calculated by artificial intelligence. Engineering approval is therefore required before work begins.'))}</p>
      ${S._csEditing
        ? `<textarea class="cs-in" data-cs-path="form_notes" data-cs-type="text" rows="3"
             style="width:100%">${esc(spec.form_notes||'')}</textarea>`
        : (spec.form_notes ? `<div class="cs-notes-box">${esc(spec.form_notes)}</div>` : '')}
    </div>

    <h2 class="cs-h2"><span class="cs-n">7</span>${esc(T('Approval'))}</h2>
    <div class="cs-pad"><table class="cs-tbl cs-form-tbl">
      <thead><tr><th style="width:28%">${esc(T('Name'))}</th><th style="width:26%">${esc(T('Signature'))}</th>
        <th style="width:18%">${esc(T('Date'))}</th><th style="width:28%">${esc(T('Notes'))}</th></tr></thead>
      <tbody>
        <tr><td class="cs-ctr">${_csFRaw('prepared_by', spec.prepared_by)}
              <div class="cs-role">${esc(T('Prepared by'))}</div></td>
            <td class="cs-sig-cell">${_csFRaw('prepared_sign', spec.prepared_sign)}</td>
            <td class="cs-ctr cs-ltr">${_csFRaw('prepared_date', spec.prepared_date)}</td>
            <td>${_csFRaw('prepared_note', spec.prepared_note)}</td></tr>
        <tr><td class="cs-ctr">${_csFRaw('approved_by', spec.approved_by)}
              <div class="cs-role">${esc(T('Approved for production'))}</div></td>
            <td class="cs-sig-cell">${_csFRaw('approved_sign', spec.approved_sign)}</td>
            <td class="cs-ctr cs-ltr">${_csFRaw('approved_date', spec.approved_date)}</td>
            <td>${_csFRaw('approved_note', spec.approved_note)}</td></tr>
      </tbody></table>
      <p class="cs-note">${esc(T('The signature column is for a pen — type initials here only if your process accepts a typed name.'))}</p>
      <div class="cs-foot">
        <span class="cs-ltr">${esc(spec.spec_no||'')} · ${esc(spec.drawing_number||'')} ${esc(spec.revision?('Rev '+spec.revision):'')}${spec.source_file?' · '+esc(spec.source_file):''}</span>
        <span class="cs-ltr">${spec.edited_by?`✎ ${esc(spec.edited_by)} ${esc(String(spec.edited_at||'').slice(0,10))} · `:''}v${APP_VER}</span>
      </div>
    </div>
  </div>`);

  if(!S._csEditing) _csBackfillDatasheets(spec);

  document.getElementById('btn-cs-back')?.addEventListener('click',()=>{
    if(S._csEditing && !confirm('Discard unsaved changes to this specification?')) return;
    S._csEditing=false; S._csEditBackup=null;
    renderCutStrip();
  });
  document.getElementById('btn-cs-print')?.addEventListener('click',()=>window.print());
  document.getElementById('btn-cs-pdf')?.addEventListener('click',_csExportPDF);
  document.getElementById('btn-cs-edit')?.addEventListener('click',_csEnterEdit);

  document.getElementById('btn-cs-save')?.addEventListener('click',_csSaveSpec);
  document.getElementById('btn-cs-cancel')?.addEventListener('click',()=>{
    if(confirm('Discard unsaved changes to this specification?')) _csCancelEdit();
  });

  // Structural edits. Whatever is typed into the form is collected FIRST, so
  // adding or deleting a row never throws away edits made in other fields.
  document.querySelectorAll('#cs-sheet [data-cs-act]').forEach(b=>b.addEventListener('click',()=>{
    _csCollectEdits();
    const s=S.csCurrent, i=parseInt(b.dataset.csIdx,10);
    switch(b.dataset.csAct){
      case 'add-step':  s.steps.push({n:s.steps.length+1,title:'New step',body:'',critical:'',dimension_ref:''}); break;
      case 'del-step':  s.steps.splice(i,1); s.steps.forEach((x,k)=>x.n=k+1); break;
      case 'add-chk':   s.inspection.push('New check'); break;
      case 'del-chk':   s.inspection.splice(i,1); break;
      case 'del-tool':  s.tools.splice(i,1); break;
      case 'del-open':  s.open_items.splice(i,1); break;
      case 'del-disc':  s.discrepancies.splice(i,1); break;
    }
    renderCutStripSheet();
  }));

  // Live diagram feedback: ticking Confirmed or changing a dimension redraws
  // the figures immediately, so the operator sees the red TBC marking clear
  // while still in the form rather than after saving.
  document.querySelectorAll('#cs-sheet input[data-cs-type="bool"], #cs-sheet input[data-cs-type="num"]')
    .forEach(el=>el.addEventListener('change',()=>{
      _csCollectEdits();
      const fig=document.querySelectorAll('#cs-sheet .cs-fig');
      if(fig[0]) fig[0].innerHTML=_csHarnessSVG(S.csCurrent);
      (S.csCurrent.ends||[]).forEach((e,k)=>{ if(fig[k+1]) fig[k+1].innerHTML=_csStripSVG(S.csCurrent,e,S.csCurrent); });
    }));

  document.querySelectorAll('[data-cs-lang]').forEach(b=>b.addEventListener('click',async()=>{
    const lang=b.dataset.csLang;
    if(lang===_csLang) return;
    // Switching BACK to the language the spec was written in is free — the text
    // is already stored that way.
    if(lang!==_csSrcLang(S.csCurrent)){
      const ov=(S.csCurrent.overrides&&S.csCurrent.overrides[lang])||{};
      const bucket=_csCache[lang]||{};
      const todo=_csProseStrings(S.csCurrent).filter(t=>!ov[t] && !bucket[t]);
      if(todo.length){
        const old=b.textContent;
        const busy=_CS_LABELS[lang]?.['Translating…']||'Translating…';
        b.textContent=busy;
        document.querySelectorAll('[data-cs-lang]').forEach(x=>x.disabled=true);
        // Chunked, so a long spec shows progress instead of appearing frozen
        // for a minute and then failing.
        const okAll=await _csEnsureLang(S.csCurrent, lang,
          (n,total)=>{ b.textContent=`${busy} ${Math.round(n/total*100)}%`; });
        if(!okAll){
          b.textContent=old;
          document.querySelectorAll('[data-cs-lang]').forEach(x=>{ x.disabled=(x.dataset.csLang===_csLang); });
          renderCutStripSheet();
          return;
        }
      }
    }
    _csSetLang(lang);   // remembered for next time — see _csLang above
    renderCutStripSheet();
  }));
}
