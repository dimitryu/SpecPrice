import { S } from '../../core/state.js';
import { _bomFromPDF, _findBOMPageIndex, aiExtractBOM, aiReadTitleBlock } from '../../ai/bom.js';
import { _aiReady } from '../../ai/client.js';
import { aiAnalyzeCableProcess, aiExtractDrawingNotes } from '../../ai/process.js';
import { logAudit, logDrawingsOf, setLogDrawing } from '../../core/audit.js';
import { isReadOnlyUser } from '../../core/roles.js';
import { parseBoolQuery, wireSearchClear, wireShiftCheck } from '../../core/table.js';
import { closeModal, debounce, esc, fmtPrice, showModal, stagesPanel, toast } from '../../core/ui.js';
import { loadParts, saveBOMToPartStock } from '../../data/parts.js';
import { _applyDrawingIdentity, _drawingIdentity, _isYes, _normalizeBOMRows, _normalizeExtractedRow, _parseDrawingFileName, _partDrawingNumbers, _partDrawings, _partLatestDrawing, _pnKey, parseExcelSheetsStructured } from '../../domain/bom.js';
import { _parsePackMl } from '../../domain/pricing.js';
import { _xlsConfirmMapping } from '../bomImport.js';
import { runFCCheckModal } from '../priceCheck.js';
import { _sdAutoMatchLabor } from './labor.js';
import { _sdDirtyRows, _sdDrawingNotes, _sdDwgKey, _sdIsToolRow, _sdMarkCleanExcept, _sdRecalcRow, _sdTraceFields, renderSalesDesk, sdItems } from './salesDesk.js';
import { _addToolsToRows, _toolLookupMessage } from './tools.js';
import { _isSpreadsheetFile, extractExcelText, readExcelSheets } from '../../io/excel.js';
import { encodeImage } from '../../io/pdf.js';

