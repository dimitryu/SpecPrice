import { S } from '../../core/state.js';
import { _bomFromPDF, _findBOMPageIndex, aiExtractBOM } from '../../ai/bom.js';
import { _aiReady } from '../../ai/client.js';
import { aiAnalyzeCableProcess, aiExtractDrawingNotes } from '../../ai/process.js';
import { logAudit } from '../../core/audit.js';
import { parseBoolQuery, wireSearchClear, wireShiftCheck } from '../../core/table.js';
import { closeModal, debounce, esc, fmtPrice, showModal, toast } from '../../core/ui.js';
import { saveBOMToPartStock } from '../../data/parts.js';
import { _normalizeBOMRows, _normalizeExtractedRow, parseExcelSheetsStructured } from '../../domain/bom.js';
import { _xlsConfirmMapping, showBOMPreview } from '../bomImport.js';
import { _sdAutoMatchLabor } from './labor.js';
import { _sdDrawingNotes, _sdRecalcRow, renderSalesDesk, sdItems } from './salesDesk.js';
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
    <div class="modal-head"><h3>📦 Select from Database</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
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
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" id="pp-add">＋ Add Selected</button>
    </div>
  </div>`);

  let visibleParts=[];
  const fieldSel=document.getElementById('pp-field');
  const valueSel=document.getElementById('pp-value');
  const searchInp=document.getElementById('pp-search');
  wireSearchClear('pp-search','pp-search-clear');

  const reloadValueOptions=()=>{
    const field=fieldSel.value;
    const values=[...new Set(S.allParts.map(p=>p[field]).filter(Boolean).map(v=>String(v).trim()).filter(Boolean))]
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
      if(val && String(p[field]||'').trim()!==val) return false;
      if(searchInp.value.trim()){
        const haystack=[p.part_number,p.description,p.manufacturer,p.drawing_number,p.drawing_name]
          .map(v=>String(v||'')).join(' | ').toLowerCase();
        if(!predicate(haystack)) return false;
      }
      return true;
    });
    const tb=document.getElementById('pp-tbody');
    tb.innerHTML=visibleParts.map(p=>{
      const fc=parseFloat(p.price)||0, pr=parseFloat(p.priority_price)||0;
      let fcC='',prC='';
      if(fc&&pr){fcC=fc<=pr?'price-green':'price-red';prC=pr<=fc?'price-green':'price-red';}
      return `<tr data-id="${esc(p._id)}">
        <td style="text-align:center"><input type="checkbox" class="pp-check" data-id="${esc(p._id)}"></td>
        <td>${esc(p.part_number)}</td><td>${esc(p.drawing_number)}</td><td>${esc(p.drawing_name)}</td>
        <td class="wrap">${esc(p.description)}</td><td>${esc(p.qty)}</td><td>${esc(p.unit||p.units)}</td>
        <td>${fc?`<span class="${fcC}">${fmtPrice(fc)}</span>`:''}</td>
        <td>${pr?`<span class="${prC}">${fmtPrice(pr)}</span>`:''}</td>
      </tr>`;
    }).join('')||`<tr class="empty-row"><td colspan="9">No parts match this filter</td></tr>`;
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
    const selected = hadSelection ? S.allParts.filter(p=>checked.includes(p._id)) : visibleParts;
    if(!selected.length){ toast('No parts to add','error'); return; }
    closeModal();
    onAdd(selected, qtyOverride, hadSelection);
  });
}

export function openSDFileModal(){
  showModal(`<div class="modal">
    <div class="modal-head"><h3>Import BOM from File</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="sd-modal-body">
      <div class="drop-zone" id="sd-drop-zone" tabindex="0">
        <span class="icon-big">📄</span>
        <strong>Drop PDF, Image or Excel here</strong>
        <p>PDF / PNG / JPG / XLSX / XLS / CSV — parts will be added to Sales Desk. You can select multiple files, extracted together into one review.</p>
        <input type="file" id="sd-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.xlsx,.xlsm,.xls,.csv" multiple style="display:none">
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
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

  for(let fidx=0; fidx<files.length; fidx++){
    const file=files[fidx];
    const isPDF=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
    const isImg=file.type.startsWith('image/');
    const isXls=_isSpreadsheetFile(file);
    if(!isPDF&&!isImg&&!isXls){ errors.push(`"${file.name}" — not a PDF, image or spreadsheet, skipped`); continue; }

    const filePrefix = files.length>1 ? `File ${fidx+1}/${files.length}: ${esc(file.name)} — ` : '';
    body.innerHTML=`<div class="ai-status"><div class="ring"></div><span id="sd-ai-msg">${filePrefix}${isXls?'Reading spreadsheet…':(isPDF?'Extracting PDF text…':'Reading image…')}</span></div>
      <div class="progress-bar"><div class="progress-fill" id="sd-prog"></div></div>`;
    foot.innerHTML='';
    const setM=(m,p)=>{
      const e=document.getElementById('sd-ai-msg');if(e)e.textContent=filePrefix+m;
      const b=document.getElementById('sd-prog');if(b)b.style.width=p+'%';
    };

    try {
      let extractedRows=[];
      let _pdfText='', _pdfTextLen=0, _pdfImages=[];
      let _procIsImage=false, _procImgData=null; // whichever image (if any) ended up being used — reused below for the cable-process analysis

      if(isXls){
        setM('Reading spreadsheet…',20);
        const sheets=await readExcelSheets(file);
        const sheetText=await extractExcelText(file);
        // Same column-mapping confirmation as the RFQ import — see
        // _xlsConfirmMapping. A recognised export goes straight through.
        const _colChoice=await _xlsConfirmMapping(sheets, file.name, body, foot);
        if(_colChoice===null){ errors.push(`"${file.name}" — import cancelled`); continue; }
        body.innerHTML=`<div class="ai-status"><div class="ring"></div><span id="sd-ai-msg">${filePrefix}Reading spreadsheet…</span></div>
      <div class="progress-bar"><div class="progress-fill" id="sd-prog"></div></div>`;
        foot.innerHTML='';
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
        extractedRows=r.rows; _pdfImages=r.pageImages; _pdfText=r.pdfText; _pdfTextLen=r.textLen;
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

      _normalizeBOMRows(extractedRows);
      // Parse filename: "303-49-00251-00 REV 01 _approved.pdf"
      // → drawingName="303-49-00251-00", revision="REV 01 _approved"
      const _fileBase=file.name.replace(/\.[^.]+$/,'');
      const _spaceIdx=_fileBase.indexOf(' ');
      const effectiveDwgName=_spaceIdx>0 ? _fileBase.slice(0,_spaceIdx) : _fileBase;
      const fileRevision=_spaceIdx>0 ? _fileBase.slice(_spaceIdx+1).trim() : '';
      extractedRows.forEach(r=>{
        if(!r.drawing_number) r.drawing_number=effectiveDwgName;
        if(!r.drawing_name) r.drawing_name=effectiveDwgName;
        if(!r.revision) r.revision=fileRevision;
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

      if(!extractedRows.length){
        errors.push(`"${file.name}" — no BOM rows detected`);
      } else {
        allRows.push(...extractedRows);
      }
    } catch(e){
      errors.push(`"${file.name}" — ${e.message}`);
    }
  }

  if(errors.length) errors.forEach(msg=>toast(msg,'error'));

  const _ringEl=body.querySelector('.ring');
  if(_ringEl){_ringEl.style.cssText='width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1';
    _ringEl.textContent='✓';}

  if(!allRows.length){
    body.innerHTML=`<p style="color:var(--muted);margin-top:10px">No BOM rows were detected in ${files.length>1?`any of the ${files.length} files`:'this file'}.</p>`;
    foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
    return;
  }

  // Show editable preview — on Save: save to Part Stock + add to Sales Desk
  showBOMPreview(allRows, body, foot,
    `💾 Save to Database + Sales Desk (${allRows.length} rows${files.length>1?` from ${files.length} files`:''})`,
    async(updatedRows)=>{
      await saveBOMToPartStock(updatedRows);
      let added=0;
      let _sdRowIdx=-1;
      for(const r of updatedRows){
        _sdRowIdx++;
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
          drawing_number:r.drawing_number||match?.drawing_number||match?.drawing_name||'',
          qty, unit:r.unit||match?.unit||match?.units||'pcs',
          // A crimp/insertion TOOL row is synthesized fresh by the AI during
          // drawing extraction (see _BOM_TEXT_PROMPT/_BOM_VISION_PROMPT rule 5)
          // and carries its own approximate price on r.price — it generally
          // won't be found in the Database (allParts/match) yet since it was
          // just created by saveBOMToPartStock a few lines above and the local
          // allParts cache hasn't been refreshed. Prefer r.price when present
          // so the tool's estimate shows up immediately instead of appearing as
          // $0.00 until the next Database refresh.
          est_price:r.price?(parseFloat(r.price)||0):(match?parseFloat(match.est_price)||0:0),
          alt_mpns:(r.alt_mpns||[]).length>1?r.alt_mpns:((match&&match.alt_mpns)||[]),
          priority_price:match?parseFloat(match.priority_price)||0:0, total:0,
          mouser_price:match?parseFloat(match.mouser_price)||'':'',
          digikey_price:match?parseFloat(match.digikey_price)||'':'',
          labor_time:'', labor_total:0,
          // Whether this tool is already owned (in Stock) is no longer decided
          // here once at import time — see _sdIsToolOwned, which checks the
          // Database live every time Cost Summary recomputes, so toggling the
          // Stock checkbox later is picked up immediately.
        };
        // Cable-process-analysis time (see handleSDFiles) is the sole source of
        // an auto-filled Labor Time for drawing-imported rows (Manufacturing
        // Routings, a keyword-based fallback, was removed). It's already a
        // FIXED TOTAL (unit_minutes × qty_in_drawing, computed in handleSDFiles
        // from the AI's own count of drawing repeats) — _laborFixedTotal tells
        // _sdRecalcLaborTotal to use it as-is instead of multiplying again by
        // this row's own qty column (see that function for why).
        // Must match the EXACT same fallback priority used when this key was
        // stored above (row.part_number||row.description||step.row_idx), and be
        // built from `r` rather than `item` — the two used to diverge for rows
        // with no manufacturer part number (item.part_number fell back to the
        // item ORDINAL, the storage side to the description), which silently
        // dropped the AI-computed fixed total for exactly those rows: plain
        // cable/wire and generic hardware. That fallback is gone now, but keep
        // both sides reading from `r` so they cannot drift apart again.
        if(r._labor_min!=null && (parseFloat(r._labor_min)||0)>0){
          item.labor_time = String(+parseFloat(r._labor_min).toFixed(2));
          item._laborFixedTotal = true;
        }
        _sdRecalcRow(item);
        sdItems.push(item);
        added++;
      }
      S._sdPendingLaborByKey={};
      toast(`Added ${added} parts to Sales Desk`,'success');
      logAudit('sales_desk_add_from_drawing',{count:added},true);
      closeModal();
      document.getElementById('sd-tbody')&&renderSalesDesk();
      await _sdAutoMatchLabor();
      document.getElementById('sd-tbody')&&renderSalesDesk();
      // No popup here anymore — whether any TOOL row is excluded because it's
      // already in Stock is shown inline in each drawing’s Cost Summary block
      // in _sdUpdateSummaryUI, driven by _sdIsToolOwned), which the renderSalesDesk()
      // call above already refreshes.
    }
  );
}
