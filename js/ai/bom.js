import { S } from '../core/state.js';
import { _AI_NO_KEY, _aiFetch, _aiReady, _csModel, _csModelRejected, _parseAIJson } from './client.js';
import { logSystemAudit } from '../core/audit.js';
import { extractPDFPages } from '../io/pdf.js';

// Rows from overlapping bands, joined: a row seen at the bottom of one band and
// again at the top of the next is the same row once.
export function _bomMergeBands(lists){
  const out=[];
  const key=r=>`${String(r?.item??'').trim()}|${String(r?.part_number||'').trim().toUpperCase()}|${String(r?.description||'').trim().toUpperCase()}`;
  for(const rows of lists){
    const seen=new Set(out.slice(-12).map(key));
    for(const r of (rows||[])){ if(!seen.has(key(r))) out.push(r); }
  }
  return out;
}
// Whether a page's TEXT layer carries a parts list at all: a line naming at
// least three of the columns a parts list has. A schematic exported from a CAD
// tool is full of real text — net names, wire colours, part numbers on the
// symbols — so "the text is long" says nothing about whether the table is in
// it. On this shop's drawings the table is very often a picture pasted on the
// sheet, and the text layer then holds everything but it.
export const _BOM_HEADER_TOKENS=[/\bitem\b|\bpos\b|^#|\s#\s/i, /\bq(?:uan)?ty\b|\bquantity\b/i,
  /\bdesc(?:ription)?\b/i, /\bp\/?n\b|part\s*(?:no|num|number)|\bpn\b|catalog/i,
  /\bmanufacturer\b|\bmfr\b|\bmfg\b|\bvendor\b/i, /\bu\/?m\b|\bunit\b|\buom\b/i, /\bref(?:erence)?\b|designator/i];
