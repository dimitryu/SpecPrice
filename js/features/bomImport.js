import { _bomFromPDF, aiExtractBOM, aiReadTitleBlock } from '../ai/bom.js';
import { _aiReady } from '../ai/client.js';
import { logAudit, logDrawingsOf, setLogDrawing } from '../core/audit.js';
import { closeModal, esc, progressPanel, showModal, toast } from '../core/ui.js';
import { saveBOMToPartStock } from '../data/parts.js';
import { appendRowsToDrawing } from '../data/projects.js';
import { _XLS_MAP_FIELDS, _applyDrawingIdentity, _drawingIdentity, _isYes, _normalizeBOMRows, _normalizeExtractedRow, _parseDrawingFileName, _xlsAnalyzeSheet, _xlsMapSignature, parseExcelSheetsStructured } from '../domain/bom.js';
import { renderRFQDetail } from './rfq.js';
import { _TOOL_TAG, _sdIsToolRow, _toolRowAttrs } from './salesDesk/salesDesk.js';
import { _addToolsToRows, _toolLookupMessage } from './salesDesk/tools.js';
import { showSettingsModal } from './settings.js';
import { _isSpreadsheetFile, extractExcelText, readExcelSheets } from '../io/excel.js';
import { encodeImage } from '../io/pdf.js';

// ══════════════════════════════════════════════════════════════════════════════
// ADD DRAWING MODAL — PDF / Image → AI → BOM
// ══════════════════════════════════════════════════════════════════════════════
export function openAddDrawingModal(projectId, projectName){
  if(!_aiReady()){ showSettingsModal(()=>openAddDrawingModal(projectId,projectName)); return; }

  showModal(`<div class="modal">
    <div class="modal-head"><h3>Add Drawing to ${esc(projectName)}</h3><button class="close-modal" id="modal-close">✕</button></div>
    <div class="modal-body" id="modal-body-inner">
      <div class="form-field" style="margin-bottom:14px">
        <label>Drawing Name / Title</label>
        <input class="form-input" id="drawing-name-inp" placeholder="e.g. KARA-002 or Main Assembly" autocomplete="off">
      </div>
      <div class="drop-zone" id="drop-zone" tabindex="0">
        <span class="icon-big">📄</span>
        <strong>Drop PDF, Image or Excel here</strong>
        <p>or click to browse — you can select multiple files (PDF, PNG, JPG, JPEG, WEBP, BMP, XLSX, XLS, CSV). All selected files are extracted together and shown in one combined review.</p>
        <input type="file" id="file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.xlsx,.xlsm,.xls,.csv" multiple
               style="display:none">
      </div>
    </div>
    <div class="modal-foot" id="modal-foot">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
    </div>
  </div>`);

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);

  const dz = document.getElementById('drop-zone');
  const fi = document.getElementById('file-input');
  dz.addEventListener('click', ()=>fi.click());
  dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave', ()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop', e=>{
    e.preventDefault();dz.classList.remove('dragover');
    const dwgName=document.getElementById('drawing-name-inp')?.value.trim()||'';
    const files=[...e.dataTransfer.files];
    if(!files.length) return;
    handleFiles(files,projectId,projectName,dwgName);
  });
  fi.addEventListener('change', ()=>{
    if(fi.files.length){
      const dwgName=document.getElementById('drawing-name-inp')?.value.trim()||'';
      handleFiles([...fi.files],projectId,projectName,dwgName);
    }
  });
}