// Full-featured Part Stock picker for Sales Desk — mirrors the Windows app's
// ui/sales_desk_dialog.py _PartPickerDialog: filter by Drawing Number / Drawing
// Name dropdown plus free-text boolean search, multi-select rows (checkboxes),
// an optional QTY-per-part override, and "Add Selected" (or, if nothing is
// checked, every currently-visible row is added — same as Windows).
// onAdd(parts, qtyOverride, hadSelection) is called once, after the modal closes.
export function openPartPickerModal(onAdd){
  showModal(`<div class="modal" style="width:min(96vw,1100px)">
    <div class="modal-head"><h3>📦 Select from Database</h3><button class="close-modal" data-close-modal>✕</button></div>
    <div class="modal-body">
      <div class="toolbar" style="margin-bottom:8px">
        <label style="font-size:12px;color:var(--muted);white-space:nowrap">Filter by:</label>
        <select id="pp-field" class="search-box" style="flex:0 0 auto;width:150px">
          <option value="drawing_number">Drawing Number</option>
          <option value="drawing_name">Drawing Name</option>
        </select>
        <select id="pp-value" class="search-box" style="flex:0 0 auto;min-width:220px">
          <option value="">All</option>
        </select>
        <div class="search-wrap">
          <input class="search-box" id="pp-search" placeholder='Search part number / description — AND/OR/NOT/"phrase"'>
          <button type="button" class="search-clear" id="pp-search-clear" title="Clear">✕</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:50vh" id="pp-table-wrap">
        <table id="pp-table">
          <thead><tr>
            <th style="width:28px"><input type="checkbox" id="pp-check-all"></th>
            <th>MNF P/N</th><th>Drawing #</th><th>Drawing Name</th><th>Description</th>
            <th>QTY</th><th>Units</th><th>Priority Price</th>
          </tr></thead>
          <tbody id="pp-tbody"></tbody>
        </table>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
        <label style="font-size:12px;color:var(--muted)">QTY per selected part:</label>
        <input type="number" id="pp-qty" class="form-input" style="width:90px" value="1" min="0.001" step="any">
        <span style="font-size:11px;color:var(--muted)">(only used for rows you check — unchecked "Add All" keeps each part's own QTY)</span>
        <span class="count-badge" id="pp-count" style="margin-left:auto"></span>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close-modal>Cancel</button>
      <button class="btn btn-green" id="pp-add">＋ Add Selected</button>
    </div>
  </div>`);

  let visibleParts=[];
  const fieldSel=document.getElementById('pp-field');
  const valueSel=document.getElementById('pp-value');
  const searchInp=document.getElementById('pp-search');
  wireSearchClear('pp-search','pp-search-clear');

  // A part is in every drawing it has been saved from (see _partDrawings), so
  // the drawing list holds each of those drawings, and a drawing shows ALL its
  // parts — not only the ones that happen to be in no other drawing.
  const _dwgValues=(p, field)=>{
    const list=_partDrawings(p);
    const vals = field==='drawing_number' ? list.map(d=>d.drawing_number)
      : [...list.map(d=>d.drawing_name), p.drawing_name];
    return vals.map(v=>String(v||'').trim()).filter(Boolean);
  };
  // The drawing entry of `p` the filter points at (its QTY, unit, revision).
  const _dwgEntry=(p, field, val)=>{
    if(!val) return null;
    const list=_partDrawings(p);
    return field==='drawing_number' ? (list.find(d=>_pnKey(d.drawing_number)===_pnKey(val))||null)
      : (list.find(d=>String(d.drawing_name||'').trim()===val)||null);
  };
  const reloadValueOptions=()=>{
    const field=fieldSel.value;
    const values=[...new Set(S.allParts.flatMap(p=>_dwgValues(p, field)))]
      .sort((a,b)=>a.localeCompare(b));
    valueSel.innerHTML=`<option value="">All (${values.length})</option>`+
      values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    filterRows();
  };

  const filterRows=()=>{
    const field=fieldSel.value;
    const val=valueSel.value;
    const predicate=parseBoolQuery(searchInp.value);
    visibleParts=S.allParts.filter(p=>{
      if(val && !(field==='drawing_number' ? _dwgValues(p,field).some(v=>_pnKey(v)===_pnKey(val)) : _dwgValues(p,field).includes(val))) return false;
      if(searchInp.value.trim()){
        const haystack=[p.part_number,p.description,p.manufacturer,p.drawing_number,p.drawing_name]
          .map(v=>String(v||'')).join(' | ').toLowerCase();
        if(!predicate(haystack)) return false;
      }
      return true;
    });
    const tb=document.getElementById('pp-tbody');
    tb.innerHTML=visibleParts.map(p=>{
      const pr=parseFloat(p.priority_price)||0;
      // Filtered by a drawing: that drawing's number, name, QTY and unit.
      const dw=_dwgEntry(p, field, val);
      const qty = dw && dw.qty!=='' && dw.qty!=null ? dw.qty : p.qty;
      const unit = (dw && dw.unit) || p.unit || p.units;
      return `<tr data-id="${esc(p._id)}">
        <td style="text-align:center"><input type="checkbox" class="pp-check" data-id="${esc(p._id)}"></td>
        <td>${esc(p.part_number)}</td><td>${esc(dw ? dw.drawing_number : _partDrawingNumbers(_partDrawings(p)) || p.drawing_number)}</td>
        <td>${esc((dw && dw.drawing_name) || p.drawing_name)}${dw && dw.revision?` <span style="color:var(--muted);font-size:10px">Rev ${esc(dw.revision)}</span>`:''}</td>
        <td class="wrap">${esc(p.description)}</td><td>${esc(qty)}</td><td>${esc(unit)}</td>
        <td>${pr?fmtPrice(pr):''}</td>
      </tr>`;
    }).join('')||`<tr class="empty-row"><td colspan="8">No parts match this filter</td></tr>`;
    document.getElementById('pp-count').textContent=`${visibleParts.length} parts`;
  };

  fieldSel.addEventListener('change',reloadValueOptions);
  valueSel.addEventListener('change',filterRows);
  searchInp.addEventListener('input',debounce(filterRows,220));
  document.getElementById('pp-check-all').addEventListener('change',e=>{
    document.querySelectorAll('.pp-check').forEach(cb=>cb.checked=e.target.checked);
  });
  wireShiftCheck(document.getElementById('pp-table'),'.pp-check');
  reloadValueOptions();

  document.getElementById('pp-add').addEventListener('click',()=>{
    const checked=[...document.querySelectorAll('.pp-check:checked')].map(cb=>cb.dataset.id);
    const qtyOverride=parseFloat(document.getElementById('pp-qty').value)||1;
    const hadSelection=checked.length>0;
    // Each part goes with the drawing it was picked under (its QTY there).
    const field=fieldSel.value, val=valueSel.value;
    const selected = (hadSelection ? visibleParts.filter(p=>checked.includes(p._id)) : visibleParts)
      .map(p=>({...p, _dwg:_dwgEntry(p, field, val)}));
    if(!selected.length){ toast('No parts to add','error'); return; }
    closeModal();
    onAdd(selected, qtyOverride, hadSelection);
  });
}

