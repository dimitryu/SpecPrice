import { S } from '../../core/state.js';
import { _AI_NO_KEY, _aiReady } from '../../ai/client.js';
import { aiAnalyzeCableProcess } from '../../ai/process.js';
import { aiTranslateOperations } from '../../ai/translate.js';
import { logSystemAudit } from '../../core/audit.js';
import { closeModal, esc, showModal } from '../../core/ui.js';
import { _sdComputeSummary, _sdDwgKey, _sdDwgUnits, _sdIsToolRow, _sdRecalcLaborTotal, sdItems } from './salesDesk.js';

// Manufacturing Routings (the keyword→operation-duration matching system)
// was removed — Labor Time is now filled purely by the AI cable-manufacturing-
// process analysis run per drawing (see aiAnalyzeCableProcess/handleSDFiles)
// or typed in manually. This is kept as a no-op so its existing call sites
// don't need to change.
// ══════════════════════════════════════════════════════════════════════════════
// Labor Time for parts added from the Database
// ------------------------------------------------------------------------------
// Adding a drawing runs the AI cable-process analysis and every row comes back
// with its labor minutes. Adding the same parts from the Database used to give
// zero, because this function was an empty stub — a leftover from when labor
// came from the Manufacturing Routings table, which was removed. Nothing
// replaced it, so the Sales Desk silently quoted those assemblies with no labor
// at all: the parts cost was right and the price was too low.
//
// It now runs the SAME analysis as the drawing path. The one honest difference
// is the input: there is no drawing, so the AI works from the part list alone
// (see _cableProcessPrompt's hasDrawing=false wording). It can read "26 POS"
// out of a description, but it cannot count pins or measure a length off a
// drawing it was never given — so treat these as estimates and adjust the Labor
// Time column where the drawing would have told a different story.
// ══════════════════════════════════════════════════════════════════════════════
// Returns {applied, minutes, reason} so the caller can TELL THE USER what
// happened. The first version returned nothing and swallowed every failure
// path, so "no labor appeared" was indistinguishable from "no AI key", "the
// model returned no steps" and "the request failed" — which is precisely why
// this took two attempts to diagnose.
// Above this many drawings the estimate stops being a background convenience:
// it's minutes of waiting and a real number of API calls, so the user decides.
export const SD_LABOR_AUTO_LIMIT = 20;

