import { S } from '../core/state.js';
import { _AI_NO_KEY, _aiFetch, _aiReady, _aiText, _csModel, _csModelRejected, _dbgLastAI, _jsonEnd, _parseAIJson } from './client.js';
import { logSystemAudit } from '../core/audit.js';
import { extractPDFPages } from '../io/pdf.js';

// Rows from overlapping bands, joined: a row seen at the bottom of one band and
// again at the top of the next is the same row once.
// Rows the reading seems to have missed: item numbers absent between 1 and
// the highest one read (items 4–7 read → 1, 2, 3 missing), and fewer rows than
// the locator counted. Lists numbered 10, 20, 30… are not "missing" anything.
export function _bomMissingRows(rows, expected=0){
  const parts=(rows||[]).filter(r=>!/\btool\b/i.test(String(r.description||'')));
  const items=[...new Set(parts.map(r=>parseInt(String(r.item??'').trim(),10)).filter(n=>n>0 && n<1000))];
  const max=items.length ? Math.max(...items) : 0;
  let gaps=[];
  for(let k=1;k<=max;k++) if(!items.includes(k)) gaps.push(k);
  if(gaps.length > max/2) gaps=[];          // a sparse numbering, not missed rows
  const short=expected>0 && parts.length<expected;
  return {gaps, short, missing: gaps.length>0 || short};
}
// Two readings of the same table, put together: every row of the first, plus
// the rows of the second it does not have (by item number, else by part
// number), in item order when the items are numbered.
export function _bomUnionRows(a, b){
  const key=r=>{ const it=parseInt(String(r?.item??'').trim(),10);
    return it>0 ? 'i'+it : 'p'+String(r?.part_number||'').trim().toUpperCase()+'|'+String(r?.description||'').trim().toUpperCase(); };
  const out=[...(a||[])], have=new Set(out.map(key));
  for(const r of (b||[])){ const k=key(r); if(!have.has(k)){ out.push(r); have.add(k); } }
  const num=r=>parseInt(String(r?.item??'').trim(),10);
  if(out.every(r=>num(r)>0)) out.sort((x,y)=>num(x)-num(y));
  return out;
}
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
where the box is the table's outline as FRACTIONS of the image (0 = left/top, 1 = right/bottom —
never pixels), including its header row and EVERY data row from the first item to the last, e.g. {"found":true,"box":[0.03,0.77,0.64,0.97],"rows":7}.
If there is no parts list on this sheet: {"found":false}`;
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
  return _bomParseLocate(_aiText(d));
}
export function _bomParseLocate(text){
  // The first {...} that parses and says "found" — prose or a second object
  // around it does not matter.
  const s=String(text||''); let o=null;
  for(let i=s.indexOf('{'); i>=0 && !o; i=s.indexOf('{', i+1)){
    const end=_jsonEnd(s, i);
    if(end<0) continue;
    try{ const v=JSON.parse(s.slice(i, end+1)); if(v && typeof v==='object' && 'found' in v) o=v; }catch{}
  }
  if(!o || o.found!==true || !Array.isArray(o.box) || o.box.length!==4) return null;
  const b=o.box.map(Number);
  if(b.some(v=>!Number.isFinite(v))) return null;
  // Some answers come back in percent rather than fractions. Anything larger
  // (pixels of an image size we cannot know) is not used: the whole sheet is
  // read instead.
  const box = b.some(v=>v>1.5) ? b.map(v=>v/100) : b;
  if(box.some(v=>v<-0.02 || v>1.02)) return null;
  if(!(box[2]>box[0] && box[3]>box[1])) return null;
  return {box, rows:Number(o.rows)||0};
}
// The whole PDF path of a BOM import, shared by both screens that import one.
// Returns the rows, the page they came from, and that page's image (the cable
// process analysis that follows looks at the same sheet).
export async function _bomFromPDF(file, setMsg){
  setMsg('Reading PDF pages…', 15);
  const {pageTexts, pageImages, pageLayouts=[], crop}=await extractPDFPages(file);
  const pdfText=pageTexts.map((t,i)=>`=== PAGE ${i+1} ===\n${t}`).join('\n\n');
  // What the AI reads in text mode: the column-preserving version (see
  // _pdfLayoutText) — the plain one mixes title-block text into table rows.
  const layoutText=(pageLayouts.length?pageLayouts:pageTexts).map((t,i)=>`=== PAGE ${i+1} ===\n${t}`).join('\n\n');
  const textLen=pageTexts.join('').trim().length;
  const bomPageIdx=_findBOMPageIndex(pageTexts);
  const bomPageSparse=bomPageIdx>=0 && (pageTexts[bomPageIdx]||'').trim().length<400;
  const hasHeader=_textHasBomHeader(pageTexts);
  let rows=[], page=-1, how='';
  // What each step did — shown to the user when no rows come out, and logged,
  // so a drawing that fails says why instead of just "no BOM rows".
  const diag=[]; let lastErr=null;
  const say=t=>{ diag.push(t); console.log('[BOM]', t); };
  const reply=()=>{ const r=String(_dbgLastAI||'').replace(/\s+/g,' ').trim(); return r ? ` — AI replied: "${r.slice(0,140)}${r.length>140?'…':''}"` : ''; };
  const read=async(label, ...args)=>{
    try{ const got=await aiExtractBOM(...args); if(!got.length) say(`${label}: 0 rows${reply()}`); return got; }
    catch(e){ lastErr=e; say(`${label}: AI error — ${e.message}`); return []; }
  };
  if(!(textLen>50 && hasHeader)) say(textLen>50 ? 'PDF text has no parts-list header (the table is drawn, not text) — reading the picture' : 'PDF has no text layer — reading the picture');

  // 1. The text layer, when it actually holds a parts list: exact and quick.
  let textRows=0;
  if(textLen>50 && hasHeader){
    setMsg('Sending text to AI…', 40);
    rows=await read('Text layer', layoutText, false, null, file.name);
    if(rows.length){ how='text'; page=bomPageIdx; }
    // Count the table's own rows in the text. If the AI returned fewer, it
    // missed some: read the table from the picture as well and keep the
    // reading with more rows.
    textRows=_bomLayoutRowCount(pageLayouts.length?pageLayouts:pageTexts);
  }
  const _partRows=list=>(list||[]).filter(r=>!/\btool\b/i.test(String(r.description||''))).length;
  const textShort = how==='text' && textRows>_partRows(rows);
  // 2. Otherwise the picture: find the table on the sheet, then read just that
  //    region rendered sharp. Pages with a parts-list heading go first.
  if((!rows.length || bomPageSparse || textShort) && _aiReady()){
    if(textShort) setMsg(`The text gave ${_partRows(rows)} of ${textRows} rows — reading the table from the drawing…`, 50);
    const order=pageImages.map((_,i)=>i);
    if(bomPageIdx>0){ order.splice(order.indexOf(bomPageIdx),1); order.unshift(bomPageIdx); }
    for(let k=0;k<order.length && (!rows.length || how!=='region');k++){
      const pi=order[k];
      if(!pageImages[pi]) continue;
      setMsg(`Looking for the parts list on page ${pi+1}/${pageImages.length}…`, 50+Math.round(30*k/order.length));
      let loc=null;
      try{ loc=await _bomLocate(pageImages[pi]); }catch(e){ lastErr=e; say(`Page ${pi+1}: locating the parts list failed — ${e.message}`); continue; }
      if(!loc){ say(`Page ${pi+1}: parts list not located${reply()}`); continue; }
      say(`Page ${pi+1}: parts list located at [${loc.box.map(v=>(+v).toFixed(2)).join(', ')}]`);
      setMsg(`Reading the parts list on page ${pi+1}…`, 60+Math.round(30*k/order.length));
      const bands=await crop(pi, loc.box);
      const lists=[];
      for(const b64 of bands) lists.push(await read(`Page ${pi+1} parts list`, '', true, {b64, mimeType:'image/jpeg'}, file.name));
      let got=_bomMergeBands(lists);
      // Rows missing (items 1–3 absent, or fewer than the locator counted): the
      // box was probably drawn too tight. Read again with a box grown up and
      // down, then — if still short — the whole sheet, and keep every row
      // any reading found.
      let miss=_bomMissingRows(got, loc.rows);
      if(got.length && miss.missing){
        say(`Page ${pi+1}: ${_partRows(got)} row(s) read${miss.gaps.length?`, items ${miss.gaps.join(', ')} missing`:''}${loc.rows?` (about ${loc.rows} expected)`:''} — reading a larger area`);
        setMsg(`Some rows were missed — reading a larger area of page ${pi+1}…`, 70);
        const [x0,y0,x1,y1]=loc.box;
        const wide=[Math.max(0,x0-0.04), Math.max(0,y0-0.15), Math.min(1,x1+0.04), Math.min(1,y1+0.08)];
        const lists2=[];
        for(const b64 of await crop(pi, wide)) lists2.push(await read(`Page ${pi+1} parts list (larger area)`, '', true, {b64, mimeType:'image/jpeg'}, file.name));
        got=_bomUnionRows(got, _bomMergeBands(lists2));
        miss=_bomMissingRows(got, loc.rows);
        if(miss.missing){
          setMsg(`Still short — reading the whole page ${pi+1}…`, 78);
          got=_bomUnionRows(got, await read(`Page ${pi+1} whole sheet (check)`, '', true, {b64:pageImages[pi], mimeType:'image/jpeg'}, file.name));
          miss=_bomMissingRows(got, loc.rows);
        }
        say(`Page ${pi+1}: ${_partRows(got)} row(s) after the second reading${miss.gaps.length?` — items ${miss.gaps.join(', ')} still missing`:''}`);
      }
      if(got.length && _partRows(got)>=_partRows(rows)){ rows=got; page=pi; how='region'; }
    }
    // 3. Nothing located: the whole sheet, as before.
    if(!rows.length){
      for(let k=0;k<order.length;k++){
        const pi=order[k];
        if(!pageImages[pi]) continue;
        setMsg(`Vision analysis: page ${pi+1}/${pageImages.length}…`, 85);
        const got=await read(`Page ${pi+1} whole sheet`, '', true, {b64:pageImages[pi], mimeType:'image/jpeg'}, file.name);
        if(got.length){ rows=got; page=pi; how='page'; break; }
      }
    }
  }
  // 4. Last resort for a text layer with no recognisable header: it may still
  //    be a table the header test did not catch.
  if(!rows.length && textLen>50 && !hasHeader){
    setMsg('Sending text to AI…', 90);
    rows=await read('Text layer (no header)', layoutText, false, null, file.name);
    if(rows.length) how='text';
  }
  if(!_aiReady()) say('AI is not set up');
  logSystemAudit('drawing_bom_pdf',{filename:file.name, how, page:page+1, rows:rows.length, text_header:hasHeader, text_rows:textRows,
    ...(rows.length?{}:{diag:diag.join(' | ').slice(0,1500)})}, rows.length>0);
  // Every AI call failed: that error is the answer, not "no rows".
  if(!rows.length && lastErr && diag.every(d=>/AI error|failed —|PDF (text|has)|AI is not set up/.test(d))) throw lastErr;
  const imgIdx = page>=0 ? page : (bomPageIdx>=0 ? bomPageIdx : 0);
  return {rows, diag, pageTexts, pageImages, pdfText, layoutText, textLen,
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
- "unit" → unit of measure — look for: UOM, UNIT, U/M. The ONLY valid values are "pc", "mm", "cm", "ea", "gm", "M", "ml" (millilitres — adhesives, sealants; also "L" for litres). Map "each"/"EA"→"pc" and "FT"/"FEET"→"" (leave empty — a foot isn't one of the valid units; the app converts lengths separately). Anything unrecognised → "".
- "item" → the row's sequence number if the sheet has one, else ""
- "drawing_number" / "drawing_name" → the top-level assembly part number / title if the report header states one (e.g. a "Part Number:" cell near the top), else ""
- "pin_count" → number of pins/positions/contacts for connector components, if stated or reliably inferable from the part number/description of a known connector series. Else "".
- "customer_supplied" → "yes" ONLY when the parts list marks this row as supplied/furnished by the customer (e.g. "CUSTOMER SUPPLIED", "SUPPLIED BY CUSTOMER", "CUSTOMER FURNISHED", "CFE", "CFM", "FBC", "GFE", or a "SUPPLIED BY: CUSTOMER" column). Otherwise "". Never guess.
- "price" → always "" here (spreadsheet BOM exports don't carry pricing; the app prices parts separately). 

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
  `NO TOOL ROWS: return only the rows that are in the parts list itself. Do NOT
