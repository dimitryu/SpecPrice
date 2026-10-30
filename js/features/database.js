import { S } from '../core/state.js';
import { logAudit } from '../core/audit.js';
import { loadColOrder, makeColumnsReorderable, makeTableResizable, parseBoolQuery, wireScrollButtons, wireSearchClear, wireShiftCheck } from '../core/table.js';
import { _buildPager, closeModal, debounce, esc, fmtDate, fmtPrice, setActions, setContent, showModal, toast } from '../core/ui.js';
import { _PS_TRASH_DAY_OPTIONS, _psAutoPurge, _psDaysLeft, _psDeletedMs, _psIsAdmin, _psPurge, _psRestore, _psSetTrashDays, _psSoftDelete, loadParts, purgeLegacyFindChipsFields, updatePartFields } from '../data/parts.js';
import { _sdLineCost } from '../domain/pricing.js';
import { openImportDataModal } from './importData.js';
import { runFCCheckModal } from './priceCheck.js';
import { exportPartStockExcel } from './salesDesk/export.js';

export let sortCol     = 'part_number';
export let sortAsc     = true;
export let psPage      = 1;
export let psPageSize  = (()=>{ const v=localStorage.getItem('psPageSize'); return v==='all' ? 'all' : (parseInt(v)||20); })();
export function openTrashModal(onChange){
  const render=()=>{
    const now=Date.now();
    const rows=[...S.trashParts].sort((a,b)=>_psDeletedMs(b)-_psDeletedMs(a));
    const fmt=ms=>ms?new Date(ms).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'—';
    const body=document.getElementById('trash-body');
    if(!body) return;
    body.innerHTML=`
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:13px">Deleted parts are kept for</span>
        <select id="trash-days" class="search-box" style="width:auto;flex:0 0 auto;padding:5px 8px">
          ${_PS_TRASH_DAY_OPTIONS.map(d=>`<option value="${d}" ${d===S._psTrashDays?'selected':''}>${d} days</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--muted)">then removed for good. The audit log keeps a copy of every deleted part.</span>
        <span style="flex:1"></span>
        <button class="btn btn-green btn-sm" id="trash-restore" ${rows.length?'':'disabled'}>↩ Restore selected</button>
        <button class="btn btn-red btn-sm" id="trash-purge" ${rows.length?'':'disabled'}>✕ Delete permanently</button>
      </div>
      <div class="table-wrap" style="max-height:60vh"><table>
        <thead><tr><th style="width:28px"><input type="checkbox" id="trash-all"></th>
          <th>MNF P/N</th><th>Description</th><th>Manufacturer</th><th>Deleted by</th><th>Deleted</th>
          <th style="width:80px">Days left</th></tr></thead>
        <tbody>${rows.length ? rows.map(p=>`<tr>
          <td style="text-align:center"><input type="checkbox" class="trash-check" data-id="${esc(p._id)}"></td>
          <td>${esc(p.part_number||p._id)}</td>
          <td class="wrap">${esc(p.description||'')}</td>
          <td>${esc(p.manufacturer||'')}</td>
          <td>${esc(p.deletedBy||'')}</td>
          <td style="white-space:nowrap">${esc(fmt(_psDeletedMs(p)))}</td>
          <td style="text-align:center">${_psDaysLeft(p,S._psTrashDays,now)}</td>
        </tr>`).join('') : `<tr class="empty-row"><td colspan="7">The recycle bin is empty</td></tr>`}</tbody>
      </table></div>`;
    const sel=()=>[...body.querySelectorAll('.trash-check:checked')].map(c=>c.dataset.id);
    body.querySelector('#trash-all')?.addEventListener('change',e=>
      body.querySelectorAll('.trash-check').forEach(c=>{ c.checked=e.target.checked; }));
    body.querySelector('#trash-days')?.addEventListener('change',async e=>{
      try{ await _psSetTrashDays(e.target.value); toast(`Deleted parts are now kept for ${S._psTrashDays} days`,'success'); render(); }
      catch(err){ toast('Error: '+err.message,'error'); }
    });
    body.querySelector('#trash-restore')?.addEventListener('click',async()=>{
      const ids=sel(); if(!ids.length){ toast('No rows selected','error'); return; }
      try{ const n=await _psRestore(ids); toast(`Restored ${n} part(s)`,'success'); render(); onChange&&onChange(); }
      catch(err){ toast('Error: '+err.message,'error'); logAudit('database_restore_parts',{error:err.message},false); }
    });
    body.querySelector('#trash-purge')?.addEventListener('click',async()=>{
      const ids=sel(); if(!ids.length){ toast('No rows selected','error'); return; }
      if(!confirm(`Delete ${ids.length} part(s) permanently? They cannot be restored from the app afterwards.`)) return;
      try{ const n=await _psPurge(ids,'manual'); toast(`Permanently deleted ${n} part(s)`,'success'); render(); onChange&&onChange(); }
      catch(err){ toast('Error: '+err.message,'error'); logAudit('database_purge_parts',{error:err.message},false); }
    });
  };
  showModal(`<div class="modal" style="max-width:1000px;width:96vw">
    <div class="modal-head"><h3>🗑 Deleted items</h3><button class="btn btn-ghost btn-sm" id="trash-close">✕</button></div>
    <div class="modal-body" id="trash-body"></div></div>`);
  document.getElementById('trash-close')?.addEventListener('click',()=>{ closeModal(); onChange&&onChange(); });
  render();
}

export const _PS_DEFAULT_COLS=[
  // Canonical column order, shared with Sales Desk and the Check Price modal
  // (see _SD_DEFAULT_COLS): identity → description → maker → quantity → prices.
  // Each vendor's stock sits immediately beside that vendor's price, because
  // a price you can't buy is worth knowing about at a glance.
  {k:'drawing_number',l:'Drawing #',       w:'100px'},
  {k:'part_number',   l:'MNF P/N',    w:'120px'},
  {k:'drawing_name',  l:'Drawing Name',    w:'130px'},
  {k:'atlantium_pn',  l:'Customer PN',     w:'100px'},
  {k:'description',   l:'Description',     w:'200px',wrap:true},
  {k:'manufacturer',  l:'Manufacturer',    w:'110px'},
  {k:'qty',           l:'QTY',              w:'55px'},
  {k:'unit',          l:'Units',            w:'55px'},
  {k:'mouser_price',  l:'Mouser Price',     w:'95px'},
  {k:'mouser_stock',  l:'Mouser Stock',     w:'85px'},
  {k:'digikey_price', l:'DigiKey Price',    w:'95px'},
  {k:'digikey_stock', l:'DigiKey Stock',    w:'85px'},
  {k:'priority_price',l:'Priority Price',   w:'95px'},
  {k:'own_stock',     l:'In Stock (ours)',  w:'95px'},
  {k:'rfq_names',     l:'RFQ',             w:'140px',wrap:true},
  {k:'pin_count',       l:'Pins',           w:'55px'},
  {k:'updatedAt',     l:'Updated',          w:'90px'},
  // Not a price source any more — just a shortcut to eyeball the wider
  // distributor landscape (Arrow, Avnet, TTI...) that our two APIs don't cover.
  {k:'_fc',           l:'FindChips',        w:'80px'},
];
// Shared price-comparison colouring for every price column (Mouser / DigiKey /
// Priority) in BOTH the Database and Sales Desk, so the same number never means
// two different things depending on which screen you're looking at.
// Across all the prices a row actually HAS: cheapest → green, dearest → red,
// anything in between → uncoloured. A single price is left uncoloured, since
// "cheapest" is meaningless with nothing to compare against.
export const _PRICE_FIELDS=['priority_price','mouser_price','digikey_price'];

// WHAT IS COMPARED, and why it isn't the displayed number.
// The cells show a per-unit price, but the sources don't quote on the same
// basis: Priority prices cable per METRE while Mouser and DigiKey quote it per
// FOOT. Ranking the raw numbers therefore gave the wrong answer on every mm
// row — $2.00/m from Priority looked dearer than $0.65/ft from DigiKey, when
// per metre DigiKey is actually $2.13. So the colours rank each source by what
// the row would ACTUALLY COST (quantity included, units reconciled), which is
// the question the colour is meant to answer.
// On "pc" rows every source is already per piece, so multiplying by the row's
// quantity changes nothing about the ordering — the colours there are the same
// as before. This matters only where the units genuinely differ.
export function _priceRankValue(row, field){
  return typeof _sdLineCost==='function' ? _sdLineCost(row, field)
                                         : (parseFloat(row[field])||0);
}
// Shows the COST FOR THE ROW'S QUANTITY, not the per-unit price. Change QTY
// and every price column moves with it, which is what makes the three figures
// answerable ("which supplier is cheaper for what I'm actually buying?") and
// consistent with Part Cost, the Check Price modal and the exported quotation.
// The per-unit price is kept in the tooltip — it's still the number you'd read
// off a datasheet or paste into a PO, just not the one you compare on.
// In the Database every row has QTY 1, so cost and unit price coincide there
// and nothing about that screen changes.
// Which vendor a price column belongs to, for the match marker below.
// Priority has no marker: it's our own ERP, keyed on the exact part number, so
// there is no "similar part" case to warn about.
export const _MATCH_FOR={
  mouser_price:{code:'mouser_match', mpn:'mouser_mpn', name:'Mouser',
                mfr:'mouser_mfr', alts:'mouser_alts', desc:'mouser_desc', cands:'mouser_cands', by:'mouser_by'},
  digikey_price:{code:'digikey_match', mpn:'digikey_mpn', name:'DigiKey',
                 mfr:'digikey_mfr', alts:'digikey_alts', desc:'digikey_desc', cands:'digikey_cands', by:'digikey_by'}};

// Tells the reader whether this price is for THE part or merely a close one.
// Same three symbols as the Check Price modal, now attached to the number
// itself so the distinction survives long after that modal was closed —
// including for whoever reads the quote instead of running the check.
export function _matchMarkerHTML(row, field){
  const cfg=_MATCH_FOR[field];
  if(!cfg) return '';
  const code=row[cfg.code]||'';
  const mpn=row[cfg.mpn]||'';
  const alts=parseInt(row[cfg.alts],10)||1;
  const mfr=row[cfg.mfr]||'';
  const vdesc=row[cfg.desc]||'';
  // Several manufacturers sell this same part number and one had to be picked.
  // That choice changes the price by orders of magnitude on spec parts, so it
  // gets its own marker rather than hiding inside a plain ✓.
  if(alts>1 && (code==='exact'||code==='approx')){
    const cands=Array.isArray(row[cfg.cands])?row[cfg.cands]:[];
    // List everything that was compared, with the score each got. If the scores
    // are all 0 the descriptions couldn't be read and the pick was arbitrary —
    // which is exactly what you need to see, not something to hide.
    const by=row[cfg.by]||'';
    const money=v=>v>0?('$'+(+v).toFixed(2)):'—';
    const lines = cands.length
      ? cands.map(c=>`  ${money(c.price)}  ${c.mfr||'?'} — ${c.desc||'(no description)'}   [match ${c.score}]`).join('\n')
      : `  (candidate details unavailable — re-run Check Price)`;
    const tip=`${alts} products on ${cfg.name} share the part number "${row.part_number||''}".\n\n`
            + `Your BOM says:\n  ${row.description||'(no description)'}\n\n`
            + `Compared:\n${lines}\n\n`
            + `Chosen: ${mfr||'?'} — ${vdesc||'(no description)'}\n`
            + (by==='price'
                ? `Reason: none of the descriptions matched better than the others, so the CHEAPEST was taken.`
                : by==='description'
                  ? `Reason: best description match.`
                  : `Reason: only candidate with a price.`)
            + `\n\nSame spec number, different manufacturers — check this is the right one.`;
    // Purple when the description decided it; amber when price broke the tie —
    // the amber ones are the rows worth a human glance.
    const byPrice = by==='price';
    return `<span title="${esc(tip)}" style="margin-inline-start:4px;color:${byPrice?'#B45309':'#7C3AED'};font-weight:700;cursor:help">${byPrice?'≈$':'✓'}${alts}</span>`;
  }
  if(code==='exact'){
    return `<span title="${esc(`Exact match — ${cfg.name} lists this part number${mfr?` (${mfr})`:''}`)}" style="margin-inline-start:4px;color:var(--green);font-weight:700">✓</span>`;
  }
  if(code==='approx'){
    return `<span title="${esc(`Matched as "${mpn}" on ${cfg.name} — same part, different punctuation/zero-padding to "${row.part_number||''}". Verify before quoting.`)}" style="margin-inline-start:4px;color:#B45309;font-weight:700;cursor:help">✓ ≈</span>`;
  }
  if(code==='noprice'){
    return `<span title="${esc(`${cfg.name} lists this part${mpn?` as "${mpn}"`:''} but publishes no price — usually non-stocked or quote-only.`)}" style="margin-inline-start:4px;color:#B45309;font-weight:700;cursor:help">◑</span>`;
  }
  return '';
}

// Stock reads differently from a price: 0 is a real, actionable answer and an
// empty cell means "this vendor doesn't list the part at all". Amber for a
// listed-but-empty vendor so it's visible without hunting.
export function _stockCellHTML(row, field){
  const raw=row[field];
  if(raw===undefined || raw===null || raw==='') return '<span style="color:var(--muted)">—</span>';
  const n=parseInt(raw,10)||0;
  return n>0
    ? `<span title="Units on hand">${n.toLocaleString()}</span>`
    : `<span style="color:#B45309;font-weight:600" title="Listed by this vendor, but none in stock">0</span>`;
}

export function _priceCellHTML(row, field){
  const unit=parseFloat(row[field])||0;
  const mine=unit ? _priceRankValue(row, field) : 0;
  if(!(mine>0)){
    // No price, but the vendor DOES list the part — say so instead of leaving
    // an empty cell that reads as "never checked".
    const marker=_matchMarkerHTML(row, field);
    return (row[(_MATCH_FOR[field]||{}).code]==='noprice') ? marker : '';
  }
  const qty=parseFloat(row.qty)||1;
  const all=_PRICE_FIELDS.map(f=>_priceRankValue(row,f)).filter(n=>n>0);
  const cls = all.length<2 ? ''
            : (mine<=Math.min(...all) ? 'price-green'
            : (mine>=Math.max(...all) ? 'price-red' : ''));
  const title=`Unit price ${fmtPrice(unit)} × QTY ${qty}${row.unit?' '+row.unit:''} = $${mine.toFixed(2)}`;
  return `<span class="${cls}" title="${esc(title)}">$${mine.toFixed(2)}</span>`
       + _matchMarkerHTML(row, field);
}

// Renders the inner HTML for a single Part Stock cell, given a column key and part row
export function _psCellHTML(k,p){
  // Built from the part number rather than stored: there's nothing to keep in
  // sync, and it works for parts that have never been price-checked.
  const fcUrl=`https://www.findchips.com/search/${encodeURIComponent(p.part_number||'')}`;
  switch(k){
    // All price columns share one comparison rule — see _priceCellHTML.
    case 'priority_price':
    case 'mouser_price':
    case 'digikey_price': return _priceCellHTML(p,k);
    case 'mouser_stock':
    case 'digikey_stock': return _stockCellHTML(p,k);
    case 'unit': return esc(p.unit||p.units||'');
    case 'rfq_names': return esc((p.rfq_names||[]).join(', '));
    case 'updatedAt': return fmtDate(p.updatedAt);
    // A part with QVL alternatives shows how many were (or will be) compared;
    // otherwise the fact that the shown part number is a CHOICE is invisible.
    case 'part_number': {
      const alts=(p.alt_mpns||[]).filter(a=>a&&a.mpn);
      if(alts.length<2) return esc(p.part_number);
      const tip='Customer-approved alternatives (QVL) — Check Price quotes the cheapest:\n\n'
                +alts.map(a=>'• '+a.mpn+(a.manufacturer?`  [${a.manufacturer}]`:'')).join('\n');
      return `${esc(p.part_number)} <span style="padding:1px 5px;border-radius:8px;background:#EDE9FE;color:#5B21B6;font-size:9px;font-weight:700;cursor:help" title="${esc(tip)}">${alts.length} QVL</span>`;
    }
    case '_fc': return p.part_number?`<a href="${fcUrl}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none;font-size:11px" title="Open this part on findchips.com">🔍 View</a>`:'';
    // Whether WE physically stock/own this part (distinct from `stock`, which
    // is a distributor inventory count) — auto-checked for items
    // brought in via Import Data → Tools Catalog (see saveToolsImport), but
    // toggleable by hand for any part. Sales Desk reads this flag to decide
    // whether a synthesized crimp/insertion TOOL row is already owned and
    // should be excluded from the final price (see handleSDFiles).
    case 'own_stock': return `<input type="checkbox" class="ps-stock-toggle" data-id="${esc(p._id)}" ${p.own_stock?'checked':''} title="We already have this in stock">`;
    default: return esc(p[k]);
  }
}