export async function _sdAutoMatchLabor(onProgress, opts={}){
  if(!_aiReady()){
    return {applied:0, minutes:0, reason:'No AI key configured — add one in Admin → AI API Keys'};
  }

  // ── Which rows may this estimate touch? ──
  // Rows whose labor came from an actual DRAWING are off-limits: replacing a
  // figure read from the drawing with a guess made without one is strictly
  // worse. Rows a previous parts-only run produced (_laborFromParts) ARE
  // eligible, because a re-estimate must be able to redo its own work.
  const eligible=sdItems
    .map((r,i)=>({r,i}))
    .filter(({r})=>!r._laborManualOverride && !_sdIsToolRow(r)
                   && (r._laborFromParts || !(parseFloat(r.labor_total)>0)));
  if(!eligible.length){
    return {applied:0, minutes:0, reason:'Every row already has a Labor Time'};
  }
  let applied=0, minutesTotal=0, lastError='';

  // One analysis per drawing, mirroring the drawing path: steps not tied to a
  // single row become that drawing's generalMinutes, and the breakdown modal
  // finds a section by matching drawingName against rows in Sales Desk.
  const groups=new Map();
  for(const item of eligible){
    const key=String(item.r.drawing_number||'').trim();
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(item);
  }

  // Auto-running 200 analyses would be several minutes and 200 AI calls that
  // the user never asked for. Report back instead and let the caller confirm.
  if(!opts.force && groups.size > SD_LABOR_AUTO_LIMIT){
    return {applied:0, minutes:0, needsConfirm:groups.size,
            reason:`${groups.size} drawings — that's ${groups.size} AI calls (roughly ${Math.ceil(groups.size*8/60)} min)`};
  }

  let groupNo=0;
  const groupCount=groups.size;
  for(const [dwg,members] of groups){
    groupNo++;
    // A 10-second silent pause reads as a broken button, so report which
    // drawing is being worked on as the loop advances.
    if(onProgress) onProgress({done:groupNo, total:groupCount, drawing:dwg, rows:members.length});
    // ── Re-estimating must REPLACE, not accumulate ──
    // Each run used to push a fresh breakdown and add to whatever minutes a row
    // already had. Running it twice on one drawing therefore produced two
    // sections in the modal AND double-counted that drawing's general minutes
    // in Cost Summary (see _sdActiveGeneralLaborMinutes, which sums every
    // matching breakdown) — quietly inflating the quote.
    // Clearing this drawing's previous parts-only result first makes the whole
    // operation idempotent: pressing the button twice gives the same answer.
    S._sdLaborBreakdowns=S._sdLaborBreakdowns.filter(b=>!(b.fromPartsOnly && b.drawingName===dwg));
    for(const {r} of members){
      if(r._laborFromParts){
        r.labor_time=''; r.labor_total=0;
        delete r._laborFixedTotal; delete r._laborFromParts;
      }
    }
    // A breakdown whose drawingName matches nothing in sdItems would be
    // invisible in the modal and its general minutes uncounted. Rows with no
    // drawing number can't be represented that way, so their steps are all
    // treated as row-tied and no breakdown section is created for them.
    const canTrack=!!dwg;
    try{
      const rowsList=members
        .map(({r},idx)=>`${idx}: ${r.description||r.part_number||''} (qty=${r.qty||''}${r.unit?' '+r.unit:''})`)
        .join('\n');
      const proc=await aiAnalyzeCableProcess('', false, null, rowsList, /*hasDrawing*/false);
      if(!proc || !proc.steps || !proc.steps.length){
        lastError=lastError||'The AI returned no manufacturing steps for these parts';
        continue;
      }

      let generalMinutes=0, rowTiedMinutes=0;
      const displaySteps=[];
      for(const step of proc.steps){
        const unitMins=parseFloat(step.unit_minutes)||0;
        if(!unitMins) continue;
        // Same contract as the drawing path: the AI reports a per-occurrence
        // time and a repeat count separately, and WE multiply. Never trust the
        // model to have done the arithmetic.
        const qtyInDrawing=parseFloat(step.qty_in_drawing)||1;
        const totalMins=unitMins*qtyInDrawing;
        const target=(step.row_idx!=null) ? members[step.row_idx] : null;
        displaySteps.push({operation:step.operation, unitMinutes:unitMins, qty:qtyInDrawing, minutes:totalMins});
        if(target && sdItems[target.i]){
          const row=sdItems[target.i];
          row.labor_time=String((parseFloat(row.labor_time)||0)+totalMins);
          // Already a total for one assembly — _sdRecalcLaborTotal must use it
          // as-is rather than multiplying it by the row's own qty again.
          row._laborFixedTotal=true;
          row._laborFromParts=true;   // this run owns it, so a re-run may redo it
          _sdRecalcLaborTotal(row);
          rowTiedMinutes+=totalMins;
        } else if(canTrack){
          generalMinutes+=totalMins;
        } else {
          // Nowhere to attribute it and no breakdown to hold it — fold it into
          // the first row so the time isn't silently lost from the quote.
          const first=sdItems[members[0].i];
          if(first){
            first.labor_time=String((parseFloat(first.labor_time)||0)+totalMins);
            first._laborFixedTotal=true;
            first._laborFromParts=true;
            _sdRecalcLaborTotal(first);
            rowTiedMinutes+=totalMins;
          }
        }
      }

      if(canTrack){
        S._sdLaborBreakdowns.push({
          drawingName: dwg,
          steps: displaySteps,
          rowTiedMinutes,
          seriesTotal: rowTiedMinutes+generalMinutes,
          // Floored at the series total for the same reason as the drawing
          // path: a single stand-alone build can't take LESS than the batch
          // per-unit time, and the AI's estimate is an independent guess.
          singleUnitMinutes: Math.max(parseFloat(proc.single_unit_minutes)||0, rowTiedMinutes+generalMinutes),
          generalMinutes,
          // Marks this section as estimated without a drawing — surfaced in the
          // breakdown modal so the number is never mistaken for a drawing-derived one.
          fromPartsOnly:true,
        });
      }
      for(const {r} of members) r._laborFromParts=true;
      applied+=members.length;
      minutesTotal+=rowTiedMinutes+generalMinutes;
      logSystemAudit('labor_estimate_from_parts',
        {drawing:dwg||'(none)', rows:members.length, steps:displaySteps.length,
         minutes:+(rowTiedMinutes+generalMinutes).toFixed(1)}, true);
    }catch(e){
      lastError=e.message||String(e);
      console.warn('[SD] labor estimate from parts failed:', lastError);
      logSystemAudit('labor_estimate_from_parts', lastError, false);
    }
  }
  return {applied, minutes:minutesTotal,
          reason: applied ? '' : (lastError||'No labor time could be estimated')};
}