export function _textHasBomHeader(pageTexts){
  return (pageTexts||[]).some(t=>String(t||'').split('\n').some(line=>
    _BOM_HEADER_TOKENS.filter(re=>re.test(line)).length>=3));
}
export const _BOM_LOCATE_PROMPT=`Look at this engineering drawing sheet. Is there a PARTS LIST / BOM table on it —
a table whose columns are things like ITEM, PART No., DESCRIPTION, MANUFACTURER, QTY, U/M? It may be
small, in any corner, and it may be a picture pasted onto the sheet. A title block, a revision table,
a pin-out or wiring table, and a label table are NOT a parts list.

Return ONE JSON object and nothing else:
{"found":true,"box":[x0,y0,x1,y1],"rows":<about how many data rows>}
where the box is the table's outline as fractions of the image (0 = left/top, 1 = right/bottom),
including its header row. If there is no parts list on this sheet: {"found":false}`;
export async function _bomLocate(b64){
  const resp=await _aiFetch({
    body:JSON.stringify({model:_csModel(), max_tokens:300, temperature:0, messages:[{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
      {type:'text',text:_BOM_LOCATE_PROMPT}]}]})
  });
  if(!resp.ok){ let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json();m=e.error?.message||m;}catch{}
    if(_csModelRejected(resp.status,m)){ S._csModelDown=true; return _bomLocate(b64); }
    throw new Error(m); }
  const d=await resp.json();
  return _bomParseLocate((d.content&&d.content[0]&&d.content[0].text)||'');
}
export function _bomParseLocate(text){
  const m=/\{[\s\S]*\}/.exec(String(text||''));
  if(!m) return null;
  let o; try{ o=JSON.parse(m[0]); }catch{ return null; }
  if(!o || o.found!==true || !Array.isArray(o.box) || o.box.length!==4) return null;
  const b=o.box.map(Number);
  if(b.some(v=>!Number.isFinite(v))) return null;
  // Some answers come back in percent rather than fractions.
  const box = b.some(v=>v>1.5) ? b.map(v=>v/100) : b;
  return {box, rows:Number(o.rows)||0};
}
// The whole PDF path of a BOM import, shared by both screens that import one.
// Returns the rows, the page they came from, and that page's image (the cable
// process analysis that follows looks at the same sheet).
export async function _bomFromPDF(file, setMsg){
  setMsg('Reading PDF pages…', 15);
  const {pageTexts, pageImages, crop}=await extractPDFPages(file);
  const pdfText=pageTexts.map((t,i)=>`=== PAGE ${i+1} ===\n${t}`).join('\n\n');
  const textLen=pageTexts.join('').trim().length;
  const bomPageIdx=_findBOMPageIndex(pageTexts);
  const bomPageSparse=bomPageIdx>=0 && (pageTexts[bomPageIdx]||'').trim().length<400;
  const hasHeader=_textHasBomHeader(pageTexts);
  let rows=[], page=-1, how='';

  // 1. The text layer, when it actually holds a parts list: exact and quick.
  if(textLen>50 && hasHeader){
    setMsg('Sending text to AI…', 40);
    rows=await aiExtractBOM(pdfText, false, null, file.name);
    if(rows.length){ how='text'; page=bomPageIdx; }
  }
  // 2. Otherwise the picture: find the table on the sheet, then read just that
  //    region rendered sharp. Pages with a parts-list heading go first.
  if((!rows.length || bomPageSparse) && _aiReady()){
    const order=pageImages.map((_,i)=>i);
    if(bomPageIdx>0){ order.splice(order.indexOf(bomPageIdx),1); order.unshift(bomPageIdx); }
    for(let k=0;k<order.length && (!rows.length || how!=='region');k++){
      const pi=order[k];
      if(!pageImages[pi]) continue;
      setMsg(`Looking for the parts list on page ${pi+1}/${pageImages.length}…`, 50+Math.round(30*k/order.length));
      let loc=null;
      try{ loc=await _bomLocate(pageImages[pi]); }catch(e){ console.warn('[BOM] locate', e.message); }
      if(!loc) continue;
      setMsg(`Reading the parts list on page ${pi+1}…`, 60+Math.round(30*k/order.length));
      const bands=await crop(pi, loc.box);
      const lists=[];
      for(const b64 of bands) lists.push(await aiExtractBOM('', true, {b64, mimeType:'image/jpeg'}, file.name));
      const got=_bomMergeBands(lists);
      if(got.length && got.length>=rows.length){ rows=got; page=pi; how='region'; }
    }
    // 3. Nothing located: the whole sheet, as before.
    if(!rows.length){
      for(let k=0;k<order.length;k++){
        const pi=order[k];
        if(!pageImages[pi]) continue;
        setMsg(`Vision analysis: page ${pi+1}/${pageImages.length}…`, 85);
        const got=await aiExtractBOM('', true, {b64:pageImages[pi], mimeType:'image/jpeg'}, file.name);
        if(got.length){ rows=got; page=pi; how='page'; break; }
      }
    }
  }
  // 4. Last resort for a text layer with no recognisable header: it may still
  //    be a table the header test did not catch.
  if(!rows.length && textLen>50 && !hasHeader){
    setMsg('Sending text to AI…', 90);
    rows=await aiExtractBOM(pdfText, false, null, file.name);
    if(rows.length) how='text';
  }
  logSystemAudit('drawing_bom_pdf',{filename:file.name, how, page:page+1, rows:rows.length, text_header:hasHeader},true);
  const imgIdx = page>=0 ? page : (bomPageIdx>=0 ? bomPageIdx : 0);
  return {rows, pageTexts, pageImages, pdfText, textLen,
          imgData: pageImages[imgIdx] ? {b64:pageImages[imgIdx], mimeType:'image/jpeg'} : null,
          fromImage: how==='region' || how==='page'};
}

// Multi-page drawings often put the actual BOM / Assembly Parts List table on
// its own sheet (frequently the LAST page) — but that table's CELLS are very
// often rendered as vector/raster graphics by the CAD tool, not real text,
// even though the sheet's own header/title IS real text (e.g. a page whose
// pdf.js text layer is just "Assembly Parts List / Rev: / Status: Item
// Name:" with none of the actual part numbers or item rows). Detect which
// page is meant to be the BOM sheet by that header, so vision analysis can be
// pointed at it directly and given priority — a whole-document text blob
// that happens to have SOME real text elsewhere (title block boilerplate,
// revision history, etc.) can otherwise return non-empty but WRONG rows,
// silently skipping the vision fallback that would have found the real table.
export const _BOM_PAGE_HEADER_RE=/assembly\s*parts\s*list|bill\s*of\s*material(?:s)?|\bbom\b/i;
export function _findBOMPageIndex(pageTexts){
  return pageTexts.findIndex(t=>_BOM_PAGE_HEADER_RE.test(t||''));
}