add rows for crimp, insertion or extraction tools — the app finds the tools for
the crimp contacts (pins, sockets, terminals) in a separate step, from each
contact maker's datasheet. Never invent a row that the drawing does not show.`;

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
- "unit" → unit of measure — look for: UNIT, UOM, U/M — the ONLY valid values are: "pc", "mm", "cm", "ea", "gm" (grams — also written "GR"), "M" (meters), "ml" (millilitres — adhesives, sealants; "L" for litres). If the column shows anything else, leave "unit" as empty string "" rather than inventing or guessing a unit.
- "pin_count" → for connector parts only: the number of pins/positions/contacts (look for a POS, PINS, CONTACTS, WAY column, or a count embedded in the part number/description of a known connector series). Empty string "" if the row isn't a connector or the count isn't known — do not guess.
- "customer_supplied" → "yes" ONLY when the parts list marks this row as supplied/furnished by the customer (e.g. "CUSTOMER SUPPLIED", "SUPPLIED BY CUSTOMER", "CUSTOMER FURNISHED", "CFE", "CFM", "FBC", "GFE", or a "SUPPLIED BY: CUSTOMER" column). Otherwise "". Never guess.
- "price" → normally leave this empty string "" (component pricing comes from FindChips/Priority separately, not from the drawing). 
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
ONE PART-NUMBER COLUMN: when the parts list has just one part-number column (headed PART
NUMBER, PART NO., P/N or PN) and no separate manufacturer-part-number column, EVERY value in
it goes in "part_number" exactly as printed — whatever the codes look like (CABL-0053,
39012040, 39-00-0047) — and "atlantium_pn" stays "". Do not move that column to
"atlantium_pn", and do not replace a row's part number with another number that appears
inside its DESCRIPTION. Example, columns ITEM NO. | PART NUMBER | DESCRIPTION | QTY with the
row 2 | 39012040 | CONN 4 PIN MINI FIT JR | 1 →
{"item":"2","atlantium_pn":"","part_number":"39012040","description":"CONN 4 PIN MINI FIT JR","qty":"1"}
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
5. NO TOOL ROWS (above): only the rows the parts list shows