export function openSDFileModal(){
  showModal(`<div class="modal">
    <div class="modal-head"><h3>Import BOM from File</h3><button class="close-modal" data-close-modal>✕</button></div>
    <div class="modal-body" id="sd-modal-body">
      <div class="drop-zone" id="sd-drop-zone" tabindex="0">
        <span class="icon-big">📄</span>
        <strong>Drop PDF, Image or Excel here</strong>
        <p>PDF / PNG / JPG / XLSX / XLS / CSV — parts will be added to Sales Desk. You can select multiple files, extracted together into one review.</p>
        <input type="file" id="sd-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.xlsx,.xlsm,.xls,.csv" multiple style="display:none">
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close-modal>Cancel</button></div>
  </div>`);

  const dz=document.getElementById('sd-drop-zone');
  const fi=document.getElementById('sd-file-input');
  dz.addEventListener('click',()=>fi.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{
    e.preventDefault();dz.classList.remove('dragover');
    const files=[...e.dataTransfer.files];
    if(files.length) handleSDFiles(files);
  });
  fi.addEventListener('change',()=>{
    if(fi.files.length) handleSDFiles([...fi.files]);
  });
}

// Extracts BOM rows from ALL selected files, then shows one combined preview
// before adding everything to the Sales Desk in a single confirmation step.
export async function handleSDFiles(files){
  if(!files || !files.length) return;
  const body=document.getElementById('sd-modal-body');
  const foot=document.querySelector('#modal-bg .modal-foot');
  const allRows=[];
  const errors=[];
  // One window from the file to the priced desk: read → add to Sales Desk →
  // save to the Database → check prices. No review table in between — every
  // stage shows here as it runs, and the desk is where rows are corrected.
  const _ro=isReadOnlyUser();
  const stages=stagesPanel(body, [
    {k:'read',  label:files.length>1?`Reading ${files.length} drawings`:'Reading the drawing'},
    {k:'desk',  label:'Adding the rows to Sales Desk'},
    {k:'db',    label:'Saving the parts to the Database'},
    {k:'price', label:'Checking prices — Mouser, DigiKey, Online Components, Farnell'},
  ]);
  stages.set('read',{state:'run', text:'Starting…', pct:0});
  if(foot) foot.innerHTML='';

  for(let fidx=0; fidx<files.length; fidx++){
    const file=files[fidx];
    // Logs written while this file is read name its drawing: from the file
    // name until the title block has been read, then the drawing's own number.
    setLogDrawing(_parseDrawingFileName(file.name).drawing_number || file.name);
    const isPDF=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
    const isImg=file.type.startsWith('image/');
    const isXls=_isSpreadsheetFile(file);
    if(!isPDF&&!isImg&&!isXls){ errors.push(`"${file.name}" — not a PDF, image or spreadsheet, skipped`); continue; }

    const filePrefix = files.length>1 ? `File ${fidx+1}/${files.length}: ${file.name} — ` : '';
    // The bar covers all the files: each file is its share of 100%.
    const setM=(m,p)=>stages.set('read',{state:'run', text:filePrefix+m,
      pct:Math.round(((fidx + Math.min(100,Math.max(0,+p||0))/100) / files.length)*100)});
    setM(isXls?'Reading spreadsheet…':(isPDF?'Extracting PDF text…':'Reading image…'),2);

    try {
      let extractedRows=[], _bomDiag=[];
      let _pdfText='', _pdfTextLen=0, _pdfImages=[], _pdfLayout='';
      let _procIsImage=false, _procImgData=null; // whichever image (if any) ended up being used — reused below for the cable-process analysis

      if(isXls){
        setM('Reading spreadsheet…',20);
        const sheets=await readExcelSheets(file);
        const sheetText=await extractExcelText(file);
        // Same column-mapping confirmation as the RFQ import — see
        // _xlsConfirmMapping. A recognised export goes straight through.
        const _colChoice=await _xlsConfirmMapping(sheets, file.name, body, foot);
        stages.mount(); foot.innerHTML='';
        if(_colChoice===null){ errors.push(`"${file.name}" — import cancelled`); continue; }
        setM('Reading spreadsheet…',30);
        // Structured parse first — exact and repeatable (see
        // _parseStructuredBOMSheet). AI only for unrecognisable layouts.
        extractedRows=parseExcelSheetsStructured(sheets, _colChoice)||[];
        if(extractedRows.length){
          setM(`Parsed ${extractedRows.length} component(s) from the sheet`,60);
        } else {
          if(!sheetText.trim()) throw new Error('the spreadsheet appears to be empty');
          setM('Layout not recognised — asking AI…',50);
          extractedRows=await aiExtractBOM(sheetText,false,null,file.name,'excel');
        }
        // Keep the sheet text as the "drawing text" for the cable-process and
        // notes analyses below — there's no page image for a spreadsheet, so
        // those run in text mode off the same content.
        _pdfText=sheetText;
      } else if(isPDF){
        // See _bomFromPDF — shared with the RFQ import.
        const r=await _bomFromPDF(file, setM);
        extractedRows=r.rows; _bomDiag=r.diag||[]; _pdfImages=r.pageImages; _pdfText=r.pdfText; _pdfTextLen=r.textLen; _pdfLayout=r.layoutText||'';
        const _bomPageIdx=_findBOMPageIndex(r.pageTexts);
        if(r.fromImage && r.imgData){ _procIsImage=true; _procImgData=r.imgData; }
        // Fall back to the detected BOM sheet's own image (or page 1 if none
        // was detected) for the cable-process analysis below, rather than
        // always defaulting to page 1 — the real assembly content, and
        // therefore the steps the AI needs to see, usually lives on whichever
        // page the BOM itself is on.
        if(!_procIsImage){
          const fallbackIdx=_bomPageIdx>=0?_bomPageIdx:0;
          if(_pdfImages[fallbackIdx]){ _procIsImage=true; _procImgData={b64:_pdfImages[fallbackIdx],mimeType:'image/jpeg'}; }
        }
      } else {
        setM('Encoding image…',20);
        const {b64,mimeType}=await encodeImage(file);
        setM('Sending to AI (vision)…',50);
        extractedRows=await aiExtractBOM('',true,{b64,mimeType},file.name);
        _procIsImage=true; _procImgData={b64,mimeType};
      }

      _normalizeBOMRows(extractedRows, {text: isPDF ? _pdfText : ''});
      // Drawing #, name and revision of THIS drawing: from its title block
      // (DWG NO / TITLE / REV, and the latest entry of a revision table), and
      // from the file name for whatever the title block does not show.
      let _tb=null;
      if(extractedRows.length && !isXls && _aiReady()){
        setM('Reading the title block (drawing #, title, revision)…',92);
        // Sheet 1 carries the revision record; its picture shows which value
        // sits in which box, and the text layer (if any) the exact characters.
        const _tbText = isPDF && _pdfTextLen>200 ? (_pdfLayout||_pdfText) : '';
        const _tbImg = _pdfImages[0] ? {b64:_pdfImages[0],mimeType:'image/jpeg'} : (_procImgData||null);
        if(_tbText || _tbImg) _tb=await aiReadTitleBlock(_tbText, !!_tbImg, _tbImg);
      }
      const _dwgId=_drawingIdentity(_tb, file.name, isPDF ? (_pdfLayout||_pdfText) : '');
      const effectiveDwgName=_dwgId.drawing_number;
      _applyDrawingIdentity(extractedRows, _dwgId);
      setLogDrawing(_dwgId.drawing_number || _parseDrawingFileName(file.name).drawing_number);
      extractedRows.forEach(r=>{
        r.customer_supplied=_isYes(r.customer_supplied);
        _normalizeExtractedRow(r);
      });

      // Sales-Desk-only: analyze the actual manufacturing steps this cable
      // assembly needs (cut/strip, crimp, heat-shrink, label, test…) and their
      // time, assuming series/batch production. Each step's minutes get
      // attributed to whichever BOM row it belongs to (bridged via
      // _sdPendingLaborByKey, consumed when the rows are added to sdItems
      // below) — steps not tied to one row are kept as this breakdown's own
      // generalMinutes so the assembly's total labor cost still accounts for
      // them (only while a row from this drawing remains — see
      // _sdActiveGeneralLaborMinutes). The full
      // breakdown (+ a single-unit reference time) is kept in
      // _sdLaborBreakdowns for the Cost Summary breakdown modal.
      if(extractedRows.length && _aiReady()){
        try{
          setM('Analyzing cable manufacturing process…',95);
          const rowsList=extractedRows.map((r,idx)=>`${idx}: ${r.description||r.part_number||''} (qty=${r.qty||''}${r.unit?' '+r.unit:''})`).join('\n');
          const proc = await aiAnalyzeCableProcess(_procIsImage?'':_pdfText, _procIsImage, _procImgData, rowsList);
          if(proc && proc.steps.length){
            let generalMinutes=0, rowTiedMinutes=0;
            const displaySteps=[]; // per-assembly totals (already multiplied) — for the breakdown modal
            for(const step of proc.steps){
              const unitMins=parseFloat(step.unit_minutes)||0;
              if(!unitMins) continue;
              // qty_in_drawing is the AI's own count of how many times this
              // operation actually repeats in ONE assembly, read directly from
              // the drawing (e.g. 20 contacts crimped) — deliberately NOT the
              // BOM row's own qty field, which can describe a different thing
              // entirely (e.g. a connector-housing row with BOM qty=1 whose
              // pins still get crimped 20 times). The app does this
              // multiplication itself (never trusts AI arithmetic).
              const qtyInDrawing=parseFloat(step.qty_in_drawing)||1;
              const totalMins=unitMins*qtyInDrawing;
              const row = (step.row_idx!=null) ? extractedRows[step.row_idx] : null;
              if(row){
                // The minutes go onto THIS row — the one the AI named by its
                // index — and nowhere else. They used to be filed under the
                // row's part number and handed back by part number, so every
                // line sharing a number collected the whole pile: one parts
                // list with the same wire on five lines (or five lines misread
                // as one number) counted the same 12.4 minutes five times, and
                // the Labor Time on the summary came out far above the sum of
                // what the steps actually add up to. The figure is already a
                // total for one cable (unit_minutes × qty_in_drawing), so the
                // row keeps it as a fixed total — see _sdRecalcLaborTotal.
                row._labor_min=(parseFloat(row._labor_min)||0)+totalMins;
                rowTiedMinutes+=totalMins;
                displaySteps.push({operation:step.operation, unitMinutes:unitMins, qty:qtyInDrawing, minutes:totalMins});
              } else {
                generalMinutes+=totalMins;
                displaySteps.push({operation:step.operation, unitMinutes:unitMins, qty:qtyInDrawing, minutes:totalMins});
              }
            }
            S._sdLaborBreakdowns.push({
              // Same reasoning as the key fix above: use the actual (possibly
              // AI-extracted) drawing_number that rows will carry into sdItems,
              // not the filename-derived guess, so this breakdown is found by
              // _sdActiveGeneralLaborMinutes / openLaborBreakdownModal (both of
              // which match against sdItems' real drawing_number field).
              drawingName: extractedRows[0]?.drawing_number || effectiveDwgName,
              steps: displaySteps,
              // Always the row-tied sum + general (both already reflecting
              // real per-assembly quantities) — this keeps "Total (series,
              // per unit)" exactly equal to what Cost Summary's Labor Time
              // actually adds up, so the two numbers can never disagree.
              rowTiedMinutes,
              seriesTotal: rowTiedMinutes + generalMinutes,
              // The single-stand-alone-cable reference is meant to include
              // extra one-off setup/changeover overhead that a batch run
              // doesn't pay per-unit — so it should logically never be LOWER
              // than the series per-unit total. The AI's own estimate is a
              // separate, independent guess (not derived from the steps
              // above), so it can come back inconsistent; floor it at the
              // series total so the two numbers never contradict each other.
              singleUnitMinutes: Math.max(parseFloat(proc.single_unit_minutes)||0, rowTiedMinutes+generalMinutes),
              generalMinutes,
            });
          }
        }catch(e){ console.warn('[SD] cable-process analysis failed:', e.message); }
      }

      // Sales-Desk-only: pull out any NOTES / MANUFACTURING INSTRUCTIONS text
      // the drawing carries (separate from the BOM table) — shown below the
      // BOM table (see _sdRenderNotesPanel). Runs even if no BOM rows were
      // found, since a drawing can still have notes worth surfacing.
      if(_aiReady()){
        try{
          setM('Checking for Notes / Manufacturing Instructions…',97);
          const notes=await aiExtractDrawingNotes(_procIsImage?'':_pdfText, _procIsImage, _procImgData);
          if(notes.length){
            _sdDrawingNotes.push({drawingName: extractedRows[0]?.drawing_number || effectiveDwgName, notes});
          }
        }catch(e){ console.warn('[SD] notes extraction failed:', e.message); }
      }

      // Crimp tools for the pins / sockets / terminals: the Database, the
      // standard table, then the contact makers' datasheets (web) — priced.
      if(extractedRows.length){
        try{
          const t=await _addToolsToRows(extractedRows, msg=>setM(msg,98));
          const tm=_toolLookupMessage(t);
          if(tm) toast(tm, (t.notFound||[]).length||t.aiError ? 'warn' : 'success');
        }catch(e){ console.warn('[SD] tool lookup failed:', e.message); }
      }

      if(!extractedRows.length){
        errors.push(`"${file.name}" — no BOM rows detected${_bomDiag.length?` (${_bomDiag.join('; ')})`:''}`);
      } else {
        allRows.push(...extractedRows);
      }
    } catch(e){
      errors.push(`"${file.name}" — ${e.message}`);
    }
  }

  setLogDrawing([]);   // the reading is over; the save (below) sets it again
  if(errors.length) errors.forEach(msg=>toast(msg,'error'));

  if(!allRows.length){
    stages.set('read',{state:'warn', text:'No BOM rows were found', pct:100});
    ['desk','db','price'].forEach(k=>stages.set(k,{state:'skip'}));
    // What each file's reading did stays on screen (a toast is gone in seconds).
    body.insertAdjacentHTML('beforeend',`<p style="color:var(--muted);margin-top:10px">No BOM rows were detected in ${files.length>1?`any of the ${files.length} files`:'this file'}.</p>
      ${errors.length?`<div class="sd-import-why" style="margin-top:8px;font-size:12px;line-height:1.5;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px 10px;color:#7F1D1D">
        <strong>What happened:</strong><ul style="margin:4px 0 0 18px;padding:0">${errors.map(m=>`<li>${esc(m)}</li>`).join('')}</ul></div>`:''}`);
    foot.innerHTML=`<button class="btn btn-ghost" data-close-modal>Close</button>`;
    return;
  }
  stages.set('read',{state:'done', pct:100,
    text:`${allRows.length} row${allRows.length===1?'':'s'} found${files.length>1?` in ${files.length} files`:''}${errors.length?` · ${errors.length} file(s) skipped`:''}`});
  setLogDrawing(logDrawingsOf(allRows));

  // ── 2. Into the Sales Desk ──
  const _dirtyBefore=new Set(_sdDirtyRows());   // what the user had changed before this drawing
  stages.set('desk',{state:'run', text:`${allRows.length} rows…`});
  const added=_sdAddImportedRows(allRows);
  stages.set('desk',{state:'done', text:`${added.length} row${added.length===1?'':'s'} added`});
  logAudit('sales_desk_add_from_drawing',{count:added.length},true);
  document.getElementById('sd-tbody')&&renderSalesDesk();

  // ── 3. Into the Database ── (a read-only role can look, not write)
  let dbOk=false;
  if(_ro){
    stages.set('db',{state:'skip', text:'Your role is read-only — nothing was saved'});
  } else {
    stages.set('db',{state:'run', text:'Saving…', done:0, total:allRows.length});
    try{
      await saveBOMToPartStock(allRows, '', (d,t)=>stages.set('db',{state:'run', text:'Saving…', done:d, total:t}));
      dbOk=true;
      stages.set('db',{state:'done', text:'Saved', done:allRows.length, total:allRows.length});
      // The Check Price below finds these records and adds their prices.
      S.allParts=[]; await loadParts();
    }catch(e){
      stages.set('db',{state:'warn', text:'Could not save: '+e.message+' — use 💾 Save to Database on the desk to try again'});
    }
  }

  // ── 4. Prices ── (for the number of cables each drawing is set to — 1 for a new one)
  const items=added.filter(r=>String(r.part_number||'').trim()).map(r=>({
    part_number:r.part_number, qty:parseFloat(r.qty)||1, unit:r.unit||'',
    pack_ml:r.pack_ml||'', drawing_number:r.drawing_number||'', onlinecomp_uom:r.onlinecomp_uom||'', farnell_uom:r.farnell_uom||'',
    description:r.description||'', alt_mpns:r.alt_mpns||[], priority_price:r.priority_price||0, _sdIdx:sdItems.indexOf(r)}));
  let pr=null;
  if(!items.length){
    stages.set('price',{state:'skip', text:'No part numbers to look up'});
  } else {
    stages.set('price',{state:'run', text:'Looking up…', done:0, total:items.length});
    try{
      pr=await runFCCheckModal(items,'sd',{headless:true, saveToDb:!_ro && dbOk,
        onProgress:(d,t,f,x)=>stages.set('price',{state:'run', text:`${f} price${f===1?'':'s'} found${x?`, ${x} failed`:''} —`, done:d, total:t})});
      const apiErr=(pr.apiErrors||[]).filter(m=>!/no (api key|credentials) configured/i.test(m));
      const allFailed=pr.total>0 && pr.failures===pr.total;
      stages.set('price',{state:allFailed?'warn':'done', done:0, total:0, pct:100,
        text: allFailed ? `The price check failed — ${pr.lastError||'no answer from the distributors'}`
            : `${pr.found} of ${pr.total} found${pr.failures?`, ${pr.failures} failed`:''}${!_ro && dbOk?' — prices saved to the Database':''}${apiErr.length?` · ${apiErr.slice(0,2).join(' · ')}`:''}`});
    }catch(e){
      stages.set('price',{state:'warn', text:'The price check failed: '+e.message+' — run 🔍 Check Price on the desk'});
    }
  }
  S._sdPendingLaborByKey={};
  setLogDrawing([]);
  document.getElementById('sd-tbody')&&renderSalesDesk();
  await _sdAutoMatchLabor();
  document.getElementById('sd-tbody')&&renderSalesDesk();
  // The new rows are what the Database holds now (see _sdLeaveGuard); rows the
  // user had already changed stay changed.
  if(dbOk) _sdMarkCleanExcept(_dirtyBefore);
  const when=new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  body.insertAdjacentHTML('beforeend',`<div class="sd-import-done" style="margin-top:12px;font-size:13px;color:#1B6B3A;font-weight:600">
    ✓ Done (${when}) — ${added.length} row${added.length===1?'':'s'} on the Sales Desk${pr?` · ${pr.found}/${pr.total} priced`:''}.
    <div style="font-weight:400;color:var(--muted);font-size:12px;margin-top:3px">Prices are for ${items.length&&new Set(added.map(r=>_sdDwgKey(r))).size>1?'the number of cables each drawing is set to':'one cable'} — for a larger order, set <strong>Units</strong> and run 🔍 Check Price again. Fix any cell on the desk; 💾 Save to Database stores the changes.</div></div>`);
  foot.innerHTML=`<button class="btn btn-green" id="sd-import-close">Close</button>`;
  document.getElementById('sd-import-close').addEventListener('click',()=>closeModal());
  toast(`Added ${added.length} parts to Sales Desk${pr?` — ${pr.found} priced`:''}`,'success');
  // No popup here anymore — whether any TOOL row is excluded because it's
  // already in Stock is shown inline in each drawing’s Cost Summary block
  // in _sdUpdateSummaryUI, driven by _sdIsToolOwned).
}