// Spreadsheet BOM exports (ERP/PLM reports) are structured very differently from
// a drawing's parts list: they often carry a row-TYPE column where only some row
// types are real purchasable components, and manufacturer data lives on separate
// child rows beneath each component. This prompt teaches that shape explicitly,
// using the ELBIT "BOM QVL Report" layout as the worked example, and encodes the
// mapping decisions agreed with the user (StdPart rows only; first QVL row wins;
// qty defaults to 1 when the export has no quantity column at all).
export const _BOM_EXCEL_PROMPT = (filename) =>
  `You are an expert at reading Bill of Materials (BOM) exports from ERP/PLM systems that arrive as spreadsheets.

TASK: Extract the real component rows from the spreadsheet grid below. Each line is one spreadsheet row: "r<N>: cell | cell | cell".

UNDERSTANDING THE LAYOUT:
- A header row (often NOT row 1 — earlier rows hold a report title, top-level part number, date, etc.) names the columns. Find it first and map columns by NAME, not by position.
- Many exports are HIERARCHICAL: a component row is followed by one or more CHILD rows that describe it further (approved manufacturers/vendors). Child rows are recognisable because their key identity columns are blank while a type/category column marks them as vendor entries.

ROW-TYPE COLUMN (e.g. a column literally named "Type"): treat its values as follows —
- "StdPart" → a REAL purchasable component. THIS is what becomes a BOM row.
- "Qualified Vendor List" (QVL) → NOT its own BOM row. It supplies the manufacturer part number and manufacturer NAME for the StdPart row directly above it. If a component has SEVERAL QVL rows, use the FIRST one that appears and ignore the rest.
- "StdPart Revision", "SpecTdp", "SpecTdp Revision", "DocumentTdp", "DocumentTdp Revision" → internal sub-assembly / drawing / document references. SKIP these entirely — they are not purchasable components.
- If there is no type column at all, just extract every genuine data row of the BOM table.

REPEATED COMPONENTS: these exports list the same component once per place it is used. Output EVERY one of those lines as its own row, in sheet order, each with its own item number and its own quantity. Do not merge them and do not drop any of them — a component on three lines produces three rows. Merging them and keeping only the first line's quantity is what orders a third of what the assembly needs.

FIELD MAPPING (map by column name; names vary between systems):
- "atlantium_pn" → the customer's/company's internal part number — look for: PART NUM, PART NUMBER, ITEM ID, CATALOG, INTERNAL PN, CUST PN
- "part_number" → the MANUFACTURER part number, taken from the component's first QVL/vendor child row — look for: MFPN, MPN, MFG PN, MANUFACTURER PN, VENDOR PN. If the component has no vendor row at all, leave "" .
- "manufacturer" → manufacturer/vendor name from that same QVL row — look for: VENDOR, MANUFACTURER, MFG, SUPPLIER
- "description" → the component's descriptive text — look for: DESCRIPTION, NAME, DESC. Prefer the longer/fuller of the two if both exist.
- "qty" → quantity — look for: QTY, QUANTITY, NO. REQ'D, AMOUNT, USAGE. **If the export has NO quantity column anywhere, use "1" for every row.**
- "unit" → unit of measure — look for: UOM, UNIT, U/M. The ONLY valid values are "pc", "mm", "cm", "ea", "gm", "M". Map "each"/"EA"→"pc" and "FT"/"FEET"→"" (leave empty — a foot isn't one of the valid units; the app converts lengths separately). Anything unrecognised → "".
- "item" → the row's sequence number if the sheet has one, else ""
- "drawing_number" / "drawing_name" → the top-level assembly part number / title if the report header states one (e.g. a "Part Number:" cell near the top), else ""
- "pin_count" → number of pins/positions/contacts for connector components, if stated or reliably inferable from the part number/description of a known connector series. Else "".
- "price" → always "" here (spreadsheet BOM exports don't carry pricing; the app prices parts separately). The ONLY exception is a synthesized crimp-tool row — see below.

${_BOM_TOOL_RULE_SECTION}

RULES:
1. Output one row for EVERY component line in the sheet, in sheet order — a component listed on three lines produces three rows, each with its own item number and quantity
2. Never output a QVL/vendor child row as its own BOM row — fold it into its parent component
3. Never output sub-assembly/document rows (SpecTdp/DocumentTdp and their Revisions)
4. Read part numbers character by character — they are precise: do NOT guess or correct them
5. If a field is genuinely absent, use empty string "" (except qty — see the qty rule above)

Return ONLY a valid JSON array, no explanations.
Example: [{"item":"","atlantium_pn":"00050470N","part_number":"GRM426X7R103K50","drawing_number":"20583410900","drawing_name":"","description":"CAP CHIP CER 10NF 50V 10% 1206","qty":"1","unit":"pc","manufacturer":"MURATA ELECT.NORTH AMERICA LTD","pin_count":"","price":""}]
If no BOM is found, return: []

SPREADSHEET (file: ${filename}):`;

