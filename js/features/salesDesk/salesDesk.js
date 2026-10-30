import { S } from '../../core/state.js';
import { _aiReady } from '../../ai/client.js';
import { _NOTE_DOC_STD_RE } from '../../ai/process.js';
import { logAudit } from '../../core/audit.js';
import { loadColOrder, makeColumnsReorderable, makeTableResizable, parseBoolQuery, wireScrollButtons, wireSearchClear, wireShiftCheck } from '../../core/table.js';
import { debounce, esc, setActions, setContent, toast } from '../../core/ui.js';
import { loadParts } from '../../data/parts.js';
import { _SD_PRICE_SOURCES, _sdLaborQtyMultiplier, _sdRecalcTotal } from '../../domain/pricing.js';
import { _PRICE_LEGEND_HTML, _priceCellHTML, _stockCellHTML } from '../database.js';
import { _sdAskUnitsThenCheck } from '../priceCheck.js';
import { exportSalesDeskExcel } from './export.js';
import { openPartPickerModal, openSDFileModal } from './import.js';
import { _sdAutoMatchLabor, openLaborBreakdownModal } from './labor.js';
import { showSettingsModal } from '../settings.js';

export let sdItems     = [];

// ══════════════════════════════════════════════════════════════════════════════
// SALES DESK
// ══════════════════════════════════════════════════════════════════════════════
// Canonical column order — identical to the Database's (see the Part Stock
// column list) so the same data reads the same way on every screen.
export const _SD_DEFAULT_COLS=[
  {k:'drawing_number', l:'Drawing #',       w:'100px'},
  {k:'part_number',    l:'MNF P/N',          w:'110px'},
  {k:'description',    l:'Description',     w:'190px',wrap:true},
  {k:'manufacturer',   l:'Manufacturer',    w:'120px'},
  {k:'qty',            l:'QTY',             w:'75px'},
  {k:'unit',           l:'Units',           w:'55px'},
  {k:'mouser_price',   l:'Mouser Cost',     w:'95px'},
  {k:'mouser_stock',   l:'Mouser Stock',    w:'85px'},
  {k:'digikey_price',  l:'DigiKey Cost',    w:'95px'},
  {k:'digikey_stock',  l:'DigiKey Stock',   w:'85px'},
  {k:'priority_price', l:'Priority Cost',  w:'95px'},
  {k:'total',          l:'Part Cost',       w:'85px'},
  // No per-row Labor Time column. The minutes are still worked out per row and
  // summed into each drawing's Labor Time (min / cable); the 📋 button beside
  // that number shows every step behind it. A per-row column invited summing
  // it by eye — and that sum never included the general assembly and test
  // steps, which belong to no single part — so it read as a contradiction of
  // the total even when both were right.
];
export function _sdRecalcLaborTotal(r){
  // The Labor Time column in the table is directly user-editable (see
  // _sdCellHTML 'labor_time' case) — once the user types their own number,
  // r._laborManualOverride is set and that number is used as-is here,
  // exactly like Part Cost's manual_total override. Clearing the field goes
  // back to the auto-calculation below.
  if(r._laborManualOverride) return r.labor_total;
  const lt=parseFloat(r.labor_time)||0;
  // A row's labor_time can ALSO be a genuine AI-computed total from the
  // cable-process analysis (see handleSDFiles), where it already equals
  // unit_minutes × qty_in_drawing — the sum of every manufacturing step the
  // AI tied to this specific row (e.g. the main cable row is exactly where
  // "cut and strip", "braid shield", etc. land). That real, drawing-derived
  // total must win over the mm/gr flat-1-minute floor below — checking unit
  // FIRST would silently throw away legitimate computed minutes just because
  // the row happens to be measured in mm/gr, which is exactly the case for a
  // cable/wire row. Do NOT re-multiply by this row's own qty column either:
  // that column may represent a different quantity concept entirely (e.g.
  // "1 connector housing" whose pins are crimped 20 times), so multiplying
  // again here would silently inflate the total.
  if(r._laborFixedTotal){
    // The AI figure is the time to build ONE cable, so building N of them takes
    // N times as long. Rows priced by a per-unit rate scale on their own (their
    // QTY already carries the multiplier); these two branches do not, so they
    // are scaled here — exactly once each.
    r.labor_total = lt * _sdUnitsForRow(r);
    return r.labor_total;
  }
  // Length rows (mm — the system's sole canonical length unit) and bulk-weight
  // rows (gr, treated the same as mm per business rule) that DIDN'T get a real
  // AI-computed total (e.g. a plain length-of-wire stock row with no process
  // steps identified) always take a flat 1 minute of labor instead of scaling
  // with a manually-typed rate × the row's mm/gr quantity — prepping this kind
  // of material takes roughly the same setup time no matter the quantity.
  const unit=String(r.unit||'').trim().toLowerCase();
  if(unit==='mm'||unit==='gr'){
    r.labor_total = 1 * _sdUnitsForRow(r);   // a flat minute per cable built
    return r.labor_total;
  }
  // A manually-typed Labor Time is always a PER-UNIT rate that scales with
  // the row's own Sales-Desk quantity (e.g. "apply label" × 8 identical
  // rows) — that multiplication happens here.
  r.labor_total = lt>0 ? lt*_sdLaborQtyMultiplier(r) : 0;
  return r.labor_total;
}
export function _sdRecalcRow(r){ _sdRecalcTotal(r); _sdRecalcLaborTotal(r); return r; }
export const _SD_UNIT_OPTIONS=['','pc','mm','gr'];
export const _TOOL_TAG='<span style="margin-inline-start:6px;padding:1px 6px;border-radius:8px;background:#F59E0B;color:#fff;font-size:9px;font-weight:700;vertical-align:middle">TOOL</span>';
export function _sdCellHTML(k,r,i){
  // Does this row have ANY quotable price? Used below to flag rows that still
  // need a number typed in by hand.
  const hasAnyPrice=_SD_PRICE_SOURCES.some(f=>(parseFloat(r[f])||0)>0);
  switch(k){
    // part_number/drawing_number/description/unit are editable text fields
    // (not just for manually-added blank rows — any row can be corrected
    // by hand) so a user can add a row and type its data in directly.
    case 'part_number': return `<input type="text" class="sd-part-number" data-i="${i}" value="${esc(r.part_number||'')}"
           placeholder="Part #" style="width:100%;min-width:80px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">`;
    case 'drawing_number': return `<input type="text" class="sd-drawing-number" data-i="${i}" value="${esc(r.drawing_number||'')}"
           style="width:100%;min-width:70px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">`;
    case 'description': return `<span style="display:flex;align-items:center;gap:4px"><input type="text" class="sd-description" data-i="${i}" value="${esc(r.description||'')}"
           style="flex:1;min-width:120px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">${
           _sdIsToolRow(r)?_TOOL_TAG:''}</span>`;
    case 'qty': return `<input type="number" class="sd-qty" data-i="${i}" value="${r.qty??''}" min="0.001" step="any"
           style="width:60px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">`;
    case 'manufacturer': return `<input type="text" class="sd-manufacturer" data-i="${i}" value="${esc(r.manufacturer||'')}"
           placeholder="—" style="width:100%;min-width:100px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">`;
    case 'unit': return `<select class="sd-unit" data-i="${i}" style="padding:2px 4px;border:1px solid var(--border);border-radius:4px;font-size:12px">
           ${_SD_UNIT_OPTIONS.map(u=>`<option value="${u}" ${String(r.unit||'')===u?'selected':''}>${u||'—'}</option>`).join('')}
         </select>`;
    // All price columns share the Database's comparison rule — cheapest green,
    // dearest red — so a price means the same thing on both screens.
    case 'priority_price':
    case 'mouser_price':
    case 'digikey_price': return _priceCellHTML(r,k);
    case 'mouser_stock':
    case 'digikey_stock': return _stockCellHTML(r,k);
    // Part Cost is always editable — type a number to set/correct it directly
    // (see _sdRecalcTotal). Highlighted cyan when no source has a price and
    // there's no manual override yet, so missing-price rows are easy to spot.
    case 'total': {
      const hasManual = r.manual_total!=null && r.manual_total!=='';
      const noSourcePrice = !hasAnyPrice && !hasManual;
      const ownedNote = _sdIsToolOwned(r)
        ? `<div style="font-size:9px;color:#1F8B4C;font-weight:700;white-space:nowrap" title="This tool is marked in Stock in the Database — not charged in the final price">✓ in stock</div>`
        : '';
      return `<input type="number" class="sd-manual-total" data-i="${i}" value="${r.total?+r.total.toFixed(2):''}"
             min="0" step="any" placeholder="0.00" title="${hasManual?'Manual price override — clear to go back to FC/Priority price':'No FC/Priority price — type one in manually'}"
             style="width:78px;padding:2px 5px;border:1px solid ${noSourcePrice?'#06b6d4':'var(--border)'};border-radius:4px;font-size:12px;font-weight:700;text-align:right;${noSourcePrice?'background:#ecfeff;color:#0e7490':''}">${ownedNote}`;
    }
    // Labor Time shows/edits the row's actual total minutes directly (what
    // used to be the separate read-only "Labor Total" column) — type a number
    // to override the auto-calculated value (see _sdRecalcLaborTotal); clear
    // it to go back to auto (AI cable-process analysis, or the flat 1 min
    // mm/gr rule).
    case 'labor_time': {
      const hasManual = !!r._laborManualOverride;
      return `<input type="number" class="sd-labor-time" data-i="${i}" value="${r.labor_total?+r.labor_total.toFixed(2):''}" min="0" step="any"
           placeholder="min" title="${hasManual?'Manual override — clear to go back to the auto-calculated value':'Auto-calculated — type your own number to override it'}"
           style="width:65px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">`;
    }
    default: return esc(r[k]);
  }
}
export let _sdFilterQ='';
// Independent sort state for the Sales Desk table (separate from Part Stock's
// sortCol/sortAsc, which is a different table with different columns).
export let _sdSortCol=null, _sdSortAsc=true;
export const _SD_NUMERIC_COLS=new Set(['qty','priority_price','mouser_price','digikey_price',
                                'mouser_stock','digikey_stock','total','labor_time']);