Return ONLY a valid JSON array, no explanations.
Example: [{"item":"1","atlantium_pn":"EL0015700","part_number":"VN01 036 0005 1 C","drawing_number":"601-1201-021","drawing_name":"Main Assembly","description":"MALE CRIMPING CONTACT PIN (2.5), UL","qty":"3","unit":"pc","manufacturer":"AMPHENOL","pin_count":"4","price":""},{"item":"7","atlantium_pn":"","part_number":"2725-2828-BL-1000-T","drawing_number":"","drawing_name":"","description":"CABLE 4COND (1 Pair + 2) 28AWG BLK SHLD","qty":"230","unit":"mm","manufacturer":"CNC Tech","pin_count":"","price":""}]
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
- "unit": unit of measure — the ONLY valid values are: pc, mm, M, cm, ea, gm (grams — also written GR), ml (millilitres — adhesives, sealants; L for litres). If it's anything else, use empty string "" instead of guessing.
- "manufacturer": manufacturer name if shown, else empty string
- "pin_count": for connector parts only — the number of pins/positions/contacts, read from a POS/PINS/CONTACTS/WAY column if the drawing has one, or inferred from a count embedded in the part number/description of a known connector series. Empty string "" if the row isn't a connector or the count isn't known — do not guess.
- "customer_supplied" → "yes" ONLY when the parts list marks this row as supplied/furnished by the customer (e.g. "CUSTOMER SUPPLIED", "SUPPLIED BY CUSTOMER", "CUSTOMER FURNISHED", "CFE", "CFM", "FBC", "GFE", or a "SUPPLIED BY: CUSTOMER" column). Otherwise "". Never guess.
- "price": normally leave this empty string "" (component pricing comes from FindChips/Priority separately, not from the drawing). 
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
ONE PART-NUMBER COLUMN: when the parts list has just one part-number column (headed PART
NUMBER, PART NO., P/N or PN) and no separate manufacturer-part-number column, EVERY value in
it goes in "part_number" exactly as printed — whatever the codes look like (CABL-0053,
39012040, 39-00-0047) — and "atlantium_pn" stays "". Do not move that column to
"atlantium_pn", and do not replace a row's part number with another number that appears
inside its DESCRIPTION. Example, columns ITEM NO. | PART NUMBER | DESCRIPTION | QTY with the
row 2 | 39012040 | CONN 4 PIN MINI FIT JR | 1 →
{"item":"2","atlantium_pn":"","part_number":"39012040","description":"CONN 4 PIN MINI FIT JR","qty":"1"}
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
5. NO TOOL ROWS (above): only the rows the parts list shows

