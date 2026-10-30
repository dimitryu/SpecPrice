import { S } from '../core/state.js';
import { logAudit } from '../core/audit.js';
import { closeModal, esc, showModal, toast } from '../core/ui.js';
import { savePriorityImport, saveToolsImport } from '../data/parts.js';
import { _convertToUSD } from '../data/pricing.js';
import { _CURRENCY_HEADER_HINTS, _DESC_HEADER_HINTS, _PN_HEADER_HINTS, _PRICE_HEADER_HINTS, _UNIT_HEADER_HINTS, _priorityFindCol, _priorityMapUnit, _priorityScoreSheet, _toolsScoreSheet } from '../domain/bom.js';
import { renderPartStock } from './database.js';

// Parses one worksheet into {rows, headers}. Header list is padded out to the widest row in
// the sheet (Excel pivot-table exports, trailing unlabeled columns, etc. can make row 0
// shorter than later data rows) so every real data column gets its own selectable option in
// the mapping dropdowns.
export function _priorityParseSheet(sheet){
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
  const maxCols = rows.reduce((m,r)=>Math.max(m, r.length), 0);
  const headers = Array.from({length:maxCols}, (_,i)=>rows[0][i] ?? '');
  return {rows, headers};
}

// Entry point for the Database toolbar's "📥 Import Data" button — lets the
// user pick which import flow to run before opening either one's own modal.
// Replaces the old dedicated "Priority Import" button (still exactly the
// same flow underneath, see openPriorityImportModal below).
export function openImportDataModal(){
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>📥 Import Data</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px">
      <p style="font-size:12px;color:var(--muted);margin:0">What would you like to import?</p>
      <button class="btn btn-blue" id="import-data-priority" style="justify-content:flex-start;padding:12px;text-align:left">
        💰 Priority Prices — update MNF P/N prices from a Priority export
      </button>
      <button class="btn btn-blue" id="import-data-tools" style="justify-content:flex-start;padding:12px;text-align:left">
        🛠 Tools Catalog — import crimp/insertion tool part numbers + descriptions
      </button>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
  </div>`);
  document.getElementById('import-data-priority').addEventListener('click', openPriorityImportModal);
  document.getElementById('import-data-tools').addEventListener('click', openToolsImportModal);
}

export function openPriorityImportModal(){
  showModal(`<div class="modal">
    <div class="modal-head"><h3>📥 Priority Import</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="pi-modal-body">
      <div class="drop-zone" id="pi-drop-zone" tabindex="0">
        <span class="icon-big">📊</span>
        <strong>Drop Excel file here</strong>
        <p>.xlsx, .xls or .csv — expects a MNF P/N column and a Price column</p>
        <input type="file" id="pi-file-input" accept=".xlsx,.xls,.csv" style="display:none">
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
  </div>`);

  const dz=document.getElementById('pi-drop-zone');
  const fi=document.getElementById('pi-file-input');
  dz.addEventListener('click',()=>fi.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');
    if(e.dataTransfer.files[0]) handlePriorityFile(e.dataTransfer.files[0]);
  });
  fi.addEventListener('change',()=>{ if(fi.files[0]) handlePriorityFile(fi.files[0]); });
}

export async function handlePriorityFile(file){
  const body=document.getElementById('pi-modal-body');
  const foot=document.querySelector('#modal-bg .modal-foot');
  body.innerHTML=`<div class="ai-status"><div class="ring"></div><span id="pi-msg">Reading file…</span></div>`;
  foot.innerHTML='';

  try{
    if(!window.XLSX) throw new Error('Excel library not loaded — please reload the page and try again.');
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array'});
    if(!wb.SheetNames.length) throw new Error('No sheets found in this file.');

    // Parse EVERY sheet and score it, so multi-sheet workbooks (Priority ERP exports commonly
    // bundle a PivotTable summary sheet — useless here, just "Row Labels" — alongside a
    // "DataSheet" with the real Part Number / Price / Currency columns) default to whichever
    // sheet actually looks like tabular data, instead of blindly using the first sheet.
    const sheetsData = wb.SheetNames.map(name=>{
      const {rows, headers} = _priorityParseSheet(wb.Sheets[name]);
      return {name, rows, headers, score:_priorityScoreSheet(headers)};
    }).filter(s=>s.rows.length>0);
    if(!sheetsData.length) throw new Error('The file appears to be empty.');
    sheetsData.sort((a,b)=>b.score-a.score);

    renderPrioritySheetMapping(sheetsData, sheetsData[0].name, body, foot);
  }catch(e){
    body.innerHTML+=`<p style="color:red;margin-top:12px">Error: ${e.message}</p>`;
    foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
  }
}

// Suggest which column is Part Number (מק"ט), which is Priority Price (מחיר ליחידה), and
// (optionally) which column holds the currency code — Priority ERP exports often keep the
// amount as a bare number with the currency in its own column (e.g. "מטבע שורה": EUR/GBP/ש).
// Also lets the user switch sheets when the workbook has more than one. All pre-selected from
// header detection, but always confirmed by the user before parsing.
export function renderPrioritySheetMapping(sheetsData, activeSheetName, body, foot){
  const active = sheetsData.find(s=>s.name===activeSheetName) || sheetsData[0];
  const {rows, headers} = active;

  let pnCol=_priorityFindCol(headers,_PN_HEADER_HINTS);
  let prCol=_priorityFindCol(headers,_PRICE_HEADER_HINTS);
  let curCol=_priorityFindCol(headers,_CURRENCY_HEADER_HINTS);
  let unitCol=_priorityFindCol(headers,_UNIT_HEADER_HINTS);
  const headerDetected = pnCol>=0 || prCol>=0;
  if(pnCol<0) pnCol=0;
  if(prCol<0) prCol=(pnCol===1?0:1);
  if(prCol===pnCol) prCol=(pnCol===0 && headers.length>1)?1:(pnCol>0?0:1);

  const colLabel=(h,i)=>{ const t=String(h||'').trim(); return t?esc(t):`(Column ${i+1})`; };
  const colOpts=(selected)=>headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${colLabel(h,i)}</option>`).join('');
  const noneOpts=(selected,label)=>`<option value="-1" ${selected<0?'selected':''}>${label}</option>`+
    headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${colLabel(h,i)}</option>`).join('');
  const curOpts=(selected)=>noneOpts(selected,'— None (detect from price text, default USD) —');
  const unitOpts=(selected)=>noneOpts(selected,'— None —');
  const sampleRows=(headerDetected?rows.slice(1):rows).slice(0,3);

  body.innerHTML=`
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px">We suggest the following column mapping — confirm or change before importing:</p>
    ${sheetsData.length>1?`<div class="form-field">
      <label>Sheet</label>
      <select class="form-input" id="pi-sheet-sel">
        ${sheetsData.map(s=>`<option value="${esc(s.name)}" ${s.name===active.name?'selected':''}>${esc(s.name)} (${s.rows.length} rows, ${s.headers.length} cols)</option>`).join('')}
      </select>
    </div>`:''}
    <div class="form-field" style="margin-top:10px">
      <label>MNF P/N column (מק"ט)</label>
      <select class="form-input" id="pi-pn-col">${colOpts(pnCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label>Priority Price column (מחיר ליחידה)</label>
      <select class="form-input" id="pi-price-col">${colOpts(prCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label>Currency column (optional)</label>
      <select class="form-input" id="pi-cur-col">${curOpts(curCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label>Units column (optional)</label>
      <select class="form-input" id="pi-unit-col">${unitOpts(unitCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:400;font-size:12px">
        <input type="checkbox" id="pi-has-header" ${headerDetected?'checked':''} style="width:auto">
        First row is a header row (skip it)
      </label>
    </div>
    ${sampleRows.length?`<div style="margin-top:12px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Preview:</div>
      <div class="table-wrap"><table style="font-size:11px">
        <tbody>${sampleRows.map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(String(r[i]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}`;

  foot.innerHTML=`
    <button class="btn btn-ghost" id="pi-map-cancel">Cancel</button>
    <button class="btn btn-green" id="pi-map-continue">Continue →</button>`;

  document.getElementById('pi-sheet-sel')?.addEventListener('change',e=>{
    renderPrioritySheetMapping(sheetsData, e.target.value, body, foot);
  });
  document.getElementById('pi-map-cancel').addEventListener('click',closeModal);
  document.getElementById('pi-map-continue').addEventListener('click', async()=>{
    const pnColSel=parseInt(document.getElementById('pi-pn-col').value);
    const prColSel=parseInt(document.getElementById('pi-price-col').value);
    const curColSel=parseInt(document.getElementById('pi-cur-col').value);
    const unitColSel=parseInt(document.getElementById('pi-unit-col').value);
    const skipHeader=document.getElementById('pi-has-header').checked;
    if(pnColSel===prColSel){ toast('MNF P/N and Price columns must be different','error'); return; }

    const btn=document.getElementById('pi-map-continue');
    btn.disabled=true; btn.textContent='Converting…';

    const dataRows=skipHeader?rows.slice(1):rows;
    const parsed=[];
    for(const r of dataRows){
      const pn=String(r[pnColSel]||'').trim();
      const rawPrice=r[prColSel];
      if(!pn || rawPrice===''||rawPrice===undefined||rawPrice===null) continue;
      const rawCur = curColSel>=0 ? r[curColSel] : '';
      const usd=await _convertToUSD(rawPrice, rawCur);
      if(usd===null) continue;
      const unit = unitColSel>=0 ? _priorityMapUnit(r[unitColSel]) : '';
      parsed.push({part_number:pn, priority_price:usd, unit, _raw:String(rawPrice)});
    }

    if(!parsed.length){
      body.innerHTML=`<p style="color:var(--muted);margin-top:10px">No valid MNF P/N + Price rows were detected with this mapping.</p>`;
      foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
      return;
    }

    showPriorityPreview(parsed, body, foot);
  });
}

export function showPriorityPreview(rows, body, foot){
  const modalEl=body.closest('.modal');
  if(modalEl){ modalEl.style.width='min(94vw,700px)'; modalEl.style.maxWidth='700px'; }

  const tBody=rows.map((r,i)=>`<tr data-i="${i}">
    <td contenteditable="true" data-k="part_number" data-i="${i}" style="min-width:140px">${esc(r.part_number)}</td>
    <td contenteditable="true" data-k="priority_price" data-i="${i}" style="min-width:90px">${esc(String(r.priority_price))}</td>
    <td contenteditable="true" data-k="unit" data-i="${i}" style="min-width:70px">${esc(r.unit||'')}</td>
    <td><button class="btn btn-red btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
  </tr>`).join('');

  body.innerHTML=`
    <div class="ai-status" style="margin-bottom:10px">
      <div style="width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1">✓</div>
      <span>${rows.length} rows parsed (prices converted to $) — click any cell to edit before saving</span>
    </div>
    <div class="table-wrap" style="max-height:calc(85vh - 175px);overflow:auto"><table>
      <thead><tr><th>MNF P/N</th><th>Priority Price ($)</th><th>Units</th><th></th></tr></thead>
      <tbody id="pi-preview-tbody">${tBody}</tbody>
    </table></div>`;

  foot.innerHTML=`
    <button class="btn btn-ghost" id="pi-cancel">Cancel</button>
    <button class="btn btn-green" id="pi-save">💾 Save to Database (${rows.length} rows)</button>`;

  document.getElementById('pi-cancel').addEventListener('click',closeModal);
  document.getElementById('pi-save').addEventListener('click', async()=>{
    const finalRows=[];
    document.querySelectorAll('#pi-preview-tbody tr').forEach(tr=>{
      const pn=tr.querySelector('[data-k="part_number"]')?.textContent.trim()||'';
      const pr=parseFloat(tr.querySelector('[data-k="priority_price"]')?.textContent.trim())||0;
      const unit=tr.querySelector('[data-k="unit"]')?.textContent.trim()||'';
      if(pn) finalRows.push({part_number:pn, priority_price:pr, unit});
    });
    if(!finalRows.length){ toast('No rows to save','error'); return; }
    const btn=document.getElementById('pi-save');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      const {updated, created}=await savePriorityImport(finalRows);
      toast(`Priority Import: ${updated} updated, ${created} created`,'success');
      logAudit('priority_import',{updated,created},true);
      closeModal();
      S.allParts=[]; renderPartStock();
    }catch(e){ toast('Save error: '+e.message,'error'); logAudit('priority_import',{error:e.message},false); btn.disabled=false; btn.textContent=`💾 Save to Database (${finalRows.length} rows)`; }
  });
}

export function openToolsImportModal(){
  showModal(`<div class="modal">
    <div class="modal-head"><h3>🛠 Tools Catalog Import</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="ti-modal-body">
      <div class="drop-zone" id="ti-drop-zone" tabindex="0">
        <span class="icon-big">📊</span>
        <strong>Drop Excel file here</strong>
        <p>.xlsx, .xls or .csv — expects an MNF P/N column and a Description column</p>
        <input type="file" id="ti-file-input" accept=".xlsx,.xls,.csv" style="display:none">
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
  </div>`);

  const dz=document.getElementById('ti-drop-zone');
  const fi=document.getElementById('ti-file-input');
  dz.addEventListener('click',()=>fi.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');
    if(e.dataTransfer.files[0]) handleToolsFile(e.dataTransfer.files[0]);
  });
  fi.addEventListener('change',()=>{ if(fi.files[0]) handleToolsFile(fi.files[0]); });
}

export async function handleToolsFile(file){
  const body=document.getElementById('ti-modal-body');
  const foot=document.querySelector('#modal-bg .modal-foot');
  body.innerHTML=`<div class="ai-status"><div class="ring"></div><span id="ti-msg">Reading file…</span></div>`;
  foot.innerHTML='';

  try{
    if(!window.XLSX) throw new Error('Excel library not loaded — please reload the page and try again.');
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array'});
    if(!wb.SheetNames.length) throw new Error('No sheets found in this file.');

    const sheetsData = wb.SheetNames.map(name=>{
      const {rows, headers} = _priorityParseSheet(wb.Sheets[name]);
      return {name, rows, headers, score:_toolsScoreSheet(headers)};
    }).filter(s=>s.rows.length>0);
    if(!sheetsData.length) throw new Error('The file appears to be empty.');
    sheetsData.sort((a,b)=>b.score-a.score);

    renderToolsSheetMapping(sheetsData, sheetsData[0].name, body, foot);
  }catch(e){
    body.innerHTML+=`<p style="color:red;margin-top:12px">Error: ${e.message}</p>`;
    foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
  }
}

// Suggest which column is MNF P/N and which is Description — whatever looks
// like a part number goes to MNF P/N, whatever looks like a product
// description goes to Description, per the user's request. Always confirmed
// by the user before parsing, same as Priority Import's mapping step.
export function renderToolsSheetMapping(sheetsData, activeSheetName, body, foot){
  const active = sheetsData.find(s=>s.name===activeSheetName) || sheetsData[0];
  const {rows, headers} = active;

  let pnCol=_priorityFindCol(headers,_PN_HEADER_HINTS);
  let descCol=_priorityFindCol(headers,_DESC_HEADER_HINTS);
  const headerDetected = pnCol>=0 || descCol>=0;
  if(pnCol<0) pnCol=0;
  if(descCol<0) descCol=(pnCol===1?0:1);
  if(descCol===pnCol) descCol=(pnCol===0 && headers.length>1)?1:(pnCol>0?0:1);

  const colLabel=(h,i)=>{ const t=String(h||'').trim(); return t?esc(t):`(Column ${i+1})`; };
  const colOpts=(selected)=>headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${colLabel(h,i)}</option>`).join('');
  const sampleRows=(headerDetected?rows.slice(1):rows).slice(0,3);

  body.innerHTML=`
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px">We suggest the following column mapping — confirm or change before importing:</p>
    ${sheetsData.length>1?`<div class="form-field">
      <label>Sheet</label>
      <select class="form-input" id="ti-sheet-sel">
        ${sheetsData.map(s=>`<option value="${esc(s.name)}" ${s.name===active.name?'selected':''}>${esc(s.name)} (${s.rows.length} rows, ${s.headers.length} cols)</option>`).join('')}
      </select>
    </div>`:''}
    <div class="form-field" style="margin-top:10px">
      <label>MNF P/N column</label>
      <select class="form-input" id="ti-pn-col">${colOpts(pnCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label>Description column</label>
      <select class="form-input" id="ti-desc-col">${colOpts(descCol)}</select>
    </div>
    <div class="form-field" style="margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:400;font-size:12px">
        <input type="checkbox" id="ti-has-header" ${headerDetected?'checked':''} style="width:auto">
        First row is a header row (skip it)
      </label>
    </div>
    ${sampleRows.length?`<div style="margin-top:12px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Preview:</div>
      <div class="table-wrap"><table style="font-size:11px">
        <tbody>${sampleRows.map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(String(r[i]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}`;

  foot.innerHTML=`
    <button class="btn btn-ghost" id="ti-map-cancel">Cancel</button>
    <button class="btn btn-green" id="ti-map-continue">Continue →</button>`;

  document.getElementById('ti-sheet-sel')?.addEventListener('change',e=>{
    renderToolsSheetMapping(sheetsData, e.target.value, body, foot);
  });
  document.getElementById('ti-map-cancel').addEventListener('click',closeModal);
  document.getElementById('ti-map-continue').addEventListener('click', ()=>{
    const pnColSel=parseInt(document.getElementById('ti-pn-col').value);
    const descColSel=parseInt(document.getElementById('ti-desc-col').value);
    const skipHeader=document.getElementById('ti-has-header').checked;
    if(pnColSel===descColSel){ toast('MNF P/N and Description columns must be different','error'); return; }

    const dataRows=skipHeader?rows.slice(1):rows;
    const parsed=[];
    for(const r of dataRows){
      const pn=String(r[pnColSel]||'').trim();
      const desc=String(r[descColSel]||'').trim();
      if(!pn) continue;
      parsed.push({part_number:pn, description:desc});
    }

    if(!parsed.length){
      body.innerHTML=`<p style="color:var(--muted);margin-top:10px">No valid MNF P/N rows were detected with this mapping.</p>`;
      foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
      return;
    }

    showToolsPreview(parsed, body, foot);
  });
}

export function showToolsPreview(rows, body, foot){
  const modalEl=body.closest('.modal');
  if(modalEl){ modalEl.style.width='min(94vw,700px)'; modalEl.style.maxWidth='700px'; }

  const tBody=rows.map((r,i)=>`<tr data-i="${i}">
    <td contenteditable="true" data-k="part_number" data-i="${i}" style="min-width:140px">${esc(r.part_number)}</td>
    <td contenteditable="true" data-k="description" data-i="${i}" style="min-width:220px">${esc(r.description||'')}</td>
    <td><button class="btn btn-red btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
  </tr>`).join('');

  body.innerHTML=`
    <div class="ai-status" style="margin-bottom:10px">
      <div style="width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1">✓</div>
      <span>${rows.length} rows parsed — click any cell to edit before saving</span>
    </div>
    <div class="table-wrap" style="max-height:calc(85vh - 175px);overflow:auto"><table>
      <thead><tr><th>MNF P/N</th><th>Description</th><th></th></tr></thead>
      <tbody id="ti-preview-tbody">${tBody}</tbody>
    </table></div>`;

  foot.innerHTML=`
    <button class="btn btn-ghost" id="ti-cancel">Cancel</button>
    <button class="btn btn-green" id="ti-save">💾 Save to Database (${rows.length} rows)</button>`;

  document.getElementById('ti-cancel').addEventListener('click',closeModal);
  document.getElementById('ti-save').addEventListener('click', async()=>{
    const finalRows=[];
    document.querySelectorAll('#ti-preview-tbody tr').forEach(tr=>{
      const pn=tr.querySelector('[data-k="part_number"]')?.textContent.trim()||'';
      const desc=tr.querySelector('[data-k="description"]')?.textContent.trim()||'';
      if(pn) finalRows.push({part_number:pn, description:desc});
    });
    if(!finalRows.length){ toast('No rows to save','error'); return; }
    const btn=document.getElementById('ti-save');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      const {updated, created}=await saveToolsImport(finalRows);
      toast(`Tools Catalog Import: ${updated} updated, ${created} created`,'success');
      logAudit('tools_catalog_import',{updated,created},true);
      closeModal();
      S.allParts=[]; renderPartStock();
    }catch(e){ toast('Save error: '+e.message,'error'); logAudit('tools_catalog_import',{error:e.message},false); btn.disabled=false; btn.textContent=`💾 Save to Database (${finalRows.length} rows)`; }
  });
}