// The 'labor_time' column now displays/edits the row's final total (see
// _sdCellHTML/_sdRecalcLaborTotal), stored on r.labor_total, not r.labor_time
// itself — sort on the value actually shown to the user.
export function _sdSortValue(r,k){
  if(k==='labor_time') return parseFloat(r.labor_total)||0;
  return r[k];
}
export let _sdProfitPct=40;
export function _sdLaborRatePerMin(){ return parseFloat(S._sdLaborRateMin)||0; }
// Cost Summary's Labor Time (min) field normally just mirrors the auto-summed
// total of every row's Labor Total — but the user can type their own total
// directly into that field, which "locks" it as an override so Labor Cost is
// calculated from their number instead. Clearing the field goes back to auto.
export let _sdLaborMinutesOverride=null;
// Same override pattern as Labor Time (min) above, but for the Tools line —
// normally the auto-summed Part Cost of every TOOL row, but the user can type
// their own number (e.g. a vendor quote for the actual crimp tool purchase)
// to override it. Clearing the field goes back to auto.
export let _sdToolsTotalOverride=null;
// Notes / Manufacturing Instructions extracted per analyzed drawing (see
// handleSDFiles + aiExtractDrawingNotes) — {drawingName, notes:[string,...]}.
// Same "active while at least one row from that drawing is still present"
// lifecycle as _sdLaborBreakdowns (see _sdActiveNotes), and cleared together
// with it on Clear All.
export let _sdDrawingNotes=[];
// Only shows notes for drawings that still have at least one row in sdItems —
// deleting every row of a drawing drops its notes panel too, same rule as
// the Labor Breakdown modal's activeBreakdowns.
export function _sdActiveNotes(){
  return _sdDrawingNotes.filter(n=>sdItems.some(r=>String(r.drawing_number||'')===n.drawingName));
}
// Renders the "Notes / Manufacturing Instructions" panel below the BOM table
// (#sd-notes-panel) — one section per drawing that still has active rows.
// Any line referencing a document or standard (see _NOTE_DOC_STD_RE) is
// highlighted red, since those often carry compliance/cost implications the
// quote should account for (e.g. "CRIMP PER IPC/WHMA-A-620").
export function _sdRenderNotesPanel(){
  const panel=document.getElementById('sd-notes-panel');
  if(!panel) return;
  const active=_sdActiveNotes();
  if(!active.length){ panel.style.display='none'; panel.innerHTML=''; return; }
  panel.style.display='block';
  panel.innerHTML=`<div style="font-size:12px;font-weight:700;color:var(--blue-dark);margin-bottom:6px">📋 Notes / Manufacturing Instructions</div>
    ${active.map(d=>`
      <div style="margin-bottom:8px">
        ${active.length>1?`<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:3px">${esc(d.drawingName||'')}</div>`:''}
        <ul style="margin:0;padding-inline-start:18px">
          ${d.notes.map(n=>`<li style="font-size:12px;line-height:1.5;${_NOTE_DOC_STD_RE.test(n)?'color:#E53E3E;font-weight:600':'color:var(--text)'}">${esc(n)}</li>`).join('')}
        </ul>
      </div>`).join('')}`;
}