// The same legend the Sales Desk and Check Price modal carry. These markers
// appear on Database price cells too, and a symbol whose meaning lives on
// another screen may as well not be there.
export const _PRICE_LEGEND_HTML = `
  <div style="padding:7px 12px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);
       display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center">
    <span>Mouser / DigiKey price:</span>
    <span><strong style="color:var(--green)">✓</strong> exact part number</span>
    <span><strong style="color:#B45309">✓ ≈</strong> matched under a differently formatted part number — hover to see which</span>
    <span><strong style="color:#B45309">◑</strong> listed, but no published price</span>
    <span><strong style="color:#7C3AED">✓n</strong> n manufacturers share this part number — chosen by description match</span>
    <span><strong style="color:#B45309">≈$n</strong> descriptions didn't separate them — cheapest taken; hover to see all n</span>
    <span><strong style="color:#B45309">Stock 0</strong> listed, none on hand · <strong>—</strong> not listed by that vendor</span>
  </div>`;

export async function renderPartStock(filter=''){
  setContent(`<div style="text-align:center;padding:60px;color:var(--muted)"><div class="ring" style="margin:0 auto 12px"></div>Loading parts…</div>`);
  setActions('');
  try { await loadParts(); } catch(e){ setContent(`<p style="color:red;padding:20px">${e.message}</p>`); return; }
  purgeLegacyFindChipsFields();  // fire-and-forget; never blocks the render
  await _psAutoPurge();          // admins only; removes parts past their retention

  const predicate=parseBoolQuery(filter);
  const filtered=(filter||'').trim()
    ? S.allParts.filter(p=>predicate([p.part_number,p.drawing_number,p.drawing_name,p.atlantium_pn,p.description,
        p.manufacturer,p.distributor,p.qty,p.unit,p.units,(p.rfq_names||[]).join(' '),
        p.pin_count].map(v=>String(v||'')).join(' | ').toLowerCase()))
    : S.allParts;

  // Sort ALWAYS runs over the full filtered set (all matching parts across every page),
  // never just the rows currently visible on screen.
  const sorted=[...filtered].sort((a,b)=>{
    let va=String(a[sortCol]||'').toLowerCase(), vb=String(b[sortCol]||'').toLowerCase();
    if(['price','priority_price','mouser_price','digikey_price'].includes(sortCol)){va=parseFloat(a[sortCol])||0;vb=parseFloat(b[sortCol])||0;}
    return sortAsc?(va<vb?-1:va>vb?1:0):(va<vb?1:va>vb?-1:0);
  });

  // Pagination is applied last, purely for display — search filtering and sorting above
  // already operated across the entire dataset.
  const totalItems=sorted.length;
  const effPageSize = psPageSize==='all' ? Math.max(totalItems,1) : psPageSize;
  const totalPages = psPageSize==='all' ? 1 : Math.max(1,Math.ceil(totalItems/psPageSize));
  if(psPage>totalPages) psPage=totalPages;
  if(psPage<1) psPage=1;
  const pageStart=(psPage-1)*effPageSize;
  const pageRows=sorted.slice(pageStart,pageStart+effPageSize);

  const COLS=loadColOrder('partstock',_PS_DEFAULT_COLS);
  const arrow=k=>k===sortCol?(sortAsc?' ▲':' ▼'):'';
  const rows=pageRows.map(p=>`<tr data-id="${esc(p._id)}">
      <td style="text-align:center"><input type="checkbox" class="ps-check" data-id="${esc(p._id)}"></td>
      ${COLS.map(c=>`<td${c.wrap?' class="wrap"':''}>${_psCellHTML(c.k,p)}</td>`).join('')}
    </tr>`).join('');

  const pageSizeOpts=[10,20,50,100,200,500].map(n=>`<option value="${n}" ${n===psPageSize?'selected':''}>${n}/page</option>`).join('')
    +`<option value="all" ${psPageSize==='all'?'selected':''}>All</option>`;

  setContent(`
    <div class="toolbar">
      <div class="search-wrap">
        <input class="search-box" id="ps-search" placeholder='Search — supports AND / OR / NOT / "phrase" / (...)' value="${esc(filter)}">
        <button type="button" class="search-clear" id="ps-search-clear" title="Clear">✕</button>
      </div>
      <button class="tbl-scroll-btn" id="ps-scroll-left" title="Scroll left">◀</button>
      <button class="tbl-scroll-btn" id="ps-scroll-right" title="Scroll right">▶</button>
      <select class="search-box" id="ps-page-size" style="flex:0 0 auto;min-width:auto;width:auto;padding:7px 9px">${pageSizeOpts}</select>
      <button class="btn btn-ghost" id="btn-ps-refresh" style="white-space:nowrap;flex-shrink:0" title="Reload latest data from the database">🔄 Refresh</button>
      <button class="btn btn-blue" id="btn-ps-fc" style="white-space:nowrap;flex-shrink:0">🔍 Check Price</button>
      <button class="btn btn-purple" id="btn-ps-import" style="white-space:nowrap;flex-shrink:0">📥 Import Data</button>
      <button class="btn btn-green" id="btn-ps-export" style="white-space:nowrap;flex-shrink:0">📊 Export to Excel</button>
      ${_psIsAdmin() ? `<button class="btn btn-red" id="btn-ps-delsel" style="white-space:nowrap;flex-shrink:0">🗑 Delete Selected</button>
      <button class="btn btn-ghost" id="btn-ps-trash" style="white-space:nowrap;flex-shrink:0" title="Deleted parts — restore or remove for good">♻ Deleted items${S.trashParts.length?` (${S.trashParts.length})`:''}</button>` : ''}
      <span class="count-badge">${totalItems} parts — page ${psPage}/${totalPages}</span>
    </div>
    <div class="table-wrap" id="ps-table-wrap"><table id="ps-table">
      <thead><tr>
        <th style="width:28px"><input type="checkbox" id="ps-check-all" title="Select all"></th>
        ${COLS.map(c=>`<th data-col="${c.k}" style="min-width:${c.w}" title="Drag to reorder">${c.l}${arrow(c.k)}</th>`).join('')}
      </tr></thead>
      <tbody>${rows||`<tr class="empty-row"><td colspan="${COLS.length+1}">No parts found</td></tr>`}</tbody>
    </table></div>
    ${_PRICE_LEGEND_HTML}
    ${_buildPager(psPage,totalPages,'ps')}`);

  const inp=document.getElementById('ps-search');
  wireSearchClear('ps-search','ps-search-clear');
  wireShiftCheck(document.querySelector('#ps-table'),'.ps-check');
  makeTableResizable(document.querySelector('#ps-table'));
  makeColumnsReorderable(document.querySelector('#ps-table'),'partstock',COLS,()=>renderPartStock(inp.value));
  wireScrollButtons('#ps-table-wrap','ps-scroll-left','ps-scroll-right');
  inp.addEventListener('input',debounce(()=>{
    const v=inp.value, s=inp.selectionStart;
    psPage=1;
    renderPartStock(v).then(()=>{
      const ni=document.getElementById('ps-search');
      if(ni){ni.focus();ni.setSelectionRange(s,s);}
    });
  },260));
  inp.focus();
  document.querySelectorAll('thead th[data-col]').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.col;
    if(sortCol===k)sortAsc=!sortAsc;else{sortCol=k;sortAsc=true;}
    psPage=1;
    renderPartStock(inp.value);
  }));

  document.getElementById('ps-page-size')?.addEventListener('change',e=>{
    const v=e.target.value;
    psPageSize = v==='all' ? 'all' : (parseInt(v)||20);
    localStorage.setItem('psPageSize',String(psPageSize));
    psPage=1;
    renderPartStock(inp.value);
  });
  document.querySelectorAll('#ps-pager .pager-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p=parseInt(btn.dataset.page);
      if(!p||p<1||p>totalPages||p===psPage) return;
      psPage=p;
      renderPartStock(inp.value);
    });
  });

  // Check-all toggle (current page only)
  document.getElementById('ps-check-all')?.addEventListener('change',e=>{
    document.querySelectorAll('.ps-check').forEach(cb=>cb.checked=e.target.checked);
  });

  // Stock toggle — hand-editable per part, independent of the Tools Catalog
  // import that auto-checks it (see saveToolsImport / _psCellHTML 'own_stock').
  document.querySelectorAll('.ps-stock-toggle').forEach(cb=>cb.addEventListener('change',async()=>{
    const id=cb.dataset.id, val=cb.checked;
    try{
      await updatePartFields(id,{own_stock:val});
      const p=S.allParts.find(p=>p._id===id); if(p) p.own_stock=val;
    }catch(e){ toast('Error: '+e.message,'error'); cb.checked=!val; }
  }));

  // Refresh — force a fresh read from Firestore (bypasses the in-memory allParts cache)
  document.getElementById('btn-ps-refresh')?.addEventListener('click',()=>{
    S.allParts=[]; S.trashParts=[];
    renderPartStock(inp.value);
  });

  // FindChips button — check selected rows (or all matching rows across every page if none selected)
  document.getElementById('btn-ps-fc')?.addEventListener('click',()=>{
    const checked=[...document.querySelectorAll('.ps-check:checked')].map(cb=>cb.dataset.id);
    const targets = checked.length
      ? sorted.filter(p=>checked.includes(p._id))
      : sorted.slice(0,2000);
    const items=targets.filter(p=>p.part_number).map(p=>({
      _id:p._id, part_number:p.part_number, qty:parseFloat(p.qty)||1, unit:p.unit||p.units||'',
      description:p.description||''
    }));
    if(!items.length){toast('No parts with part numbers','error');return;}
    runFCCheckModal(items,'parts');
  });

  // Import Data button — lets the user choose which kind of import to run
  // (Priority Prices or Tools Catalog) before opening that flow's own modal.
  document.getElementById('btn-ps-import')?.addEventListener('click',()=>{
    openImportDataModal();
  });

  // Export Excel — selected rows only, or all filtered rows (across every page) if none selected
  document.getElementById('btn-ps-export')?.addEventListener('click',()=>{
    const checked=[...document.querySelectorAll('.ps-check:checked')].map(cb=>cb.dataset.id);
    const targets = checked.length ? sorted.filter(p=>checked.includes(p._id)) : sorted;
    exportPartStockExcel(targets, sorted.length, COLS);
  });

  // Delete Selected — admins only, and only into the recycle bin: the parts
  // are marked deleted and vanish from every screen, but stay restorable for
  // the company's retention period. The audit log keeps their full content.
  document.getElementById('btn-ps-delsel')?.addEventListener('click', async()=>{
    if(!_psIsAdmin()){ toast('Only an admin can delete from the Database','error'); return; }
    const checked=[...document.querySelectorAll('.ps-check:checked')].map(cb=>cb.dataset.id);
    if(!checked.length){ toast('No rows selected','error'); return; }
    if(!confirm(`Move ${checked.length} selected part(s) to Deleted items?\nThey can be restored for ${S._psTrashDays} days.`)) return;
    try{
      const n=await _psSoftDelete(checked);
      toast(`${n} part(s) moved to Deleted items`,'success');
      renderPartStock(inp.value);
    }catch(e){ toast('Error: '+e.message,'error'); logAudit('database_delete_parts',{error:e.message},false); }
  });
  document.getElementById('btn-ps-trash')?.addEventListener('click',()=>{
    if(!_psIsAdmin()) return;
    openTrashModal(()=>renderPartStock(inp.value));
  });
}