// Shared by BOTH BOM prompts (text + vision) — kept as its own constant so the
// Settings > AI Prompts panel can show it as a standalone topic, and so the
// rule can only ever be edited in one place (the two prompts must never drift
// apart on how tools are detected/priced).
export const _BOM_TOOL_RULE_SECTION =
  `CRIMP/INSERTION TOOL ROWS — MANDATORY, CHECK EVERY ROW: this is a required
step, not optional — after extracting the BOM, go back through EVERY row that
has a "pin_count" value (any connector with pins/positions/contacts) and, for
EACH one, add ONE EXTRA ROW right after it for the crimping/insertion tool
that connector needs, using your knowledge of that connector manufacturer's
tooling. Do this for every qualifying connector row, not just the first one
you notice. Only add a tool row when you're reasonably confident of the exact
tool part number (never invent a plausible-looking one — if genuinely unsure
for a specific connector, skip just that one). For the tool row: "part_number"
= the tool's manufacturer part number, "description" = a short description
containing the word "TOOL" (e.g. "CRIMP TOOL for <connector series>"),
"qty"="1", "unit"="pc", "price" = the tool's approximate USD list price
(plain number, no currency symbol), "pin_count"="", "item"="".`;

export const _BOM_TEXT_PROMPT = (filename) =>
  `You are an expert at extracting Bill of Materials (BOM) tables from engineering drawings.

TASK: Extract ALL rows from the BOM table in the text below. Do NOT stop early — even if there are 30+ rows.

FINDING THE RIGHT TABLE: A multi-page drawing package often has SEVERAL tables —
a title block, a sheet/revision record, a hole chart, etc. — but only ONE of
them is the actual BOM: it is titled something like "ASSEMBLY PARTS LIST",
"PARTS LIST", or "BILL OF MATERIALS", and its rows have REAL data in both an
ITEM/# column AND a PART NUMBER/PN column. Only extract from that table.
Do NOT extract rows from a title block, revision/ECO record, or any other
table that lacks real item numbers and part numbers, even if it superficially
has similar-looking column headers (e.g. "NAME", "DESCRIPTION").

COLUMN MAPPING (column names may vary between drawings):
- "item" → row number (1, 2, 3 ...) — look for: ITEM, #, NO., SEQ
- "description" → component description — look for: DESCRIPTION, DESC, NAME
- "atlantium_pn" → company internal part number — look for: ATLANTIUM PN, INTERNAL PN, CATALOG NO, CUST PN, CUSTOMER PN, a "<COMPANY INITIALS> PART No." column such as B.B PART No.
- "manufacturer" → maker name — look for: MANUFACTURER, MFG, MAKE, VENDOR
- "part_number" → manufacturer part number — look for: MANUFACTURER PART No., MANUFACTURER PN, MFR PN, MFG PN; only when there is no such column: PART NUMBER, PART NO, PN, P/N
- "drawing_number" → drawing number — look for: DWG NO, DRAWING NO, DRAWING #
- "drawing_name" → drawing title or assembly name
- "qty" → quantity — look for: QTY, QUANTITY, NO. REQ'D, NO. OFF, AMOUNT. Return as a plain number string (e.g. "3", "2500"). This is REQUIRED for every row — do not leave it empty unless the drawing genuinely has no quantity column.
- "unit" → unit of measure — look for: UNIT, UOM, U/M — the ONLY valid values are: "pc", "mm", "cm", "ea", "gm" (grams — also written "GR"), "M" (meters). If the column shows anything else, leave "unit" as empty string "" rather than inventing or guessing a unit.
- "pin_count" → for connector parts only: the number of pins/positions/contacts (look for a POS, PINS, CONTACTS, WAY column, or a count embedded in the part number/description of a known connector series). Empty string "" if the row isn't a connector or the count isn't known — do not guess.
- "price" → normally leave this empty string "" (component pricing comes from FindChips/Priority separately, not from the drawing). The ONLY exception is a synthesized crimp-tool row — see rule 5 below.
TWO PART-NUMBER COLUMNS: many parts lists carry the company's OWN number for each
part AND the manufacturer's number, in two separate columns. Map them by what they ARE,
never by which one is called "PART No.":
- the column headed MANUFACTURER PART No. / MFR P/N / MFG P/N / MPN / VENDOR P/N
  → "part_number" (shown in the app as MNF P/N)
- the company's own column — often headed with the company's initials or name
  ("B.B PART No.", "<COMPANY> P/N"), or INTERNAL P/N, CAT. NO., ITEM CODE, CUST PN, or just
  "PART No." when a manufacturer column sits beside it — whose codes usually share one
  house pattern (EL-000787, CON-10652, SHR-12765)
  → "atlantium_pn" (shown in the app as Customer PN)
When a manufacturer-part-number column exists, the company's own number NEVER goes in
"part_number". Example, columns ITEM | B.B PART No. | DESCRIPTION | MANUFACTURER |
MANUFACTURER PART No. | U/M | QTY with the row 3 | EL-000787 | Wire 26 awg RED | WEICO |
2126/19-2 | CM | 200 →
{"item":"3","atlantium_pn":"EL-000787","part_number":"2126/19-2","description":"Wire 26 awg RED","manufacturer":"WEICO","unit":"cm","qty":"200"}
Only when the table has a single part-number column does that column go in "part_number".
THE SAME PART ON SEVERAL LINES: a parts list often gives one part more than one
item number, because it is fitted in more than one place. Output EVERY one of
those lines as its own row, in the order they appear, each keeping its own item
number and quantity. Do not merge them into one row and do not drop any of them
— merging and keeping the first line's quantity orders a fraction of what the
assembly needs.

QTY RULE: If there are multiple quantity columns (e.g. for different product sizes), take the FIRST one only.

QTY DISAMBIGUATION: for cable/wire rows, the QTY value is very often a LENGTH
with its unit stuck directly to the number, e.g. "230mm", "2500mm", "1.5M" —
in raw extracted PDF text this can visually blur into the tail of the
DESCRIPTION or a trailing REF/LOCATION column instead of reading as its own
QTY cell. Keep it in "qty" (e.g. qty="230mm"), never fold it into
"description", and never default qty to "1" just because it has a unit
attached. Example: "...CABLE 4COND 28AWG BLK SHLD 230mm CABLE" (trailing
"CABLE" is a REF tag) → description="CABLE 4COND 28AWG BLK SHLD", qty="230mm".

${_BOM_TOOL_RULE_SECTION}

RULES:
1. Extract EVERY data row — include all items, do not truncate
2. Skip header rows, total/summary rows, and blank rows
3. If a column is missing, leave it as empty string ""
4. Keep descriptions exactly as written, but see QTY DISAMBIGUATION above — a trailing length+unit value belongs in "qty", not in "description"
5. Apply CRIMP/INSERTION TOOL ROWS above to every connector row with a pin_count — this step is easy to skip, double-check before returning your answer

Return ONLY a valid JSON array, no explanations.
Example: [{"item":"1","atlantium_pn":"EL0015700","part_number":"VN01 036 0005 1 C","drawing_number":"601-1201-021","drawing_name":"Main Assembly","description":"MALE CRIMPING CONTACT PIN (2.5), UL","qty":"3","unit":"pc","manufacturer":"AMPHENOL","pin_count":"4","price":""},{"item":"7","atlantium_pn":"","part_number":"2725-2828-BL-1000-T","drawing_number":"","drawing_name":"","description":"CABLE 4COND (1 Pair + 2) 28AWG BLK SHLD","qty":"230","unit":"mm","manufacturer":"CNC Tech","pin_count":"","price":""},{"item":"","atlantium_pn":"","part_number":"CT-2000","drawing_number":"601-1201-021","drawing_name":"Main Assembly","description":"CRIMP TOOL for VN01 series","qty":"1","unit":"pc","manufacturer":"AMPHENOL","pin_count":"","price":"85"}]
If no BOM is found, return: []

PDF TEXT (file: ${filename}):`;