// Sums generalMinutes from every analyzed drawing that still has at least one
// row present in sdItems — once every row belonging to a drawing is deleted
// (individually, or via Clear All), that drawing's un-attributed step time
// drops out of the total too.
export function _sdActiveGeneralLaborMinutes(){
  let total=0;
  for(const b of S._sdLaborBreakdowns){
    if(!b.generalMinutes) continue;
    if(sdItems.some(r=>String(r.drawing_number||'')===b.drawingName)) total+=b.generalMinutes;
  }
  return total;
}

// A row is a crimp/insertion TOOL line (synthesized by the AI during drawing
// extraction — see _BOM_TEXT_PROMPT/_BOM_VISION_PROMPT rule 5) if its
// description contains the word "TOOL". These get broken out into their own
// "Tools" line in Cost Summary instead of being folded silently into Parts
// Total, since a tool is a one-time purchase for the job, not a per-cable part.
export function _sdIsToolRow(r){ return /\btool\b/i.test(String(r.description||'')); }
// A crimp/insertion TOOL row is SYNTHESIZED by the AI — it is not a line that
// appeared on the customer's BOM. It also behaves differently from every other
// row: it never enters the cable price (see _sdComputeSummary). Both facts are
// invisible from the row itself, which has caused the tool to be read as just
// another part. Amber tint + left bar + a TOOL tag, applied everywhere such a
// row is shown, so the distinction is unmissable rather than inferred.
export const _TOOL_ROW_STYLE='background:#FFFBEB;box-shadow:inset 3px 0 0 #F59E0B';
export const _TOOL_ROW_TITLE='Added automatically by the drawing analysis — not a line from the customer BOM. Tools are quoted separately and never included in the cable price.';
export function _toolRowAttrs(r){
  return _sdIsToolRow(r) ? ` style="${_TOOL_ROW_STYLE}" title="${esc(_TOOL_ROW_TITLE)}"` : '';
}

// Whether a TOOL row's part number is marked "in Stock" in the Database RIGHT
// NOW — checked live against allParts every time it's needed (Cost Summary
// calc, the Part Cost column's badge, the Cost Summary stock note), rather
// than being decided once at import time and cached on the row. That matters
// because the user can toggle a part's Stock checkbox in the Database at any
// point AFTER a drawing's tool row is already sitting in the Sales Desk BOM —
// the price exclusion has to react to that immediately, not require deleting
// and re-importing the drawing to pick it up.
export function _sdIsToolOwned(r){
  if(!_sdIsToolRow(r)) return false;
  const pn=String(r.part_number||'').trim().toLowerCase();
  if(!pn) return false;
  return S.allParts.some(p=>String(p.part_number||'').trim().toLowerCase()===pn && p.own_stock);
}

// TOOLS ARE NEVER PART OF THE CABLE PRICE.
// A crimp/insertion tool is a one-time piece of shop equipment, not material
// consumed by the cable, so it must not inflate the per-cable quote either way:
//   • already in Stock  → nothing to buy, nothing to show as owing.
//   • NOT in Stock      → it still has to be purchased before this cable can be
//                         built, so it stays visible as a row and its cost is
//                         reported SEPARATELY (see the warning note in
//                         _sdUpdateSummaryUI) — but it is deliberately kept OUT
//                         of Subtotal/FINAL PRICE.
// toolsTotal below is therefore an informational figure only; it is never added
// into subtotal.
// ══════════════════════════════════════════════════════════════════════════════
// PER-DRAWING COSTING
// ------------------------------------------------------------------------------
// A quote covering several drawings is several quotes. Summing everything into
// one FINAL PRICE hides which assembly costs what, and makes a per-drawing
// margin impossible — so the unit of costing is the DRAWING, and the grand
// total is the sum of those, never computed independently.
//
// Each drawing carries its own profit %, labor rate and overrides; anything not
// set falls back to the global defaults, so a single-drawing quote behaves
// exactly as it always did.
// ══════════════════════════════════════════════════════════════════════════════
export let _sdDwgSettings={};   // { [drawingNumber]: {profitPct, laborRateMin, laborMinutes, toolsTotal} }
// Which drawing groups are collapsed in the BOM table. Kept separate from the
// Cost Summary's own collapse state — you often want the parts hidden while the
// prices stay open, and vice versa.
export let _sdCollapsedRows=new Set();
export const _SD_NO_DWG='(no drawing #)';
export function _sdDwgKey(r){ return String(r.drawing_number||'').trim() || _SD_NO_DWG; }
export function _sdDwgSet(dwg){
  return _sdDwgSettings[dwg] || (_sdDwgSettings[dwg]={});
}
export function _sdDwgProfit(dwg){
  const v=_sdDwgSet(dwg).profitPct;
  return v==null||v==='' ? _sdProfitPct : (parseFloat(v)||0);
}
export function _sdDwgRate(dwg){
  const v=_sdDwgSet(dwg).laborRateMin;
  return v==null||v==='' ? _sdLaborRatePerMin() : (parseFloat(v)||0);
}

// ── How many of this cable the quote covers ──────────────────────────────────
// A drawing describes ONE cable assembly; an order is usually for several. The
// quantity is asked for at Check Price (see the units dialog) and applied by
// multiplying each row's QTY, so the table shows the real purchase quantity —
// which is also the quantity the distributor price breaks get looked up
// against, and that is the whole point: 200 connectors do not cost 20× the
// price of 10.
export function _sdDwgUnits(dwg){
  const n=parseFloat(_sdDwgSet(dwg).units);
  return (isFinite(n) && n>0) ? n : 1;
}
// A crimp/insertion TOOL is bought ONCE for the whole production run — ten
// cables off the same drawing still need one tool. So a tool row is never
// multiplied: not its quantity, not its cost, not its time. Everything that
// scales with the number of cables asks through here, so the rule lives in one
// place instead of being remembered at each call site.
export function _sdUnitsForRow(r){ return _sdIsToolRow(r) ? 1 : _sdDwgUnits(_sdDwgKey(r)); }