// Turns rows read from drawings into Sales Desk rows (pushed onto sdItems) and
// returns them. What the Database already knows about a part fills the gaps.
export function _sdAddImportedRows(rows){
  const out=[];
  let _sdRowIdx=-1;
  // A synthesized tool row sits right after the connector it is for (the
  // extraction prompt asks for exactly that), so the connector is the last
  // non-tool row before it that has pins.
  let _lastConnector='';
  for(const r of rows){
    _sdRowIdx++;
    const _isTool=_sdIsToolRow(r);
    if(!_isTool && String(r.pin_count||'').trim()) _lastConnector=(r.part_number||'').trim();
    const pn=(r.part_number||'').trim().toLowerCase();
    const match=pn?S.allParts.find(p=>String(p.part_number||'').toLowerCase()===pn):null;
    const qty=parseFloat(r.qty)||1;
    const item={
      // NOT `|| r.item`: the item column is the row's ORDINAL on the sheet
      // ("1", "2", "3"), not a part number. Falling back to it filled MNF
      // P/N with 1..N on any file whose rows carry no manufacturer number,
      // which reads as a real part, gets sent to Check Price as one, and
      // matches nothing. An empty cell is the truthful answer.
      part_number:r.part_number||'', description:r.description||'',
      drawing_number:r.drawing_number||(_partLatestDrawing(match)||{}).drawing_number||match?.drawing_name||'',
      drawing_name:r.drawing_name||'', revision:r.revision||'', atlantium_pn:r.atlantium_pn||'',
      pin_count:r.pin_count||'', customer_supplied:!!r.customer_supplied,
      tool_source:_isTool ? (r.tool_source||'ai') : '',
      qty, unit:r.unit||match?.unit||match?.units||'pcs',
      // A crimp/insertion TOOL row carries its own approximate price on r.price
      // — prefer it, so the tool's estimate shows up immediately.
      est_price:r.price?(parseFloat(r.price)||0):(match?parseFloat(match.est_price)||0:0),
      alt_mpns:(r.alt_mpns||[]).length>1?r.alt_mpns:((match&&match.alt_mpns)||[]),
      priority_price:match?parseFloat(match.priority_price)||0:0, total:0,
      mouser_price:match?parseFloat(match.mouser_price)||'':'',
      ..._sdTraceFields(match),
      // A tool found and priced during the import carries its own prices
      // and links (see _addToolsToRows) — they win over an empty record.
      ...(_isTool ? _sdToolRowPrices(r) : {}),
      tool_for: _isTool ? (r.tool_for||_lastConnector) : '',
      digikey_price:match?parseFloat(match.digikey_price)||'':'',
      ...(_isTool && +r.digikey_price>0 ? {digikey_price:+r.digikey_price} : {}),
      onlinecomp_price:match?parseFloat(match.onlinecomp_price)||'':'',
      ...(_isTool && +r.onlinecomp_price>0 ? {onlinecomp_price:+r.onlinecomp_price} : {}),
      farnell_price:match?parseFloat(match.farnell_price)||'':'',
      ...(_isTool && +r.farnell_price>0 ? {farnell_price:+r.farnell_price} : {}),
      tool_url:r.tool_url||'', tool_in_db:!!r.tool_in_db,
      // An adhesive's bottle size: the Database's, else what the drawing says ("LOCTITE 243 50ML").
      pack_ml: parseFloat(match?.pack_ml)>0 ? +match.pack_ml : (_parsePackMl(`${r.description||''} ${r.part_number||''}`)||''),
      tool_note:_isTool ? (r.tool_note||'') : '', tool_pages:_isTool && Array.isArray(r.tool_pages) ? r.tool_pages : [],
      labor_time:'', labor_total:0,
    };
    // Cable-process-analysis time (see handleSDFiles) is the sole source of
    // an auto-filled Labor Time for drawing-imported rows. It's already a
    // FIXED TOTAL (unit_minutes × qty_in_drawing) — _laborFixedTotal tells
    // _sdRecalcLaborTotal to use it as-is instead of multiplying again by
    // this row's own qty column.
    if(r._labor_min!=null && (parseFloat(r._labor_min)||0)>0){
      item.labor_time = String(+parseFloat(r._labor_min).toFixed(2));
      item._laborFixedTotal = true;
    }
    _sdRecalcRow(item);
    sdItems.push(item);
    out.push(item);
  }
  return out;
}

// The prices and links a tool row brought from the import (only what is set).
export function _sdToolRowPrices(r){
  const out={};
  for(const k of ['mouser_price','digikey_price','onlinecomp_price','farnell_price']) if(+r[k]>0) out[k]=+r[k];
  for(const k of ['mouser_url','digikey_url','onlinecomp_url','farnell_url','mouser_stock','digikey_stock','onlinecomp_stock','farnell_stock','mouser_match','digikey_match','onlinecomp_match','farnell_match',
                  'mouser_mpn','digikey_mpn','onlinecomp_mpn','farnell_mpn','onlinecomp_uom','farnell_uom'])
    if(r[k]!=null && r[k]!=='') out[k]=r[k];
  for(const k of ['mouser_brk','digikey_brk','onlinecomp_brk','farnell_brk']) if(+r[k]>0) out[k]=+r[k];
  return out;
}