// Vision prompt — matches Windows app extract_bom_from_page_image prompt
export const _BOM_VISION_PROMPT =
  `You are an expert at reading engineering Bill of Materials (BOM) tables from images.

Look at this PDF page image and extract ALL rows from the BOM / Assembly Parts List table.

FINDING THE RIGHT TABLE: this sheet may also show a title block, revision
record, or other non-BOM table — ignore those. The real BOM table is titled
something like "ASSEMBLY PARTS LIST", "PARTS LIST", or "BILL OF MATERIALS",
and its rows have REAL data in both an ITEM/# column AND a PART NUMBER/PN
column. If this page image does NOT contain that table (e.g. it's only a
title block or a blank/near-empty parts-list header with no actual rows
below it), return an empty array [] rather than extracting from the wrong
table or inventing rows.

For each row extract:
- "item": row/item number (1, 2, 3 ...)
- "part_number": the MANUFACTURER part number — the MANUFACTURER PART No. / MFR P/N column when there is one (see TWO PART-NUMBER COLUMNS), otherwise the PART NUMBER / PN / P/N column
- "drawing_number": drawing number (DWG NO, DRAWING NO)
- "drawing_name": drawing title or assembly name
- "atlantium_pn": the company's own / internal / customer part number (e.g. a "B.B PART No." column) when it is a separate column from the manufacturer part number, else empty
- "description": component description (DESCRIPTION / DESC column)
- "qty": quantity as a number string
- "unit": unit of measure — the ONLY valid values are: pc, mm, M, cm, ea, gm (grams — also written GR). If it's anything else, use empty string "" instead of guessing.
- "manufacturer": manufacturer name if shown, else empty string
- "pin_count": for connector parts only — the number of pins/positions/contacts, read from a POS/PINS/CONTACTS/WAY column if the drawing has one, or inferred from a count embedded in the part number/description of a known connector series. Empty string "" if the row isn't a connector or the count isn't known — do not guess.
- "price": normally leave this empty string "" (component pricing comes from FindChips/Priority separately, not from the drawing). The ONLY exception is a synthesized crimp-tool row — see rule 5 below.
TWO PART-NUMBER COLUMNS: many parts lists carry the company's OWN number for each
part AND the manufacturer's number, in two separate columns. Map them by what they ARE,
never by which one is called "PART No.":
- the column headed MANUFACTURER PART No. / MFR P/N / MFG P/N / MPN / VENDOR P/N
  → "part_number" (shown in the app as MNF P/N)
- the company's own column — often headed with the company's initials or name
  ("B.B PART No.", "<COMPANY> P/N"), or INTERNAL P/N, CAT. NO., ITEM CODE, CUST PN, or just
  "PART No." when a manufacturer column sits beside it — whose codes usually share one
  house pattern (EL-000787, CON-10652, SHR-12765)
  → "atlantium_pn" (shown in the app as Customer PN)
When a manufacturer-part-number column exists, the company's own number NEVER goes in
"part_number". Example, columns ITEM | B.B PART No. | DESCRIPTION | MANUFACTURER |
MANUFACTURER PART No. | U/M | QTY with the row 3 | EL-000787 | Wire 26 awg RED | WEICO |
2126/19-2 | CM | 200 →
{"item":"3","atlantium_pn":"EL-000787","part_number":"2126/19-2","description":"Wire 26 awg RED","manufacturer":"WEICO","unit":"cm","qty":"200"}
Only when the table has a single part-number column does that column go in "part_number".
THE SAME PART ON SEVERAL LINES: a parts list often gives one part more than one
item number, because it is fitted in more than one place. Output EVERY one of
those lines as its own row, in the order they appear, each keeping its own item
number and quantity. Do not merge them into one row and do not drop any of them
— merging and keeping the first line's quantity orders a fraction of what the
assembly needs.

QTY DISAMBIGUATION: for cable/wire rows, the QTY cell is very often a LENGTH
with its unit stuck directly to the number, e.g. "230mm", "2500mm", "1.5M" —
usually its own column, right before a trailing REF/LOCATION column (e.g. the
word "CABLE"). Read it as QTY, not description — never fold it into
"description", and never default qty to "1" just because it has a unit
attached; keep the unit as written (e.g. qty="230mm").

${_BOM_TOOL_RULE_SECTION}

RULES:
1. Extract EVERY data row — do NOT stop early or truncate the list
2. Skip header rows (ITEM, PART NUMBER, DESCRIPTION, QTY, UNIT) and blank rows
3. Read part numbers character by character — they are precise: do NOT guess or correct them
4. If a column is missing or empty for a row, use empty string "" — but see QTY DISAMBIGUATION above before deciding QTY is actually missing
5. Apply CRIMP/INSERTION TOOL ROWS above to every connector row with a pin_count — this step is easy to skip, double-check before returning your answer

Return ONLY a valid JSON array, no explanation.
Example: [{"item":"1","part_number":"M27500-20SC2S23","drawing_number":"","drawing_name":"","description":"CABLE 20AWG TWISTED PAIR","qty":"10000","unit":"mm","manufacturer":"","atlantium_pn":"","pin_count":"","price":""},{"item":"","part_number":"CT-2000","drawing_number":"","drawing_name":"","description":"CRIMP TOOL for VN01 series","qty":"1","unit":"pc","manufacturer":"AMPHENOL","atlantium_pn":"","pin_count":"","price":"85"}]
If no BOM is found, return: []`;