// Rescales one drawing's rows to `units` cables. The PER-CABLE quantity is
// remembered on the row the first time this runs, and every later call is
// computed from that baseline rather than from the current QTY. Multiplying the
// live QTY instead would make two presses of "5" mean 25, and lowering 5 to 2
// impossible without re-importing.
export function _sdApplyUnits(dwg, units){
  const u = (isFinite(units) && units>0) ? units : 1;
  _sdDwgSet(dwg).units = u;
  for(const r of sdItems){
    if(_sdDwgKey(r)!==dwg) continue;
    if(_sdIsToolRow(r)){
      // Bought once per run — leave it alone, and undo any scaling a previous
      // pass applied before the row was recognised as a tool.
      if(r._qtyPerUnit!=null && r.qty!==r._qtyPerUnit){ r.qty=r._qtyPerUnit; _sdRecalcRow(r); }
      continue;
    }
    if(r._qtyPerUnit==null) r._qtyPerUnit = parseFloat(r.qty)||0;
    const q = r._qtyPerUnit * u;
    // Six decimals is past any real BOM quantity and keeps 0.1 × 3 from
    // surfacing as 0.30000000000000004 in the table.
    r.qty = +q.toFixed(6);
    _sdRecalcRow(r);
  }
}

// General (not row-tied) labor minutes belonging to ONE drawing.
export function _sdGeneralMinutesFor(dwg){
  let total=0;
  for(const b of S._sdLaborBreakdowns){
    if(!b.generalMinutes) continue;
    if(String(b.drawingName||'')===dwg) total+=b.generalMinutes;
  }
  // Setup/test time the AI couldn't tie to a single row is still per cable.
  return total * _sdDwgUnits(dwg);
}

// One costed group per drawing, in first-seen order so the quote reads in the
// order the drawings were imported.
export function _sdComputeGroups(){
  const order=[]; const byDwg=new Map();
  for(const r of sdItems){
    const k=_sdDwgKey(r);
    if(!byDwg.has(k)){ byDwg.set(k,[]); order.push(k); }
    byDwg.get(k).push(r);
  }
  return order.map(dwg=>{
    const rows=byDwg.get(dwg);
    let partsTotal=0, autoToolsTotal=0, autoLaborMinutes=0;
    const ownedToolRows=[], missingToolRows=[];
    for(const r of rows){
      if(_sdIsToolRow(r)){
        if(_sdIsToolOwned(r)) ownedToolRows.push(r);
        else { missingToolRows.push(r); autoToolsTotal+=r.total||0; }
      } else partsTotal+=r.total||0;
      autoLaborMinutes+=r.labor_total||0;
    }
    autoLaborMinutes += _sdGeneralMinutesFor(dwg);
    const st=_sdDwgSet(dwg);
    const units=_sdDwgUnits(dwg);
    // Everything above is summed across the whole order, because each row's QTY
    // already carries the multiplier. The COST BREAKDOWN is read per cable
    // though — that is the number an engineer reasons about and a customer
    // compares — so the per-cable figures are derived here and the order totals
    // are those multiplied back up. Both scale linearly, so the two can never
    // disagree. A typed Labor Time override is minutes for ONE cable, matching
    // everything else on that panel.
    const partsTotalPerUnit = partsTotal/units;
    const autoLaborMinutesPerUnit = autoLaborMinutes/units;
    const laborMinutesPerUnit = st.laborMinutes!=null && st.laborMinutes!==''
      ? (parseFloat(st.laborMinutes)||0) : autoLaborMinutesPerUnit;
    const laborMinutes = laborMinutesPerUnit*units;
    const rate=_sdDwgRate(dwg);
    const laborCostPerUnit=laborMinutesPerUnit*rate;
    const laborCost=laborCostPerUnit*units;
    // Tools are bought once for the whole run, so this one figure is NOT
    // per cable and is never divided.
    const toolsTotal = st.toolsTotal!=null && st.toolsTotal!=='' ? (parseFloat(st.toolsTotal)||0) : autoToolsTotal;
    const subtotalPerUnit=partsTotalPerUnit+laborCostPerUnit;   // tools excluded by design
    const subtotal=subtotalPerUnit*units;
    const profitPct=_sdDwgProfit(dwg);
    const finalPerUnit=subtotalPerUnit*(1+profitPct/100);
    const final=finalPerUnit*units;
    return {dwg, rows, units,
            partsTotal, autoToolsTotal, toolsTotal, autoLaborMinutes, laborMinutes,
            rate, laborCost, subtotal, profitPct, profit:final-subtotal, final,
            partsTotalPerUnit, autoLaborMinutesPerUnit, laborMinutesPerUnit,
            laborCostPerUnit, subtotalPerUnit, finalPerUnit,
            ownedToolRows, missingToolRows};
  });
}

// Grand totals are the SUM of the per-drawing figures — never recomputed from
// the flat row list. If the two could drift apart, the quote would contradict
// its own breakdown.
export function _sdComputeSummary(){
  const groups=_sdComputeGroups();
  const sum=k=>groups.reduce((a,g)=>a+(g[k]||0),0);
  const partsTotal=sum('partsTotal'), laborCost=sum('laborCost'),
        subtotal=sum('subtotal'), final=sum('final'),
        toolsTotal=sum('toolsTotal'), autoToolsTotal=sum('autoToolsTotal'),
        laborMinutes=sum('laborMinutes'), autoLaborMinutes=sum('autoLaborMinutes');
  return {groups, partsTotal, toolsTotal, autoToolsTotal, laborMinutes, autoLaborMinutes,
          laborCost, subtotal, final,
          ownedToolRows: groups.flatMap(g=>g.ownedToolRows),
          missingToolRows: groups.flatMap(g=>g.missingToolRows)};
}