// Shows the manufacturing-step breakdown behind the Labor Time number — one
// section per drawing analyzed by aiAnalyzeCableProcess (see handleSDFiles),
// each listing every step + its minutes, the drawing's series (per-unit,
// batch-production) total, and a separate reference figure for what a single
// stand-alone cable would take. Also shows any general/unattributed step time
// and a grand total across everything currently counted in the auto Labor Time.
// ══════════════════════════════════════════════════════════════════════════════
// Labor Time Breakdown — Hebrew translation
// ------------------------------------------------------------------------------
// The fixed labels are translated from a table (instant, free, always correct).
// The operation sentences come from the AI per drawing, so they can't be — those
// go through the AI once and are then cached, keyed by the exact English text.
// Cache lives in localStorage: the same operations recur across drawings, and
// re-paying for a translation the user has already seen would be wasteful and
// slow. The chosen language is remembered the same way, per the request to
// reopen in whatever language was last picked.
// ══════════════════════════════════════════════════════════════════════════════
export const _LB_CACHE_KEY='labor_breakdown_tr_cache';
// English ALWAYS on open. The language is a per-viewing choice, not a setting:
// the underlying data is English, and quietly reopening in a translation the
// user picked days ago hides that. They press a button when they want it.
export let _lbLang='en';
// The TRANSLATIONS are still cached across sessions — that's a cost/latency
// optimisation, invisible to the user, and unrelated to which language shows.
// Shape: { he:{english:translated}, ru:{...} }
export let _lbCache = (()=>{
  try{ const c=JSON.parse(localStorage.getItem(_LB_CACHE_KEY))||{}; return {he:c.he||{}, ru:c.ru||{}}; }
  catch{ return {he:{}, ru:{}}; }
})();
export function _lbSaveCache(){
  try{ localStorage.setItem(_LB_CACHE_KEY, JSON.stringify(_lbCache)); }
  catch(e){ console.warn('[Labor] translation cache not saved:', e.message); }
}
// Hebrew reads right-to-left; Russian does not.
export function _lbRTL(){ return _lbLang==='he'; }
export const _LB_LANG_NAMES={en:'English', he:'עברית', ru:'Русский'};