// Extracts BOM rows from ALL selected files (one after another), then shows a single
// combined preview for review. Each row keeps track of which file/drawing it came from
// via drawing_number/revision (parsed from the filename), so on save the rows are
// grouped back into per-drawing RFQ documents.
export async function handleFiles(files, projectId, projectName, drawingNameOverride=''){
  if(!files || !files.length) return;
  const body = document.getElementById('modal-body-inner');
  const foot = document.getElementById('modal-foot');
  const allRows = [];
  const errors = [];

  for(let fidx=0; fidx<files.length; fidx++){
    const file = files[fidx];
    setLogDrawing(_parseDrawingFileName(file.name).drawing_number || file.name);
    const isPDF = file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg = file.type.startsWith('image/');
    const isXls = _isSpreadsheetFile(file);
    if(!isPDF && !isImg && !isXls){ errors.push(`"${file.name}" — not a PDF, image or spreadsheet, skipped`); continue; }

    const filePrefix = files.length>1 ? `File ${fidx+1}/${files.length}: ${esc(file.name)} — ` : '';
    body.innerHTML = `
      <div class="ai-status"><div class="ring"></div><span id="ai-msg">${filePrefix}${isXls?'Reading spreadsheet…':(isPDF?'Extracting PDF text…':'Reading image…')}</span></div>
      <div class="progress-bar"><div class="progress-fill" id="prog"></div></div>`;
    foot.innerHTML = '';
    const setMsg = (m,pct) => {
      const el=document.getElementById('ai-msg'); if(el)el.textContent=filePrefix+m;
      const pb=document.getElementById('prog'); if(pb)pb.style.width=pct+'%';
    };

    try {
      let extractedRows = [], _bomDiag = [];
      let _pdfText='', _pdfTextLen=0, _pdfImages=[], _imgForTb=null, _pdfLayout='';
      if(isXls){
        setMsg('Reading spreadsheet…', 20);
        const sheets = await readExcelSheets(file);
        // Confirm the column mapping first when the guess is uncertain — see
        // _xlsConfirmMapping. Returns {} for a sheet it is confident about, so
        // a recognised export is never interrupted.
        const _colChoice = await _xlsConfirmMapping(sheets, file.name, body, foot);
        if(_colChoice===null){ errors.push(`"${file.name}" — import cancelled`); continue; }
        body.innerHTML = `
      <div class="ai-status"><div class="ring"></div><span id="ai-msg">${filePrefix}Reading spreadsheet…</span></div>
      <div class="progress-bar"><div class="progress-fill" id="prog"></div></div>`;
        foot.innerHTML = '';
        // Structured parse first — exact and repeatable (see
        // _parseStructuredBOMSheet). AI only for unrecognisable layouts.
        extractedRows = parseExcelSheetsStructured(sheets, _colChoice) || [];
        if(extractedRows.length){
          setMsg(`Parsed ${extractedRows.length} component(s) from the sheet`, 90);
        } else {
          const sheetText = await extractExcelText(file);
          if(!sheetText.trim()) throw new Error('the spreadsheet appears to be empty');
          setMsg('Layout not recognised — asking AI…', 50);
          extractedRows = await aiExtractBOM(sheetText, false, null, file.name, 'excel');
        }
      } else if(isPDF){
        // See _bomFromPDF: the text layer when it holds a parts list, and
        // otherwise the table located on the sheet and read at full sharpness.
        const r=await _bomFromPDF(file, setMsg);
        extractedRows=r.rows; _bomDiag=r.diag||[]; _pdfImages=r.pageImages; _pdfText=r.pdfText; _pdfTextLen=r.textLen; _pdfLayout=r.layoutText||'';
      } else {
        setMsg('Encoding image…', 20);
        const {b64, mimeType} = await encodeImage(file);
        _imgForTb={b64, mimeType};
        setMsg('Sending to AI (vision)…', 50);
        extractedRows = await aiExtractBOM('', true, {b64, mimeType}, file.name);
      }

      _normalizeBOMRows(extractedRows, {text: isPDF ? _pdfText : ''});
      // Drawing #, name and revision: title block first, then the file name
      // (see _drawingIdentity). A name typed for this RFQ drawing still wins.
      let _tb=null;
      if(extractedRows.length && !isXls && _aiReady()){
        setMsg('Reading the title block…', 95);
        const _tbText = isPDF && _pdfTextLen>200 ? (_pdfLayout||_pdfText) : '';
        const _tbImg = _pdfImages[0] ? {b64:_pdfImages[0], mimeType:'image/jpeg'} : (_imgForTb||null);
        if(_tbText || _tbImg) _tb=await aiReadTitleBlock(_tbText, !!_tbImg, _tbImg);
      }
      const _dwgId=_drawingIdentity(_tb, file.name, isPDF ? (_pdfLayout||_pdfText) : '');
      if(files.length===1 && drawingNameOverride) _dwgId.drawing_number=drawingNameOverride;
      _applyDrawingIdentity(extractedRows, _dwgId);
      setLogDrawing(_dwgId.drawing_number || _parseDrawingFileName(file.name).drawing_number);
      extractedRows.forEach(r=>{
        r.customer_supplied=_isYes(r.customer_supplied);
        _normalizeExtractedRow(r);
      });

      if(extractedRows.length){
        try{
          const t=await _addToolsToRows(extractedRows, msg=>setMsg(msg,98));
          if((t.notFound||[]).length || t.aiError) toast(_toolLookupMessage(t),'warn');
        }
        catch(e){ console.warn('[BOM] tool lookup failed:', e.message); }
      }

      if(!extractedRows.length){
        errors.push(`"${file.name}" — no BOM rows detected${_bomDiag.length?` (${_bomDiag.join('; ')})`:''}`);
      } else {
        allRows.push(...extractedRows);
      }
    } catch(e){
      const hint = e.message==='Failed to fetch'
        ? 'network error — check your internet connection or the Anthropic key'
        : e.message;
      errors.push(`"${file.name}" — ${hint}`);
    }
  }

  setLogDrawing([]);
  if(errors.length) errors.forEach(msg=>toast(msg,'error'));

  const _ringEl=document.querySelector('.ai-status .ring');
  if(_ringEl){_ringEl.style.cssText='width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1';
    _ringEl.textContent='✓';}

  if(!allRows.length){
    body.innerHTML = `<p style="color:var(--muted);margin-top:10px">No BOM rows were detected in ${files.length>1?`any of the ${files.length} files`:'this file'}.</p>
      ${errors.length?`<div class="sd-import-why" style="margin-top:8px;font-size:12px;line-height:1.5;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px 10px;color:#7F1D1D">
        <strong>What happened:</strong><ul style="margin:4px 0 0 18px;padding:0">${errors.map(m=>`<li>${esc(m)}</li>`).join('')}</ul></div>`:''}`;
    foot.innerHTML = `<button class="btn btn-ghost" id="modal-cancel-err">Close</button>`;
    document.getElementById('modal-cancel-err')?.addEventListener('click',closeModal);
    return;
  }

  showBOMPreview(allRows, body, foot,
    `💾 Save to Database + RFQ (${allRows.length} rows${files.length>1?` from ${files.length} files`:''})`,
    async(updatedRows)=>{
      setLogDrawing(logDrawingsOf(updatedRows));
      await saveBOMToPartStock(updatedRows, projectName);
      // Group rows by drawing_number so each source file lands in its own RFQ drawing doc
      const byDwg = {};
      updatedRows.forEach(r=>{
        const key = r.drawing_number || projectName;
        (byDwg[key]=byDwg[key]||[]).push(r);
      });
      for(const dwgName in byDwg){
        await saveBOMToRFQSilent(byDwg[dwgName], projectId, dwgName);
      }
      toast(`Saved ${updatedRows.length} BOM rows across ${Object.keys(byDwg).length} drawing(s)`,'success');
      logAudit('rfq_bom_saved',{rows:updatedRows.length,drawings:Object.keys(byDwg).length,project:projectName},true);
      setLogDrawing([]);
      closeModal();
      renderRFQDetail(projectId, projectName);
    }
  );
}