Return ONLY a valid JSON array, no explanation.
Example: [{"item":"1","part_number":"M27500-20SC2S23","drawing_number":"","drawing_name":"","description":"CABLE 20AWG TWISTED PAIR","qty":"10000","unit":"mm","manufacturer":"","atlantium_pn":"","pin_count":"","price":""}]
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
export function _bomTextLimitFor(sourceType){ return sourceType==='excel' ? 100000 : 60000; }

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
  return _parseAIJson(_aiText(data).trim());
}


// ── Title block: drawing number, title and revision of the DRAWING itself ────
// The parts list says what the cable is made of; the title block says which
// drawing this is. Read separately so the BOM prompt stays as it is.
export const _TITLE_BLOCK_PROMPT=`You are reading the TITLE BLOCK of an engineering drawing (usually the box in the bottom-right corner of the sheet), and its REVISION table if it has one (often top-right, titled REVISIONS / REV / REVISION HISTORY / ECO).

Return ONLY this JSON object:
{"drawing_number":"","other_drawing_numbers":[],"title":"","revision":"","revisions":[]}

- "drawing_number": the number of THIS drawing — the field labelled DWG NO, DWG. NO., DRAWING NO, DRAWING NUMBER, DOC NO, DOCUMENT NO or similar (sometimes PART NO / P/N of the assembly) INSIDE THE TITLE BLOCK in the bottom-right corner, next to SIZE / REV / SCALE / SHEET. Copy it exactly. A drawing number can also be printed elsewhere — e.g. a small tab on the top border, which is sometimes left over from another drawing; when the numbers differ, the title block's one is "drawing_number" and the others go in "other_drawing_numbers".
- "other_drawing_numbers": every OTHER value found in a DWG NO / DRAWING NO field anywhere else on the sheet that differs from "drawing_number". [] when there is none.
- "title": the NAME of the drawing, from the title block: the field labelled TITLE, DWG TITLE, NAME — or, in many title blocks, DESCRIPTION: (e.g. "DESCRIPTION: UHF Power Cable" → "UHF Power Cable"). Copy it as written, on one line. It is never the drawing number, and never taken from the parts list's DESCRIPTION column or from the notes.
- "revision": the REV field of the title block — usually the box right after the DWG NO, sometimes without a label (e.g. "00", "01", "A"). Copy it exactly, leading zeros included.
- "revisions": the values in the REV column of the REVISION table (titled REVISION RECORD / REVISIONS / REV / REVISION HISTORY / ECO), only rows that actually have a value, in the order shown — e.g. ["00"], ["A","B","C"] or ["01","02"]. [] when there is no revision table.

NOT a revision: the drawing SIZE box (A, B, C, D, E — e.g. "SIZE B"), the CAGE CODE, the SHEET number ("SHEET 1 OF 3"), the zone letters and numbers printed around the border, and the SH box. Never put any of these in "revision" or "revisions".

Never take a number from the parts list / BOM table, from notes, or from a part's own drawing reference. Use "" for anything the drawing does not show — do not guess.`;
export function _parseTitleBlockJson(raw){
  const m=String(raw||'').match(/\{[\s\S]*\}/);
  if(!m) return null;
  try{
    const o=JSON.parse(m[0]);
    const str=v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
    return {drawing_number:str(o.drawing_number), title:str(o.title), revision:str(o.revision),
            revisions:Array.isArray(o.revisions)?o.revisions.map(str).filter(Boolean):[],
            other_drawing_numbers:Array.isArray(o.other_drawing_numbers)?o.other_drawing_numbers.map(str).filter(Boolean):[]};
  }catch{ return null; }
}
// {drawing_number,title,revision,revisions} or null (no key, failed, unreadable).
export async function aiReadTitleBlock(text, isImage, imgData){
  if(!_aiReady()) return null;
  const _t0=Date.now();
  try{
    // The picture shows which value sits in which box; the text layer, when the
    // PDF has one, gives the exact characters. Both are sent when both exist.
    const txt=String(text||'').trim() ? '\n\nDRAWING TEXT (the PDF text layer — exact characters, but not in reading order):\n'+String(text).slice(0,20000) : '';
    const messages = (isImage && imgData) ? [{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:imgData.mimeType,data:imgData.b64}},
      {type:'text',text:_TITLE_BLOCK_PROMPT+txt}]}]
      : [{role:'user', content:_TITLE_BLOCK_PROMPT+txt}];
    const resp=await _aiFetch({body:JSON.stringify({model:(isImage&&imgData)?_csModel():'claude-haiku-4-5-20251001',
      max_tokens:400, temperature:0, messages})});
    if(!resp.ok) throw new Error('Anthropic error '+resp.status);
    const data=await resp.json();
    const tb=_parseTitleBlockJson(_aiText(data));
    logSystemAudit('drawing_title_block',{found:!!(tb&&(tb.drawing_number||tb.title||tb.revision)),ms:Date.now()-_t0},true);
    return tb;
  }catch(e){
    console.warn('[BOM] title block:', e.message);
    logSystemAudit('drawing_title_block',{error:e.message,ms:Date.now()-_t0},false);
    return null;
  }
}