// Fixed UI strings. Kept as a table rather than sent to the AI so the chrome of
// the dialog never depends on a network call.
export const _LB_LABELS={
  he:{
    'Operation':'פעולה',
    'Per op':'לפעולה',
    '×Qty':'× כמות',
    'Total':'סה"כ',
    'min':'דק׳',
    'Row-tied operations':'פעולות המשויכות לשורה',
    '+ General assembly/inspection (not tied to one part)':'+ הרכבה/בדיקה כללית (לא משויך לפריט מסוים)',
    '+ Rows without a step analysis':'+ שורות ללא ניתוח שלבים',
    '= Total (series, per unit)':'= סה"כ (סדרה, ליחידה)',
    'Reference: single stand-alone cable':'להשוואה: כבל בודד עצמאי',
    'Total Labor Time (auto)':'סה"כ זמן עבודה (אוטומטי)',
    'Labor Time Breakdown':'פירוט זמן עבודה',
    'Close':'סגור',
    'Translating…':'מתרגם…',
  },
  ru:{
    'Operation':'Операция',
    'Per op':'За опер.',
    '×Qty':'× Кол-во',
    'Total':'Итого',
    'min':'мин',
    'Row-tied operations':'Операции, привязанные к строке',
    '+ General assembly/inspection (not tied to one part)':'+ Общая сборка/контроль (не привязано к детали)',
    '+ Rows without a step analysis':'+ Строки без анализа операций',
    '= Total (series, per unit)':'= Итого (серия, на единицу)',
    'Reference: single stand-alone cable':'Для сравнения: одиночный кабель',
    'Total Labor Time (auto)':'Общее время работы (авто)',
    'Labor Time Breakdown':'Детализация времени работы',
    'Close':'Закрыть',
    'Translating…':'Перевод…',
  },
};
// Returns the Hebrew text when available, otherwise the English original.
// Never blocks and never throws: an untranslated string is far better than a
// broken dialog.
export function _lbTr(text){
  if(_lbLang==='en') return text;
  const t=String(text||'');
  return (_LB_LABELS[_lbLang]||{})[t] || (_lbCache[_lbLang]||{})[t] || t;
}

// Translates the operation sentences that aren't already cached.
// Batched into ONE request — a call per line would be slow and needlessly
// expensive when a breakdown routinely has a dozen steps.
export async function _lbTranslateOperations(texts, lang){
  const bucket=_lbCache[lang] || (_lbCache[lang]={});
  const todo=[...new Set(texts.map(t=>String(t||'').trim()).filter(t=>t && !bucket[t]))];
  if(!todo.length) return true;
  if(!_aiReady()) throw new Error(_AI_NO_KEY);

  const arr=await aiTranslateOperations(todo, lang);
  // A length mismatch means the lines no longer line up with their originals —
  // caching them by position would attach the wrong Hebrew to the wrong step,
  // which is worse than showing English.
  if(!Array.isArray(arr) || arr.length!==todo.length){
    throw new Error(`Translation returned ${Array.isArray(arr)?arr.length:'?'} lines for ${todo.length} operations`);
  }
  todo.forEach((t,i)=>{ const v=String(arr[i]||'').trim(); if(v) bucket[t]=v; });
  _lbSaveCache();
  return true;
}