// showBOMPreview(rows, body, foot, btnLabel, saveCallback)
// saveCallback(updatedRows) is called when user clicks Save
export function showBOMPreview(rows, body, foot, btnLabel, saveCallback){
  const PCOLS=['item','drawing_number','revision','part_number','drawing_name','atlantium_pn','description','qty','unit','manufacturer','pin_count'];
  const PLABELS=['Item','Drawing #','Revision','MNF P/N','Dwg Name','Cust PN','Description','QTY','Units','Manufacturer','Pins'];
  // "price" is intentionally NOT a visible/editable column here — it's only
  // ever populated on a synthesized crimp-tool row (see _BOM_TEXT_PROMPT/
  // _BOM_VISION_PROMPT rule 5) and showing an empty Price column for every
  // normal part is just clutter. It's still carried through to saveCallback
  // via the stable data-i index below, so the tool row's estimate still reaches
  // the Database's est_price field (see saveBOMToPartStock).

  // Expand modal for comfortable editing
  const modalEl=body.closest('.modal');
  if(modalEl){ modalEl.style.width='min(94vw,1200px)'; modalEl.style.maxWidth='1200px'; }

  // Tool rows are highlighted here too — this preview is the moment the user
  // first sees them, and it's the only place they can be removed before they
  // reach the Database. Discovering a synthesized row later, in a quote, is far
  // more confusing than seeing it flagged at the point it's introduced.
  // One editable row. Also used for rows the user adds (r = {}): every cell can
  // be typed into, ✕ removes the row, and "Cust. supplied" marks material the
  // customer provides (priced at 0 in the quote).
  const rowHTML=(r,i)=>`<tr data-i="${i}"${_toolRowAttrs(r)}>
    ${PCOLS.map(k=>`<td contenteditable="true" data-k="${k}" data-i="${i}" style="min-width:70px${k==='description'?';max-width:380px;white-space:normal':''}">${esc(r[k]||'')}${
      k==='description' && _sdIsToolRow(r) ? `<span data-tag contenteditable="false">${_TOOL_TAG}</span>` : ''}</td>${
      k==='description' ? `<td style="text-align:center"><input type="checkbox" class="pv-cust" title="Customer-supplied material — not purchased, priced at 0" ${r.customer_supplied?'checked':''}></td>` : ''}`).join('')}
    <td><button class="btn btn-red btn-sm pv-del" title="Delete this row">✕</button></td>
  </tr>`;
  const tBody = rows.map(rowHTML).join('');
  const hasTools = rows.some(r=>_sdIsToolRow(r));

  body.innerHTML = `
    <div class="ai-status" style="margin-bottom:10px">
      <div style="width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1">✓</div>
      <span>${rows.length} rows extracted — click any cell to edit, ✕ deletes a row, ➕ adds one</span>
    </div>
    ${hasTools?`<div class="pv-tool-note" style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;padding:6px 10px;margin-bottom:8px">
      ⚙ Rows marked <strong>TOOL</strong> were added by the system's analysis — they are <strong>not</strong> in the drawing's original BOM, and are never included in the cable price.</div>`:''}
    <div class="table-wrap" style="max-height:calc(85vh - 205px);overflow:auto"><table>
      <thead><tr>${PLABELS.map(l=>`<th>${l}</th>${l==='Description'?'<th title="Customer-supplied material — not purchased, priced at 0">Cust. supplied</th>':''}`).join('')}<th></th></tr></thead>
      <tbody id="preview-tbody">${tBody}</tbody>
    </table></div>
    <button type="button" class="btn btn-ghost btn-sm" id="pv-add-row" style="margin-top:8px">➕ Add row</button>`;
  const ptb=document.getElementById('preview-tbody');
  ptb.addEventListener('click',e=>{ const d=e.target.closest('.pv-del'); if(d) d.closest('tr').remove(); });
  let _newIdx=rows.length;
  document.getElementById('pv-add-row').addEventListener('click',()=>{
    // A new row starts with this drawing's number, name and revision filled in.
    const last=[...ptb.querySelectorAll('tr')].pop();
    const val=k=>last?.querySelector(`[data-k="${k}"]`)?.textContent.trim()||'';
    ptb.insertAdjacentHTML('beforeend', rowHTML({drawing_number:val('drawing_number'), revision:val('revision'), drawing_name:val('drawing_name')}, _newIdx++));
    const tr=ptb.lastElementChild; tr.scrollIntoView({block:'nearest'});
    tr.querySelector('[data-k="part_number"]')?.focus();
  });

  foot.innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
    <button class="btn btn-green" id="btn-save-bom">${btnLabel||'💾 Save'}</button>`;

  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('btn-save-bom').addEventListener('click',async()=>{
    const updatedRows=[];
    document.querySelectorAll('#preview-tbody tr').forEach(tr=>{
      const row={};
      tr.querySelectorAll('td[contenteditable]').forEach(td=>{
        // The TOOL badge is decoration, not text — it was being read back into
        // the description ("…FERRULESTOOL") and from there into the Database.
        const t=td.cloneNode(true); t.querySelectorAll('[data-tag]').forEach(x=>x.remove());
        row[td.dataset.k]=t.textContent.trim();
      });
      // Carry over the hidden "price" field (not a visible column — see above)
      // from the original row, keyed by the stable data-i index so it survives
      // even though it's not one of the contenteditable cells.
      const origIdx=+tr.dataset.i;
      if(rows[origIdx] && rows[origIdx].price) row.price=rows[origIdx].price;
      // QVL alternatives likewise aren't an editable column, but losing them
      // here would silently reduce the part to whichever alternative happened
      // to be listed first — the exact behaviour we're replacing.
      if(rows[origIdx] && (rows[origIdx].alt_mpns||[]).length) row.alt_mpns=rows[origIdx].alt_mpns;
      // So do the manufacturing minutes the process analysis attributed to
      // this exact row (see handleSDFiles) — by position, never by part number.
      if(rows[origIdx] && rows[origIdx]._labor_min!=null) row._labor_min=rows[origIdx]._labor_min;
      // Which connector a tool is for, and where the tool came from.
      // Which connector/contact a tool is for, where it came from, and the
      // prices and links found for it during the import.
      for(const k of ['tool_for','tool_source','tool_url','tool_in_db','tool_note','tool_pages','mouser_price','digikey_price','mouser_url','digikey_url',
                      'mouser_stock','digikey_stock','mouser_brk','digikey_brk','mouser_match','digikey_match','mouser_mpn','digikey_mpn',
                      'onlinecomp_price','onlinecomp_url','onlinecomp_stock','onlinecomp_brk','onlinecomp_match','onlinecomp_mpn','onlinecomp_uom',
                      'farnell_price','farnell_url','farnell_stock','farnell_brk','farnell_match','farnell_mpn','farnell_uom'])
        if(rows[origIdx] && rows[origIdx][k]!=null && rows[origIdx][k]!=='') row[k]=rows[origIdx][k];
      if(Object.values(row).some(v=>v)){
        row.customer_supplied=!!tr.querySelector('.pv-cust')?.checked;
        updatedRows.push(row);
      }
    });
    if(!updatedRows.length){ toast('No rows to save','error'); return; }
    const btn=document.getElementById('btn-save-bom');
    if(btn){btn.disabled=true;btn.textContent='Saving…';}
    const cancel=document.getElementById('modal-cancel'); if(cancel) cancel.disabled=true;
    // Saving is one Database write per row; on a big BOM that takes a while,
    // so the count and the bar show it moving (see saveBOMToPartStock).
    body.querySelector('.db-progress')?.remove();
    const prog=progressPanel(body,'Saving to Database…');
    body.scrollTop=0;
    try{ await saveCallback(updatedRows, prog); }
    catch(e){
      toast('Save error: '+e.message,'error'); prog.el.remove();
      if(btn){btn.disabled=false;btn.textContent=btnLabel||'💾 Save';}
      if(cancel) cancel.disabled=false;
    }
  });
}

// Writes rows into a single named drawing document under an RFQ (creating or
// merging into an existing drawing of that name). No UI side-effects — callers
// (which may invoke this once per drawing when saving a multi-file batch) are
// responsible for toasts/closing the modal/re-rendering once all groups are saved.
export async function saveBOMToRFQSilent(rows, projectId, drawingName){
  await appendRowsToDrawing(projectId, drawingName, rows);
}
// Runs the deterministic parser over each sheet, returning the first sheet that
// yields real BOM rows. null → hand the file to the AI instead.
// ── Column-mapping confirmation ───────────────────────────────────────────────
// Auto-detection is right for most exports, but it is a guess, and a wrong
// guess is expensive here: the manufacturer part number is what every price
// lookup keys on, and a mis-picked quantity column silently multiplies a quote.
// So when the guess is uncertain — the MNF P/N column wasn't found, a role
// matched more than one column, or the sheet repeats a component once per
// approved manufacturer — the import stops and asks instead of proceeding.
// Confident sheets are never interrupted.
//
// Answers are remembered per header layout, so the same export format only
// asks once. Repeated-row sheets still ask every time: that answer changes
// the quantities in the quote, and it is a per-file judgement, not a format one.
export const _XLS_MAP_STORE='xlsColMap_v1_';
export function _xlsLoadSavedMap(headers){
  try{
    const raw=localStorage.getItem(_XLS_MAP_STORE+_xlsMapSignature(headers));
    const v=raw?JSON.parse(raw):null;
    return (v && typeof v==='object' && !Array.isArray(v)) ? v : null;
  }catch{ return null; }
}
export function _xlsSaveMap(headers, colMap){
  try{ localStorage.setItem(_XLS_MAP_STORE+_xlsMapSignature(headers), JSON.stringify(colMap)); }catch{}
}

// Renders the dialog into the modal that is already open and resolves with the
// confirmed mapping, or with null if the person cancelled.
export function _xlsRenderMappingDialog(sheetsData, activeName, analysisByName, fileName, body, foot, resolve){
  const active=sheetsData.find(s=>s.name===activeName)||sheetsData[0];
  const a=analysisByName[active.name];
  const saved=_xlsLoadSavedMap(a.headers);
  const start={...a.colMap, ...(saved||{})};

  const colText=(i)=>{
    const h=String(a.headers[i]||'').trim()||`(Column ${i+1})`;
    const v=String(a.sample[i]||'').trim();
    return v ? `${h}  ·  ${v.length>30?v.slice(0,30)+'…':v}` : h;
  };
  const opts=(sel,required)=>
    (required?'':`<option value="-1" ${sel===undefined||sel<0?'selected':''}>— None —</option>`)+
    a.headers.map((_,i)=>`<option value="${i}" ${i===sel?'selected':''}>${esc(colText(i))}</option>`).join('');

  const why=[];
  if(a.candidates.mfpn===undefined) why.push('no column looked like a manufacturer part number');
  if(a.ambiguous.length) why.push(`more than one column matched: ${a.ambiguous.join(', ')}`);
  if(a.repeats) why.push(`${a.repeats} row(s) repeat a component that is already listed`);

  body.innerHTML=`
    <p style="font-size:12px;color:var(--text);margin-bottom:4px">
      <b>${esc(fileName)}</b> — checking the column mapping before importing.</p>
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px">
      ${esc(why.join('; '))}. Confirm or change the columns below.</p>
    ${sheetsData.length>1?`<div class="form-field">
      <label for="bm-sheet">Sheet</label>
      <select class="form-input" id="bm-sheet">
        ${sheetsData.filter(x=>analysisByName[x.name]).map(x=>`<option value="${esc(x.name)}" ${x.name===active.name?'selected':''}>${esc(x.name)} (${analysisByName[x.name].rowCount} rows)</option>`).join('')}
      </select>
    </div>`:''}
    ${_XLS_MAP_FIELDS.map(f=>`
      <div class="form-field" style="margin-top:10px">
        <label for="bm-${f.key}">${esc(f.label)}${f.required?' *':''}</label>
        <select class="form-input" id="bm-${f.key}">${opts(start[f.key], f.required)}</select>
      </div>`).join('')}
    ${a.repeats?`
      <div class="form-field" style="margin-top:14px;padding:10px;background:var(--blue-light);border-radius:6px">
        <label style="text-transform:none">This sheet lists ${a.repeats} repeated component row(s)</label>
        <label style="display:flex;align-items:flex-start;gap:6px;text-transform:none;font-weight:400;font-size:12px;margin-top:6px">
          <input type="radio" name="bm-dup" value="merge" checked style="width:auto;margin-top:2px">
          <span>One line per component — every manufacturer kept as an approved alternative (QVL).
                <b>Quantities stay as the sheet states them.</b></span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:6px;text-transform:none;font-weight:400;font-size:12px;margin-top:6px">
          <input type="radio" name="bm-dup" value="keep" style="width:auto;margin-top:2px">
          <span>Keep every row — one BOM line per manufacturer.
                <b>The same component will be counted more than once.</b></span>
        </label>
      </div>`:''}
    <div id="bm-err" role="alert" aria-live="polite" style="color:#E53E3E;font-size:12px;margin-top:10px;min-height:16px"></div>
    <div style="margin-top:6px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">First rows of the sheet:</div>
      <div class="table-wrap"><table style="font-size:11px">
        <thead><tr>${a.headers.map(h=>`<th>${esc(String(h||''))}</th>`).join('')}</tr></thead>
        <tbody>${active.rows.slice(a.hdrIdx+1, a.hdrIdx+4).map(r=>
          `<tr>${a.headers.map((_,i)=>`<td>${esc(String(r[i]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  foot.innerHTML=`
    <button class="btn btn-ghost" id="bm-cancel">Cancel</button>
    <button class="btn btn-green" id="bm-continue">Continue →</button>`;

  document.getElementById('bm-sheet')?.addEventListener('change',e=>{
    _xlsRenderMappingDialog(sheetsData, e.target.value, analysisByName, fileName, body, foot, resolve);
  });
  document.getElementById('bm-cancel').addEventListener('click',()=>{ closeModal(); resolve(null); });
  document.getElementById('bm-continue').addEventListener('click',()=>{
    const err=document.getElementById('bm-err');
    const picked={};
    for(const f of _XLS_MAP_FIELDS){
      const v=parseInt(document.getElementById('bm-'+f.key).value,10);
      if(v>=0) picked[f.key]=v;
    }
    if(picked.mfpn===undefined){ err.textContent='Choose the MNF P/N column — every price lookup uses it.'; return; }
    if(picked.internal_pn===picked.mfpn){ err.textContent='Customer PN and MNF P/N must be different columns.'; return; }
    // Structural roles the dialog doesn't expose stay as detected.
    const colMap={...a.colMap, ...picked};
    for(const f of _XLS_MAP_FIELDS) if(picked[f.key]===undefined) delete colMap[f.key];
    _xlsSaveMap(a.headers, colMap);
    const dup=document.querySelector('input[name="bm-dup"]:checked');
    resolve({sheetName:active.name, hdrIdx:a.hdrIdx, colMap, mergeDuplicates: dup ? dup.value==='merge' : false});
  });
}

// Import-flow entry point. Returns {} to run with the auto-guess, a mapping
// object to run with, or null when the person cancelled the import.
export function _xlsConfirmMapping(sheets, fileName, body, foot){
  const analysisByName={};
  let firstName=null;
  for(const sh of sheets){
    const a=_xlsAnalyzeSheet(sh.rows);
    if(a && a.rowCount){ analysisByName[sh.name]=a; if(!firstName) firstName=sh.name; }
  }
  if(!firstName) return Promise.resolve({});          // nothing parseable — the AI path takes over
  const a=analysisByName[firstName];
  const saved=_xlsLoadSavedMap(a.headers);
  // A format we've been told about before, with no per-file judgement to make.
  if(saved && !a.repeats) return Promise.resolve({sheetName:firstName, hdrIdx:a.hdrIdx, colMap:{...a.colMap, ...saved}});
  if(!a.needsConfirmation) return Promise.resolve({});
  return new Promise(resolve=>{
    _xlsRenderMappingDialog(sheets, firstName, analysisByName, fileName, body, foot, resolve);
  });
}