// How many rows the parts list has, counted from the column-preserving text:
// below a header line holding ITEM (or FIND NO) and PART NUMBER / P/N /
// DESCRIPTION, every line whose item column holds a number is a row. 0 when no
// such header is found. Used only to notice that a reading missed rows.
export function _bomLayoutRowCount(pages){
  let best=0;
  for(const page of (pages||[])){
    const lines=String(page||'').split('\n');
    for(let h=0;h<lines.length;h++){
      const L=lines[h];
      const m=L.match(/\b(ITEM(?:\s*NO\.?)?|FIND\s*NO\.?)\s/i);
      if(!m || !/(PART\s*(NUMBER|NO)|\bP\s*\/\s*N\b|\bPN\b|DESCRIPTION)/i.test(L)) continue;
      const col=m.index, seen=new Set();
      let miss=0;
      for(let k=h+1;k<lines.length && miss<8;k++){
        const cell=lines[k].slice(Math.max(0,col-3), col+m[1].length+3);
        const n=cell.match(/^\s*(\d{1,3})\s*$/) || cell.match(/(?:^|\s)(\d{1,3})(?=\s|$)/);
        if(n && lines[k].trim().length>n[1].length+2){ seen.add(n[1]); miss=0; }
        else miss++;
      }
      best=Math.max(best, seen.size);
    }
  }
  return best;
}
