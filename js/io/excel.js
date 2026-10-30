// ── AI BOM extraction (Anthropic) ─────────────────────────────────────────────
// Text prompt — same as Windows app ai_extractor.py
// ── Spreadsheet (.xlsx/.xls/.csv) BOM import ─────────────────────────────────
// Matched on extension rather than MIME type: browsers report spreadsheets
// inconsistently (and often as application/octet-stream when the file came off
// a network share or an ERP export), so the extension is the reliable signal.
export function _isSpreadsheetFile(file){
  return /\.(xlsx|xlsm|xls|csv)$/i.test(file?.name||'');
}

// Reads every sheet into raw row arrays — the shared input for both the
// deterministic parser and the AI text fallback.
export async function readExcelSheets(file){
  if(!window.XLSX) throw new Error('Excel library not loaded — please reload the page');
  const ab=await file.arrayBuffer();
  const wb=XLSX.read(ab,{type:'array'});
  return wb.SheetNames.map(name=>({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:''})
  }));
}

export async function extractExcelText(file){
  if(!window.XLSX) throw new Error('Excel library not loaded — please reload the page');
  const ab=await file.arrayBuffer();
  const wb=XLSX.read(ab,{type:'array'});
  const out=[];
  for(const name of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:''});
    const lines=[];
    rows.forEach((row,i)=>{
      const cells=(row||[]).map(c=>String(c??'').trim());
      while(cells.length && !cells[cells.length-1]) cells.pop(); // trim trailing empties
      if(!cells.some(c=>c)) return;                              // skip fully blank rows
      lines.push(`r${i+1}: ${cells.join(' | ')}`);
    });
    if(lines.length) out.push(`=== SHEET "${name}" ===\n${lines.join('\n')}`);
  }
  return out.join('\n\n');
}

// ── Sales Desk → Excel quote export (client-side via SheetJS) ─────────────────
// Replaces the old Print/Save-PDF button. Mirrors the layout/columns/summary rows
// of the Windows app's ui/sales_desk_dialog.py _generate_quote_xlsx (item, drawing#,
// part#, drawing name, customer PN, description, qty, unit, manufacturer,
// priority/Mouser/DigiKey price, part cost, labor time, then a summary block).
// ══════════════════════════════════════════════════════════════════════════════
// SALES DESK — formatted Excel quotation
// ------------------------------------------------------------------------------
// Built with ExcelJS, not SheetJS. The SheetJS community build the app already
// loads cannot write cell styling or embed images at all — those are paid-edition
// features — so a branded, colour-coded sheet is simply not expressible with it.
// ExcelJS is loaded on demand (it's ~950 KB) so it costs nothing until someone
// actually exports.
// ══════════════════════════════════════════════════════════════════════════════
export let _exceljsPromise=null;
export function loadExcelJS(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(_exceljsPromise) return _exceljsPromise;
  _exceljsPromise=new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    el.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('ExcelJS failed to initialise'));
    el.onerror=()=>reject(new Error('Could not load the Excel formatting library — check your connection'));
    document.head.appendChild(el);
  });
  return _exceljsPromise;
}

// Palette. Deliberately the same meanings the app uses on screen, so the
// exported file reads the same way as what the user was just looking at.
export const _XL = {
  brand:      'FF1E3A5F',   // header band
  brandLight: 'FFEFF4FA',   // meta block
  bomHead:    'FF2E5E8E',   // BOM column headers
  bomBand:    'FFF7F9FC',   // zebra striping on BOM rows
  tool:       'FFFFFBEB',   // TOOL rows — matches the amber used in Sales Desk
  toolEdge:   'FFF59E0B',
  calc:       'FFF1F5F9',   // cost build-up
  final:      'FF166534',   // FINAL PRICE
  warn:       'FFFEF3C7',
  warnEdge:   'FFF59E0B',
  border:     'FFCBD5E1',
};
export const _xlThin={style:'thin',color:{argb:_XL.border}};
export const _xlBoxed={top:_xlThin,left:_xlThin,bottom:_xlThin,right:_xlThin};