export async function renderSalesDesk(){
  await loadParts();
  setActions('');
  const SD_COLS=loadColOrder('salesdesk',_SD_DEFAULT_COLS);

  // Shown during the AI labor estimate. Kept out of renderSD() so a re-render
  // mid-estimate can't wipe it.
  const _sdLaborBusy=(txt)=>{
    const el=document.getElementById('sd-labor-progress');
    const t=document.getElementById('sd-labor-progress-txt');
    if(!el) return;
    if(txt){ el.style.display='flex'; if(t) t.textContent=txt; }
    else { el.style.display='none'; }
    // Both entry points get disabled — starting a second estimate on top of a
    // running one would interleave two passes over the same rows.
    ['btn-sd-labor','btn-sd-addpick','btn-sd-fc'].forEach(id=>{
      const b=document.getElementById(id); if(b) b.disabled=!!txt;
    });
  };
  // Wraps the estimate with the banner, the progress text and the result
  // message, so the picker and the button behave identically.
  const _sdRunLaborEstimate=async(force=false)=>{
    _sdLaborBusy('Estimating labor time with AI — this usually takes 5–15 seconds…');
    const onProg=({done,total,drawing,rows})=>{
      _sdLaborBusy(total>1
        ? `Estimating labor time — drawing ${done} of ${total} (${drawing||'no drawing #'}, ${rows} rows)… `
          + `${Math.round(100*done/total)}%`
        : `Estimating labor time for ${rows} row(s)${drawing?' — '+drawing:''}…`);
    };
    try{
      let res=await _sdAutoMatchLabor(onProg,{force});
      // Too many drawings to run unasked — put the cost in front of the user
      // rather than either silently spending it or silently skipping.
      if(res && res.needsConfirm){
        _sdLaborBusy('');
        const go=confirm(
          `${res.needsConfirm} drawings are loaded.\n\n`+
          `Estimating labor runs one AI analysis per drawing — about `+
          `${Math.ceil(res.needsConfirm*8/60)} minute(s) and ${res.needsConfirm} API calls.\n\n`+
          `Run it now for all of them?`);
        if(!go){
          toast('Labor estimate skipped — use ⏱ Estimate Labor when you want it','warn');
          return null;
        }
        _sdLaborBusy('Estimating labor time…');
        res=await _sdAutoMatchLabor(onProg,{force:true});
      }
      renderSalesDesk();
      if(res && res.applied){
        toast(`Labor estimated — ${res.minutes.toFixed(1)} min across ${res.applied} row(s)`,'success');
      } else if(res && res.reason){
        toast('Labor not estimated: '+res.reason,'warn');
      }
      return res;
    }catch(e){
      toast('Labor estimate failed: '+e.message,'error');
      return null;
    }finally{
      _sdLaborBusy('');
    }
  };

  // ── Cost Summary, rendered per drawing ──────────────────────────────────
  // Every drawing gets its own complete costing block (tools, labor, parts,
  // subtotal, profit, final) and the grand total is the sum of those blocks.
  // With many drawings the blocks collapse to a one-line "DWG — $X" so a
  // 200-drawing quote is still readable; the one being worked on can be opened.
  const _sdCollapsed = window._sdCollapsedDwgs || (window._sdCollapsedDwgs=new Set());

  const _sdRenderSummary=()=>{
    const host=document.getElementById('sd-summary-host');
    if(!host) return;
    const {groups, partsTotal, laborCost, subtotal, final, toolsTotal,
           ownedToolRows, missingToolRows} = _sdComputeSummary();
    const $=v=>'$'+(+v||0).toFixed(2);

    // Default: collapse everything once there are enough drawings that an
    // expanded list would bury the grand total.
    if(groups.length>3 && !window._sdCollapseInit){
      window._sdCollapseInit=true;
      groups.forEach(g=>_sdCollapsed.add(g.dwg));
    }

    const block=(g)=>{
      const open=!_sdCollapsed.has(g.dwg);
      const miss=g.missingToolRows, owned=g.ownedToolRows;
      return `
      <div class="sd-panel" data-dwg="${esc(g.dwg)}">
        <div class="sd-panel-title" style="display:flex;align-items:center;gap:7px;cursor:pointer" data-toggle="${esc(g.dwg)}">
          <span style="font-size:11px;width:10px;display:inline-block">${open?'▾':'▸'}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.dwg)}</span>
          <span style="font-size:11px;color:var(--muted);font-weight:400">${g.rows.length} row${g.rows.length===1?'':'s'}${g.units>1?` · ×${g.units}`:''}</span>
          <strong style="color:var(--green)" title="${g.units>1?`Unit price — ${$(g.final)} for all ${g.units}`:'Unit price'}">${$(g.finalPerUnit)}</strong>
        </div>
        ${open?`
        <div style="padding:6px 0">
          <div class="summary-row">
            <span title="How many of this cable the quote covers. Changing it rescales every row's QTY and the labor time.">Units (cables)</span>
            <input type="number" class="sd-in-units" data-dwg="${esc(g.dwg)}" min="1" step="1" value="${g.units}"
              style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-align:right">
          </div>
          <div class="summary-row" style="color:var(--muted)">
            <span title="Crimp/insertion tools not yet in Stock. Bought once for the whole order, not per cable, and never added into Subtotal or the price — type your own number to override.">Tools <em style="font-size:10px;font-style:normal">(not in price, whole order)</em></span>
            <span style="display:flex;align-items:center;gap:2px">$<input type="number" class="sd-in-tools" data-dwg="${esc(g.dwg)}" min="0" step="any"
              value="${g.toolsTotal?+g.toolsTotal.toFixed(2):''}"
              style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-align:right"></span>
          </div>
          <div class="summary-row">
            <span title="Minutes to build ONE cable, worked out from the drawing's manufacturing steps. Click 📋 to see every step behind it. Type your own number to override; it is also per cable." style="display:flex;align-items:center;gap:5px">
              Labor Time (min / cable)
              <button type="button" class="btn btn-ghost btn-sm sd-btn-breakdown" data-dwg="${esc(g.dwg)}" title="Manufacturing-step breakdown behind this number" style="padding:1px 6px;font-size:11px">📋</button>
            </span>
            <input type="number" class="sd-in-minutes" data-dwg="${esc(g.dwg)}" min="0" step="any"
              value="${g.laborMinutesPerUnit?+g.laborMinutesPerUnit.toFixed(2):''}"
              style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-align:right">
          </div>
          <div class="summary-row"><span>Parts Total</span><span>${$(g.partsTotalPerUnit)}</span></div>
          <div class="summary-row">
            <span title="Labor Time × rate per minute — for one cable">Labor Cost</span>
            <span style="display:flex;align-items:center;gap:4px">
              <input type="number" class="sd-in-rate" data-dwg="${esc(g.dwg)}" min="0" step="any" value="${g.rate}"
                title="Rate per minute for this drawing" style="width:54px;padding:2px 5px;border:1px solid var(--border);border-radius:4px;font-size:11px;text-align:right">
              <span>${$(g.laborCostPerUnit)}</span>
            </span>
          </div>
          <div class="summary-row"><span>Subtotal</span><span>${$(g.subtotalPerUnit)}</span></div>
          <div class="summary-row">
            <span>Profit %</span>
            <input type="number" class="sd-in-profit" data-dwg="${esc(g.dwg)}" min="0" step="any" value="${g.profitPct}"
              style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-align:right">
          </div>
        </div>
        <div class="summary-total"><span>Unit Price</span><span>${$(g.finalPerUnit)}</span></div>
        ${g.units>1?`
        <div class="summary-order">
          <span class="lbl">Price per ${g.units} units</span><span>${$(g.final)}</span>
        </div>`:''}
        ${miss.length?`<div style="font-size:13px;color:#92400e;background:#fffbeb;border:2px solid #f59e0b;border-radius:6px;padding:8px 10px;margin-top:8px;line-height:1.4;font-weight:600">
            ⚠ Final price does NOT include manufacturing tools.<br>
            ${miss.length} tool${miss.length>1?'s':''} not in Stock — estimated <strong>${$(g.toolsTotal)}</strong>: ${esc(miss.map(r=>r.part_number||r.description||'tool').join(', '))}
          </div>`:''}
        ${owned.length?`<div style="font-size:11px;color:#1F8B4C;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:4px;padding:5px 8px;margin-top:6px">
            ✓ ${owned.length} tool${owned.length>1?'s':''} excluded — already in Stock: <strong>${esc(owned.map(r=>r.part_number||r.description||'tool').join(', '))}</strong>
          </div>`:''}
        `:''}
      </div>`;
    };

    const grand = groups.length>1 ? `
      <div class="sd-panel" style="border:2px solid var(--blue-dark)">
        <div class="sd-panel-title">Grand Total — ${groups.length} drawings</div>
        <div style="padding:6px 0">
          <div class="summary-row"><span>Parts Total</span><span>${$(partsTotal)}</span></div>
          <div class="summary-row"><span>Labor Cost</span><span>${$(laborCost)}</span></div>
          <div class="summary-row"><span>Subtotal</span><span>${$(subtotal)}</span></div>
          <div class="summary-row" style="color:var(--muted)"><span>Tools (not in price)</span><span>${$(toolsTotal)}</span></div>
        </div>
        <div class="summary-total" style="font-size:15px"><span>TOTAL FINAL PRICE</span><span>${$(final)}</span></div>
        ${missingToolRows.length?`<div style="font-size:13px;color:#92400e;background:#fffbeb;border:2px solid #f59e0b;border-radius:6px;padding:8px 10px;margin-top:8px;font-weight:600">
          ⚠ Total does NOT include ${missingToolRows.length} manufacturing tool${missingToolRows.length>1?'s':''} — ${$(toolsTotal)} quoted separately.
        </div>`:''}
      </div>` : '';

    host.innerHTML = groups.length
      ? (groups.length>1
          ? `<div style="display:flex;gap:6px;align-items:center;font-size:11px">
               <button class="btn btn-ghost btn-sm" id="sd-exp-all">Expand all</button>
               <button class="btn btn-ghost btn-sm" id="sd-col-all">Collapse all</button>
             </div>` : '')
        + groups.map(block).join('') + grand
      : `<div class="sd-panel"><div class="sd-panel-title">Cost Summary</div>
           <div style="padding:14px;color:var(--muted);font-size:12px">No parts yet.</div></div>`;

    // ── wiring ──
    host.querySelectorAll('[data-toggle]').forEach(el=>el.addEventListener('click',()=>{
      const d=el.dataset.toggle;
      if(_sdCollapsed.has(d)) _sdCollapsed.delete(d); else _sdCollapsed.add(d);
      _sdRenderSummary();
    }));
    document.getElementById('sd-exp-all')?.addEventListener('click',()=>{_sdCollapsed.clear();_sdRenderSummary();});
    document.getElementById('sd-col-all')?.addEventListener('click',()=>{
      groups.forEach(g=>_sdCollapsed.add(g.dwg)); _sdRenderSummary();});
    const bind=(sel,key)=>host.querySelectorAll(sel).forEach(inp=>inp.addEventListener('change',()=>{
      const st=_sdDwgSet(inp.dataset.dwg);
      st[key] = inp.value==='' ? null : (parseFloat(inp.value)||0);
      _sdRenderSummary();
    }));
    bind('.sd-in-tools','toolsTotal');
    bind('.sd-in-minutes','laborMinutes');
    bind('.sd-in-rate','laborRateMin');
    bind('.sd-in-profit','profitPct');
    // Not part of bind(): this one rewrites every row's QTY, so the whole
    // screen has to redraw, not just the summary panel.
    host.querySelectorAll('.sd-in-units').forEach(inp=>inp.addEventListener('change',()=>{
      const v=parseFloat(inp.value);
      if(!isFinite(v)||v<=0){ inp.value=_sdDwgUnits(inp.dataset.dwg); return; }
      _sdApplyUnits(inp.dataset.dwg, v);
      renderSalesDesk();
    }));
    host.querySelectorAll('.sd-btn-breakdown').forEach(b=>
      b.addEventListener('click',()=>openLaborBreakdownModal(b.dataset.dwg)));
  };

  const _sdUpdateSummaryUI=()=>_sdRenderSummary();

  const renderSD=()=>{
    const predicate=parseBoolQuery(_sdFilterQ);
    const visibleIdx=sdItems.map((r,i)=>i).filter(i=>{
      if(!_sdFilterQ.trim()) return true;
      const r=sdItems[i];
      return predicate(_SD_DEFAULT_COLS.map(c=>String(r[c.k]||'')).join(' | ').toLowerCase());
    });
    if(_sdSortCol){
      visibleIdx.sort((ia,ib)=>{
        let va=_sdSortValue(sdItems[ia],_sdSortCol), vb=_sdSortValue(sdItems[ib],_sdSortCol);
        if(_SD_NUMERIC_COLS.has(_sdSortCol)){ va=parseFloat(va)||0; vb=parseFloat(vb)||0; }
        else { va=String(va||'').toLowerCase(); vb=String(vb||'').toLowerCase(); }
        return _sdSortAsc?(va<vb?-1:va>vb?1:0):(va<vb?1:va>vb?-1:0);
      });
    }
    // Grouped by drawing, with a header row carrying that drawing's subtotal.
    // A flat list of 200 drawings' parts is unreadable and gives no sense of
    // what any one assembly costs — which is the question being asked.
    const _groups=_sdComputeGroups();
    const _finalFor={}; _groups.forEach(g=>{_finalFor[g.dwg]=g;});
    const _seen=new Set();
    const tbody=visibleIdx.map(i=>{
      const r=sdItems[i];
      const dwg=_sdDwgKey(r);
      let head='';
      if(!_seen.has(dwg)){
        _seen.add(dwg);
        const g=_finalFor[dwg];
        const hidden=_sdCollapsedRows.has(dwg);
        head=`<tr class="sd-group-head" data-dwg="${esc(dwg)}" style="background:#EEF2F7;cursor:pointer">
          <td colspan="${SD_COLS.length+2}" style="padding:6px 10px;font-weight:700;color:var(--blue-dark)">
            <span style="display:inline-block;width:12px">${hidden?'▸':'▾'}</span>
            ${esc(dwg)}
            ${_sdDwgUnits(dwg)>1?`<span style="margin-inline-start:6px;padding:1px 6px;border-radius:8px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:700" title="QTY on every row below is multiplied by this">× ${_sdDwgUnits(dwg)} cables</span>`:''}
            <span style="font-weight:400;color:var(--muted);font-size:11px;margin-inline-start:8px">${g?g.rows.length:0} rows</span>
            ${g?`<span style="float:inline-end;color:var(--green)">$${g.final.toFixed(2)}</span>`:''}
          </td></tr>`;
      }
      if(_sdCollapsedRows.has(dwg)) return head;
      return head+`<tr data-i="${i}"${_toolRowAttrs(r)}>
      <td style="text-align:center"><input type="checkbox" class="sd-check" data-i="${i}"></td>
      ${SD_COLS.map(c=>`<td${c.wrap?' class="wrap"':''}>${_sdCellHTML(c.k,r,i)}</td>`).join('')}
      <td><button class="btn btn-red btn-sm" data-i="${i}">✕</button></td>
    </tr>`;
    }).join('');

    document.getElementById('sd-tbody').innerHTML=tbody||
      `<tr class="empty-row"><td colspan="${SD_COLS.length+2}">No parts added yet</td></tr>`;
    document.querySelectorAll('.sd-group-head').forEach(tr=>tr.addEventListener('click',()=>{
      const d=tr.dataset.dwg;
      if(_sdCollapsedRows.has(d)) _sdCollapsedRows.delete(d); else _sdCollapsedRows.add(d);
      renderSD();
    }));
    const cEl=document.getElementById('sd-count'); if(cEl) cEl.textContent=sdItems.length;
    const fEl=document.getElementById('sd-flt-count');
    if(fEl) fEl.textContent = _sdFilterQ.trim() ? `${visibleIdx.length}/${sdItems.length} parts` : `${sdItems.length} parts`;
    _sdUpdateSummaryUI();
    _sdRenderNotesPanel();

    document.querySelectorAll('.sd-qty').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.i, qty=parseFloat(inp.value)||1;
      sdItems[i].qty=qty; _sdRecalcRow(sdItems[i]); renderSD();
    }));
    document.querySelectorAll('.sd-labor-time').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.i, v=inp.value.trim(), r=sdItems[i];
      if(v===''){
        r._laborManualOverride=false;
        _sdRecalcLaborTotal(r);
      } else {
        r._laborManualOverride=true;
        r.labor_total=parseFloat(v)||0;
      }
      renderSD();
    }));
    document.querySelectorAll('.sd-part-number').forEach(inp=>inp.addEventListener('change',()=>{
      sdItems[+inp.dataset.i].part_number=inp.value.trim();
    }));
    document.querySelectorAll('.sd-drawing-number').forEach(inp=>inp.addEventListener('change',()=>{
      sdItems[+inp.dataset.i].drawing_number=inp.value.trim();
    }));
    document.querySelectorAll('.sd-description').forEach(inp=>inp.addEventListener('change',()=>{
      sdItems[+inp.dataset.i].description=inp.value.trim();
    }));
    document.querySelectorAll('.sd-manufacturer').forEach(inp=>inp.addEventListener('change',()=>{
      sdItems[+inp.dataset.i].manufacturer=inp.value.trim();
    }));
    document.querySelectorAll('.sd-unit').forEach(sel=>sel.addEventListener('change',()=>{
      const i=+sel.dataset.i;
      sdItems[i].unit=sel.value;
      _sdRecalcRow(sdItems[i]); renderSD();
    }));
    document.querySelectorAll('.sd-manual-total').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.i, v=inp.value.trim();
      sdItems[i].manual_total = v===''?null:v;
      _sdRecalcRow(sdItems[i]); renderSD();
    }));
    document.querySelectorAll('#sd-tbody .btn-red').forEach(btn=>btn.addEventListener('click',()=>{
      sdItems.splice(+btn.dataset.i,1); renderSD();
    }));
  };

  setContent(`
    <div class="sd-split">
      <div class="sd-panel">
        <div class="sd-panel-title">BOM Items</div>
        <div style="padding:9px 11px;border-bottom:1px solid var(--border);display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn btn-blue" id="btn-sd-addpick">📦 Add from Database</button>
          <button class="btn btn-blue" id="btn-sd-file">📎 New Drawing</button>
          <button class="btn btn-blue" id="btn-sd-newrow">➕ New Row</button>
          <button class="btn btn-green" id="btn-sd-fc" style="white-space:nowrap">🔍 Check Price</button>
          <!-- Runs the same estimate the picker triggers, on demand. Needed
               because rows can arrive with no labor for several reasons (added
               before a key was configured, a failed call, manually created) and
               without this the only way to retry was to delete and re-add. -->
          <button class="btn" id="btn-sd-labor" style="white-space:nowrap" title="Estimate Labor Time for rows that don't have one yet">⏱ Estimate Labor</button>
          <button class="btn btn-red" id="btn-sd-clear">Clear All</button>
        </div>
        <div style="padding:9px 11px;border-bottom:1px solid var(--border);display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          <div class="search-wrap" style="flex:1;min-width:180px">
            <input class="search-box" id="sd-search" placeholder='Search — supports AND / OR / NOT / "phrase" / (...)' value="${esc(_sdFilterQ)}">
            <button type="button" class="search-clear" id="sd-search-clear" title="Clear">✕</button>
          </div>
          <button class="tbl-scroll-btn" id="sd-scroll-left" title="Scroll left">◀</button>
          <button class="tbl-scroll-btn" id="sd-scroll-right" title="Scroll right">▶</button>
          <span class="count-badge" id="sd-flt-count" style="white-space:nowrap">${sdItems.length} parts</span>
        </div>
        <div class="sd-scroll table-wrap" id="sd-table-wrap">
          <table style="width:100%" id="sd-table">
            <thead><tr>
              <th style="width:28px"><input type="checkbox" id="sd-check-all" title="Select all"></th>
              ${SD_COLS.map(c=>`<th data-col="${c.k}" style="min-width:${c.w}" title="Click to sort — drag to reorder">${c.l}${c.k===_sdSortCol?(_sdSortAsc?' ▲':' ▼'):''}</th>`).join('')}
              <th style="width:40px"></th>
            </tr></thead>
            <tbody id="sd-tbody"></tbody>
          </table>
        </div>
        ${_PRICE_LEGEND_HTML}
        <div id="sd-notes-panel" style="display:none;padding:11px;border-top:1px solid var(--border)"></div>
        <!-- Labor estimation is a 5-15 second AI call. Without this the table
             just sits there and the button looks dead — the user has no way to
             know work is happening, let alone that it's nearly done. -->
        <div id="sd-labor-progress" style="display:none;padding:10px 12px;border-top:1px solid var(--border);
             background:#EFF6FF;color:#1E40AF;font-size:12px;align-items:center;gap:9px">
          <div class="ring" style="width:15px;height:15px;border-width:2px;flex-shrink:0"></div>
          <span id="sd-labor-progress-txt">Estimating labor time…</span>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <!-- Rendered by _sdRenderSummary(). Costing is per DRAWING now, so
             the panel can't be static markup with fixed ids: the number of
             blocks depends on how many drawings are loaded. -->
        <div id="sd-summary-host" style="display:flex;flex-direction:column;gap:10px"></div>
        <button class="btn btn-green" style="width:100%;padding:10px;justify-content:center" id="btn-sd-export">📊 Export to Excel</button>
      </div>
    </div>`);

  renderSD();
  makeTableResizable(document.getElementById('sd-table'));
  makeColumnsReorderable(document.getElementById('sd-table'),'salesdesk',SD_COLS,()=>renderSalesDesk());
  wireScrollButtons('#sd-table-wrap','sd-scroll-left','sd-scroll-right');
  wireShiftCheck(document.getElementById('sd-table'),'.sd-check');
  document.querySelectorAll('#sd-table thead th[data-col]').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.col;
    if(_sdSortCol===k) _sdSortAsc=!_sdSortAsc; else { _sdSortCol=k; _sdSortAsc=true; }
    renderSalesDesk();
  }));

  // Search box — same AND/OR/NOT/"phrase"/(...) boolean query syntax as the
  // Database table (see parseBoolQuery); renderSD() already reads _sdFilterQ
  // and filters sdItems by it on every call, this just exposes it in the UI.
  const sdSearchInp=document.getElementById('sd-search');
  wireSearchClear('sd-search','sd-search-clear');
  sdSearchInp.addEventListener('input',debounce(()=>{
    _sdFilterQ=sdSearchInp.value;
    renderSD();
  },200));

  // Tools / Labor Time / Profit are per-drawing inputs now, created and wired
  // inside _sdRenderSummary(). The old global handlers pointed at ids that no
  // longer exist and would throw on every Sales Desk render.

  document.getElementById('btn-sd-addpick').addEventListener('click',()=>{
    openPartPickerModal(async(parts,qtyOverride,hadSelection)=>{
      let added=0;
      for(const p of parts){
        const origQty=String(p.qty||'').trim();
        const qty = hadSelection ? ((qtyOverride!==1||!origQty) ? qtyOverride : (parseFloat(origQty)||1)) : (parseFloat(p.qty)||1);
        const item={part_number:p.part_number||'',description:p.description||'',
          // Everything the Database already knows about this part comes across.
          // Re-deriving the manufacturer from a price check when it's sitting
          // right there in the record is wasted work, and leaves the column
          // blank until someone happens to run Check Price.
          manufacturer:p.manufacturer||'',
          alt_mpns:(p.alt_mpns||[]),
          est_price:parseFloat(p.est_price)||0,
          drawing_number:p.drawing_number||p.drawing_name||'',
          qty, unit:p.unit||p.units||'pcs',priority_price:parseFloat(p.priority_price)||0,
          mouser_price:parseFloat(p.mouser_price)||'', digikey_price:parseFloat(p.digikey_price)||'',
          total:0, labor_time:'', labor_total:0};
        _sdRecalcRow(item);
        sdItems.push(item);
        added++;
      }
      renderSalesDesk();
      toast(`Added ${added} part(s) to Sales Desk`,'success');
      logAudit('sales_desk_add_from_picker',{count:added},true);
      // The labor estimate is an AI call, so it takes a moment. Without this
      // the Labor Time column just sits at 0 for a few seconds and looks broken
      // — which is exactly how the old empty stub looked.
      await _sdRunLaborEstimate();
    });
  });

  document.getElementById('btn-sd-clear').addEventListener('click',()=>{
    sdItems=[];_sdFilterQ='';_sdLaborMinutesOverride=null;_sdToolsTotalOverride=null;
    _sdDwgSettings={}; _sdCollapsedRows=new Set();   // per-drawing state must not carry over
    window._sdCollapsedDwgs=new Set(); window._sdCollapseInit=false;
    S._sdLaborBreakdowns=[];S._sdPendingLaborByKey={};_sdDrawingNotes=[];
    renderSD();
  });
  document.getElementById('btn-sd-newrow').addEventListener('click',()=>{
    sdItems.push({part_number:'',description:'',manufacturer:'',drawing_number:'',qty:1,unit:'',
      priority_price:0,total:0,labor_time:'',labor_total:0});
    renderSD();
  });
  document.getElementById('btn-sd-labor')?.addEventListener('click',async()=>{
    if(!sdItems.length){ toast('No parts in Sales Desk','error'); return; }
    await _sdRunLaborEstimate(true);   // pressing the button IS the confirmation
  });

  document.getElementById('btn-sd-export').addEventListener('click',()=>exportSalesDeskExcel());

  // SD check-all toggle
  document.addEventListener('change',e=>{
    if(e.target.id==='sd-check-all'){
      document.querySelectorAll('.sd-check').forEach(cb=>cb.checked=e.target.checked);
    }
  });

  // SD FindChips button
  document.getElementById('btn-sd-fc').addEventListener('click',()=>{
    const checked=[...document.querySelectorAll('.sd-check:checked')].map(cb=>Number(cb.dataset.i));
    const targets = checked.length
      ? sdItems.filter((_,i)=>checked.includes(i))
      : sdItems;
    if(!targets.some(r=>r.part_number)){toast('No parts to check','error');return;}
    // How many cables before what they cost — a price break for 10 pieces is a
    // different number from the price break for 200.
    _sdAskUnitsThenCheck(targets);
  });

  // From File (BOM extraction for Sales Desk)
  document.getElementById('btn-sd-file').addEventListener('click',()=>{
    if(!_aiReady()){ showSettingsModal(()=>document.getElementById('btn-sd-file')?.click()); return; }
    openSDFileModal();
  });
}