// sourceType: 'drawing' (default — PDF text or page image) or 'excel'
// (spreadsheet grid from extractExcelText, which needs its own prompt).
export async function aiExtractBOM(text, isImage, imgData, filename, sourceType='drawing'){
  // ms is written on both paths so the Statistics screen can average how long a
  // drawing takes to analyse — and so a run that failed after 60 seconds is
  // distinguishable from one that failed immediately for want of a key.
  const _t0=Date.now();
  try{
    if(!_aiReady()) throw new Error(_AI_NO_KEY);
    const rows=await _anthropicBOM(text, isImage, imgData, filename, sourceType);
    logSystemAudit('drawing_bom_search',{filename,provider:'anthropic',mode:sourceType==='excel'?'excel':(isImage?'vision':'text'),rowsFound:rows.length,ms:Date.now()-_t0},true);
    return rows;
  }catch(e){
    logSystemAudit('drawing_bom_search',{filename,error:e.message,ms:Date.now()-_t0},false);
    throw e;
  }
}
// Text-mode prompt for whichever kind of file this is. Spreadsheets get a much
// bigger slice (100k chars) than a drawing's text layer: an ERP BOM export can
// legitimately run to hundreds of rows, and truncating it silently drops parts.
export function _bomTextPromptFor(sourceType, filename){
  return sourceType==='excel' ? _BOM_EXCEL_PROMPT(filename) : _BOM_TEXT_PROMPT(filename);
}
export function _bomTextLimitFor(sourceType){ return sourceType==='excel' ? 100000 : 30000; }

export async function _anthropicBOM(text, isImage, imgData, filename, sourceType='drawing'){
  const messages = isImage ? [{role:'user',content:[
    {type:'image',source:{type:'base64',media_type:imgData.mimeType,data:imgData.b64}},
    {type:'text',text:_BOM_VISION_PROMPT}
  ]}] : [{role:'user', content: _bomTextPromptFor(sourceType,filename)+'\n'+text.slice(0,_bomTextLimitFor(sourceType))}];
  const resp = await _aiFetch({
    // A table read off a picture goes to the stronger model: small print in a
    // scanned or pasted parts list is exactly where the small one misreads a
    // digit or drops a row. Text needs no eyes and stays on the fast one.
    body:JSON.stringify({model:isImage?_csModel():'claude-haiku-4-5-20251001',
                         max_tokens:isImage?8192:4096, temperature:0, messages})
  });
  if(!resp.ok){let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json();m=e.error?.message||m;}catch{}
    if(isImage && _csModelRejected(resp.status,m)){ S._csModelDown=true; return _anthropicBOM(text, isImage, imgData, filename, sourceType); }
    throw new Error(m);}
  const data=await resp.json();
  return _parseAIJson(data.content[0].text.trim());
}