// Per cable: what this drawing's rows add up to, less what the analysed steps
// tied to rows already explain. Zero when every row's minutes came from the
// process analysis.
export function _sdLaborExtraPerUnit(b){
  const dwg=String(b?.drawingName||'');
  const rows=sdItems.filter(r=>String(r.drawing_number||'')===dwg);
  if(!rows.length) return 0;
  const units=_sdDwgUnits(_sdDwgKey(rows[0]))||1;
  const rowsPerUnit=rows.reduce((t,r)=>t+(parseFloat(r.labor_total)||0),0)/units;
  const tied=b.rowTiedMinutes!=null ? b.rowTiedMinutes : (b.seriesTotal-(b.generalMinutes||0));
  const extra=rowsPerUnit-tied;
  return Math.abs(extra)<1e-9 ? 0 : extra;
}
export function openLaborBreakdownModal(onlyDwg){
  const {autoLaborMinutes}=_sdComputeSummary();
  // Only show drawings that still have at least one row in Sales Desk —
  // once every row from a drawing is deleted, its breakdown no longer
  // contributes to the total, so it's dropped from this view too (see
  // _sdActiveGeneralLaborMinutes for the same rule applied to the total).
  // onlyDwg limits the modal to one drawing — the per-drawing 📋 button passes
  // it, so a 200-drawing quote doesn't dump every breakdown into one dialog.
  const activeBreakdowns = S._sdLaborBreakdowns
    .filter(b=>sdItems.some(r=>String(r.drawing_number||'')===b.drawingName))
    .filter(b=>!onlyDwg || b.drawingName===onlyDwg);
  if(!activeBreakdowns.length){
    showModal(`<div class="modal modal-sm">
      <div class="modal-head"><h3>📋 Labor Time Breakdown</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p style="color:var(--muted);font-size:13px">No AI cable-process analysis for the parts currently in Sales Desk — import a drawing via "📎 New Drawing" to get a step-by-step manufacturing breakdown here.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>
    </div>`);
    return;
  }
  const sections = activeBreakdowns.map(b=>`
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-weight:700;margin-bottom:6px">${esc(b.drawingName||'(drawing)')}${b.fromPartsOnly
        ? `<span style="margin-inline-start:7px;padding:2px 7px;border-radius:9px;background:#FEF3C7;color:#92400e;font-size:10px;font-weight:700;cursor:help" title="Estimated from the parts list alone — no drawing was analysed, so pin counts and lengths could not be read. Adjust Labor Time where the drawing would say otherwise.">estimated from parts</span>`
        : ''}</div>
      <!-- table-layout:fixed stops the long Operation text from stretching the
           table past the modal and re-introducing the horizontal scrollbar. -->
      <table style="width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed">
        <thead><tr style="text-align:${_lbRTL()?'right':'left'};color:var(--muted)">
          <th style="padding:4px 7px;border-bottom:2px solid var(--border)">${_lbTr('Operation')}</th>
          <th style="padding:4px 7px;text-align:right;width:62px;border-bottom:2px solid var(--border);border-inline-start:1px solid var(--border)">${_lbTr('Per op')}</th>
          <th style="padding:4px 7px;text-align:center;width:52px;border-bottom:2px solid var(--border);border-inline-start:1px solid var(--border)">${_lbTr('×Qty')}</th>
          <th style="padding:4px 7px;text-align:right;width:62px;border-bottom:2px solid var(--border);border-inline-start:1px solid var(--border)">${_lbTr('Total')}</th>
        </tr></thead>
        <tbody>
          ${b.steps.map(s=>{
            const opEn=String(s.operation||'');
            const op=_lbTr(opEn);
            // Operation text is a full sentence and routinely longer than the
            // column. It used to be clipped behind a horizontal scrollbar, so
            // the end of every long step was simply unreadable. Wrap it over as
            // many lines as it needs — vertical space is cheap here, and the
            // whole point of this modal is to READ what the AI decided.
            return `<tr style="vertical-align:top">
              <td style="padding:5px 7px;white-space:normal;word-break:break-word;line-height:1.45;border-bottom:1px solid var(--border)">${esc(op)}</td>
              <td style="padding:5px 7px;text-align:right;color:var(--muted);white-space:nowrap;border-bottom:1px solid var(--border);border-inline-start:1px solid var(--border)">${s.unitMinutes!=null?(parseFloat(s.unitMinutes)||0).toFixed(2):'—'}</td>
              <td style="padding:5px 7px;text-align:center;color:var(--muted);white-space:nowrap;border-bottom:1px solid var(--border);border-inline-start:1px solid var(--border)">${s.qty!=null?s.qty:'—'}</td>
              <td style="padding:5px 7px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border);border-inline-start:1px solid var(--border)">${(parseFloat(s.minutes)||0).toFixed(1)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${b.generalMinutes ? (()=>{
        const rowTied = b.rowTiedMinutes!=null ? b.rowTiedMinutes : (b.seriesTotal-b.generalMinutes);
        // Spelled out as an explicit addition (not just an "of which" aside)
        // so it's visible at a glance that the general assembly/inspection
        // time is already counted INTO the total below, not sitting on top
        // of it as a separate add-on.
        return `<div style="margin-top:4px;font-size:11px;color:var(--muted)">
          <div style="display:flex;justify-content:space-between"><span>${_lbTr('Row-tied operations')}</span><span>${rowTied.toFixed(1)} ${_lbTr('min')}</span></div>
          <div style="display:flex;justify-content:space-between"><span>${_lbTr('+ General assembly/inspection (not tied to one part)')}</span><span>${b.generalMinutes.toFixed(1)} ${_lbTr('min')}</span></div>
        </div>`;
      })() : ''}
      ${(()=>{
        // Minutes in the drawing's total that no analysed step accounts for:
        // rows added by hand or from the Database (a length row gets a flat
        // minute), or a time typed on a row in an older quote. Without the
        // per-row column they would otherwise be invisible, and the total
        // here would not match the Labor Time on the summary.
        const extra=_sdLaborExtraPerUnit(b);
        return Math.abs(extra)>=0.05 ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">
          <span>${_lbTr('+ Rows without a step analysis')}</span><span>${extra.toFixed(1)} ${_lbTr('min')}</span></div>` : '';
      })()}
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px">
        <strong>${_lbTr('= Total (series, per unit)')}</strong><strong>${(b.seriesTotal+_sdLaborExtraPerUnit(b)).toFixed(1)} ${_lbTr('min')}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;color:var(--muted);font-size:12px">
        <span>${_lbTr('Reference: single stand-alone cable')}</span><span>≈ ${b.singleUnitMinutes.toFixed(1)} ${_lbTr('min')}</span>
      </div>
    </div>`).join('');
  showModal(`<div class="modal" style="width:min(94vw,680px)">
    <div class="modal-head">
      <h3>📋 ${_lbTr('Labor Time Breakdown')}</h3>
      <button class="close-modal" onclick="closeModal()">✕</button>
    </div>
    <!-- overflow-x hidden, not auto: the whole point of the wrapping above is
         that nothing should need horizontal scrolling to be read. -->
    <div class="modal-body" style="max-height:70vh;overflow-y:auto;overflow-x:hidden"
         dir="${_lbRTL()?'rtl':'ltr'}">
      ${sections}
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding-top:8px;border-top:2px solid var(--border)">
        <span>${_lbTr('Total Labor Time (auto)')}</span><span>${autoLaborMinutes.toFixed(1)} ${_lbTr('min')}</span>
      </div>
      <div id="lb-tr-msg" style="margin-top:8px;font-size:11px"></div>
    </div>
    <div class="modal-foot" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--muted)">🌐</span>
      ${['en','he','ru'].map(L=>`<button class="btn ${_lbLang===L?'btn-blue':'btn-ghost'} btn-sm"
          data-lb-lang="${L}" ${_lbLang===L?'disabled':''}
          style="font-size:12px">${_LB_LANG_NAMES[L]}</button>`).join('')}
      <button class="btn btn-ghost" style="margin-left:auto" onclick="closeModal()">${_lbTr('Close')}</button>
    </div>
  </div>`);

  document.querySelectorAll('[data-lb-lang]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const lang=btn.dataset.lbLang;
      if(lang===_lbLang) return;
      const msg=document.getElementById('lb-tr-msg');

      if(lang!=='en'){
        // Only the AI-written operation sentences need a round-trip, and only
        // the ones not already cached for THIS language — so switching back to
        // a language already seen is instant.
        const ops=activeBreakdowns.flatMap(b=>b.steps.map(st=>st.operation||''));
        const bucket=_lbCache[lang]||{};
        const missing=ops.filter(t=>t && !bucket[String(t).trim()]).length;
        if(missing){
          document.querySelectorAll('[data-lb-lang]').forEach(b=>b.disabled=true);
          btn.textContent='…';
          if(msg) msg.innerHTML='<span style="color:var(--muted)">Translating operation descriptions…</span>';
          try{
            await _lbTranslateOperations(ops, lang);
          }catch(e){
            document.querySelectorAll('[data-lb-lang]').forEach(b=>{ b.disabled=(b.dataset.lbLang===_lbLang); });
            btn.textContent=_LB_LANG_NAMES[lang];
            if(msg) msg.innerHTML=`<span style="color:var(--red)">Translation failed — ${esc(e.message)}</span>`;
            logSystemAudit('labor_breakdown_translate', e.message, false);
            return;   // stay put rather than switch to a half-translated view
          }
          logSystemAudit('labor_breakdown_translate', `${missing} operation(s) → ${lang}`, true);
        }
      }
      _lbLang=lang;           // deliberately NOT persisted — see _lbLang above
      closeModal();
      openLaborBreakdownModal();
    });
  });
}
