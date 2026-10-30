import { _sdIsToolRow } from '../features/salesDesk/salesDesk.js';

// ── BOM row normalization ─────────────────────────────────────────────────────
// If drawing_number empty, fall back to drawing_name (per user requirement)
export function _normalizeBOMRows(rows){
  rows.forEach(r=>{
    if(!r.drawing_number && r.drawing_name) r.drawing_number=r.drawing_name;
  });
  // A crimp/insertion TOOL row is synthesized fresh by the AI for EVERY
  // connector row that needs one (see _BOM_TEXT_PROMPT/_BOM_VISION_PROMPT rule
  // 5) — so a drawing with two different connectors that both happen to take
  // the SAME hand tool (e.g. two MICROFIT 3.0 connectors both needing the same
  // extraction tool) correctly produces two synthesized rows sharing one part
  // number, from the AI's per-connector point of view. But a tool is a
  // durable, one-time purchase, not a consumable that scales with how many
  // connectors use it — so the BOM should only ever list it once. Collapse
  // repeated TOOL rows that share a part number down to their first
  // occurrence; rows with no part_number are left alone (no reliable key to
  // dedupe on, and removing the wrong one would silently drop a real tool).
  const seenToolPn = new Set();
  const deduped = rows.filter(r=>{
    if(!_sdIsToolRow(r)) return true;
    const pn=String(r.part_number||'').trim().toLowerCase();
    if(!pn) return true;
    if(seenToolPn.has(pn)) return false;
    seenToolPn.add(pn);
    return true;
  });
  rows.length=0;
  rows.push(...deduped);
  // Component rows are deliberately NOT merged by part number. A parts list that
  // names the same component on several lines is describing several places it is
  // fitted, each with its own item number and quantity, and the sheet shows them
  // as the file does. Only TOOL rows collapse (above), because a hand tool is a
  // one-time purchase rather than something that scales with the assembly.
  return rows;
}

// ── System-wide unit canonicalization ─────────────────────────────────────────
// The ENTIRE system (BOM/drawing extraction, RFQ, Sales Desk, Database, Priority
// import) only ever stores exactly 3 canonical units, always lowercase:
//   pc  — piece count
//   mm  — millimeters (the sole length unit)
//   gr  — grams (weight — treated like a length unit for LABOR/FC purposes)
// Any other unit that's recognized coming in gets folded into one of these
// three, rescaling QTY wherever the conversion actually changes the physical
// quantity (M/m and cm really do need their qty rescaled — EA/GM are pure
// relabels of the exact same count):
//   M / m / meter(s)      → mm   (× 1000 — 1 m = 1000 mm)
//   cm / centimeter(s)    → mm   (× 10   — 1 cm = 10 mm)
//   EA / ea               → pc   (relabel only — same count)
//   GR / gm / g / gram(s) → gr   (relabel only — already grams)
//   pc / mm / gr          → unchanged (already canonical)
//   anything else         → unit cleared to '' (never guessed)
// This runs once, at the point a row FIRST enters the system (BOM extraction),
// so qty is already correctly rescaled by the time it reaches the RFQ/BOM view,
// Sales Desk, or the Database — the Database's own qty=1 pin (see
// saveBOMToPartStock) happens independently and doesn't need to re-rescale.
export function _normalizeUnitQty(qty, rawUnit){
  const u=String(rawUnit||'').trim().toLowerCase();
  const n=parseFloat(qty);
  const hasNum=!isNaN(n);
  switch(u){
    case 'pc': case 'mm': case 'gr': return {qty, unit:u};
    case 'm': case 'meter': case 'meters':
      return {qty: hasNum ? n*1000 : qty, unit:'mm'};
    case 'cm': case 'centimeter': case 'centimeters':
      return {qty: hasNum ? n*10 : qty, unit:'mm'};
    case 'ea': case 'each': case 'pc.': case 'pcs': case 'piece': case 'pieces':
      return {qty, unit:'pc'};
    // Imperial length. Same fold as m/cm — one canonical length unit (mm), qty
    // rescaled so the number still describes the same physical length.
    case 'ft': case 'feet': case 'foot':
      return {qty: hasNum ? n*304.8 : qty, unit:'mm'};
    case 'in': case 'inch': case 'inches':
      return {qty: hasNum ? n*25.4 : qty, unit:'mm'};
    case 'gm': case 'g': case 'gram': case 'grams':
      return {qty, unit:'gr'};
    default: return {qty, unit:''};
  }
}
// AI BOM extraction sometimes returns a length/weight value as a single QTY
// string like "500mm", "2.5M" or "10cm" instead of a separate qty + unit —
// detect a unit suffix embedded directly in the QTY string first (it's the
// more authoritative signal, since it came from the same cell), then run
// whatever unit we ended up with (embedded or from the row's own "unit"
// field) through the canonical normalizer above.
export function _normalizeExtractedRow(r){
  let qty=r.qty, unit=r.unit;
  const raw=String(r.qty??'').trim();
  const m=raw.match(/^([\d.,]+)\s*([a-zA-Z]+)$/);
  if(m){ qty=parseFloat(m[1].replace(/,/g,''))||raw; unit=m[2]; }
  const norm=_normalizeUnitQty(qty, unit);
  r.qty=norm.qty; r.unit=norm.unit;
}
// Database-layer safety net: by the time a row reaches saveBOMToPartStock it
// should already be canonical (normalized at extraction time above), but this
// re-runs the same fold defensively for any path that might bypass it (manual
// entry, older cached rows, etc). Qty is ignored here since the Database always
// pins qty to 1 regardless (see saveBOMToPartStock) — only the unit label matters.
export function _dbNormalizeUnit(rawUnit){
  return _normalizeUnitQty(1, rawUnit).unit;
}
// Reads every sheet into a plain pipe-delimited text grid (row number prefixed)
// and hands it to the AI the same way PDF page text is handled. Deliberately NOT
// a hard-coded parser for one customer's export layout: column names, sheet
// order and row hierarchy vary per customer, and the AI already knows how to
// find a BOM table — this just gets the cells in front of it losslessly.
// Blank rows/columns are dropped so the payload stays small.
// When on, sub-assembly / internal-document rows (SpecTdp, DocumentTdp and
// their Revisions) are imported alongside the real purchasable components.
// Off by default: those rows have no manufacturer and no price, so they'd only
// add noise to a quote — but some assemblies legitimately need them listed.
// Every row from the sheet is now imported, always. The old checkbox made the
// user decide up-front whether sub-assembly/document rows mattered — a question
// they couldn't answer before seeing the parts. Importing everything and letting
// the cheapest-QVL-alternative logic price it is both simpler and safer: a row
// that turns out to be irrelevant can be deleted in the review step, whereas a
// row that was never imported is invisible.
export const _xlsIncludeSubAssemblies=true;

// Column-name aliases for the deterministic spreadsheet parser below. Matched
// case-insensitively against the detected header row.
// Every ERP spells its headers differently — "MFG P/N" vs "MFG PN", "U/M" vs
// "UM", "NO." vs "NO". Squash the sheet's header cell AND the alias entry down
// to letters+digits before comparing, so one alias covers every punctuation
// variant instead of needing a row per spelling. "#" squashes to nothing, so
// it keeps its raw form rather than matching everything.
export function _xlsSquash(s){
  const t=String(s??'').trim().toLowerCase();
  const sq=t.replace(/[^a-z0-9\u0590-\u05FF]+/g,'');
  return sq||t;
}
export const _XLS_COL_ALIASES={
  internal_pn : ['part num','part number','partnumber','part no','item id','catalog','catalog no','internal pn','cust pn','customer pn','מק"ט','מקט'],
  name        : ['name','title','part name'],
  description : ['description','desc','long description','item description','part description',
                 'component description','material description','item desc','long desc','תיאור','תאור'],
  uom         : ['uom','unit','units','u/m','unit of measure','ea/ft','factory unit',"יח'"],
  type        : ['type','row type','record type','level type'],
  mfpn        : ['mfpn','mpn','mfg pn','mfr pn','manufacturer pn','manufacturer part number','vendor pn','nfpn',
                 // "Mnf. Part No." and friends — the same column, spelled a dozen ways.
                 'mnf part no','mnf pn','mnf part number','manufacturer part no','mfg part number','mfg part no',
                 'mfr part number','mfr part no','supplier part number','vendor part no','maker pn'],
  vendor      : ['vendor','manufacturer','mfg','supplier','maker','mfg name','mfr name','manufacturer name','vendor name','supplier name','יצרן','ספק'],
  qty         : ['qty','quantity',"no. req'd",'no req','amount','usage','required','כמות'],
  item        : ['item','item no','seq','#','no.','line','baloon no','balloon no','balloon number',
                 'bubble no','find no'],
  status      : ['nfpn status','status','approval','approval status'],
  // The top-level assembly number, repeated on every row (Applied Materials
  // PDM exports label this column "HLA"). Used as the Drawing # when the
  // banner above the header doesn't carry one.
  assembly    : ['hla','assembly','assy','top level','top level part','parent assembly','parent part'],
};
// A customer-prefixed part-number column — "AMAT P/N", "ACME P/N" — is the
// CUSTOMER's internal number, not the manufacturer's. Matched by shape so the
// next customer's export doesn't need its own alias entry, but never for the
// manufacturer-side spellings, which mean the opposite thing.
export const _XLS_INTERNAL_PN_SHAPE=/^([a-z]{1,8})(pn|partno|partnum|partnumber)$/;
// "B.B PART No." squashes to "bbpartno": a company's initials in front of a
// part-number column. The manufacturer's own spellings ("Mfg Part No",
// "Vendor PN") look the same shape and mean the opposite, so their prefixes
// are excluded by name.
export const _XLS_MFG_PREFIXES=['mfg','mfr','mnf','mf','manufacturer','vendor','supplier','maker','nf','m'];
export function _xlsIsInternalPnHeader(c){
  const m=_XLS_INTERNAL_PN_SHAPE.exec(String(c||''));
  if(!m) return false;
  if(_XLS_MFG_PN_SQUASHED.includes(c)) return false;
  return !_XLS_MFG_PREFIXES.includes(m[1]);
}
export const _XLS_MFG_PN_SQUASHED=['mfgpn','mfrpn','mpn','mfpn','nfpn','vendorpn','manufacturerpn'];
// Row-TYPE semantics in hierarchical ERP/PLM exports (ELBIT "BOM QVL Report"
// and friends). Classified with ANCHORED patterns on purpose: a loose
// substring test is actively dangerous here — "StdPart" happens to contain the
// letters "tdp", so a /tdp/ test silently swallows every real component.
// Returns: 'vendor' | 'subassembly' | 'component'.
export function _xlsClassifyType(rawType){
  // "<Type> Revision" rows restate an existing row — same class, handled as a
  // duplicate by the caller — so strip the suffix before classifying.
  const t=String(rawType||'').trim().toLowerCase().replace(/\s+revision$/,'').trim();
  if(!t) return 'component';                                          // no type column at all
  if(/^(qvl|avl)$|qualified\s*vendor|approved\s*vendor/.test(t)) return 'vendor';
  if(/^std\s*part$|^part$|^component$|^item$/.test(t)) return 'component';
  if(/tdp$|^document|^spec\b|^assembly$|^drawing$|^phantom$/.test(t)) return 'subassembly';
  return 'component';
}
export const _XLS_TYPE_REVISION=/\srevision$/i;

// Pulls the top-level assembly / drawing number out of the report BANNER — the
// rows ABOVE the column header, where ERP exports print things like
// "Part Number: | 20583410900". Handles both layouts: the label and value in
// separate cells, and both crammed into one cell ("Part Number: 20583410900").
// This becomes the Drawing # on every extracted row, which is far more useful
// than the filename fallback (these files are often exported with an opaque
// machine-generated name).
export const _XLS_BANNER_PN_LABEL=/^(part\s*(number|num|no\.?)|assembly\s*(number|no\.?)?|assy|top\s*level|drawing\s*(number|no\.?|#)|dwg\s*(no\.?|#)?)\s*:?\s*$/i;
export const _XLS_BANNER_PN_INLINE=/^(?:part\s*(?:number|num|no\.?)|assembly(?:\s*(?:number|no\.?))?|assy|drawing\s*(?:number|no\.?|#)|dwg\s*(?:no\.?|#)?)\s*[:\-]\s*(.+)$/i;
export function _xlsFindReportPartNumber(rows, hdrIdx){
  for(let i=0;i<hdrIdx;i++){
    const row=rows[i]||[];
    for(let c=0;c<row.length;c++){
      const v=String(row[c]??'').trim();
      if(!v) continue;
      // "Part Number: 20583410900" all in one cell
      const inline=v.match(_XLS_BANNER_PN_INLINE);
      if(inline && inline[1].trim()) return inline[1].trim();
      // "Part Number:" in this cell, value in the next non-empty one
      if(_XLS_BANNER_PN_LABEL.test(v)){
        for(let k=c+1;k<row.length;k++){
          const nv=String(row[k]??'').trim();
          if(nv) return nv;
        }
      }
    }
  }
  return '';
}

// Deterministic BOM extraction from a spreadsheet grid.
// Why not just ask the AI: these exports are a mechanical transformation —
// find the header, fold vendor child rows into their parent, drop the row
// types that aren't real parts, dedupe. An LLM does that inconsistently on a
// long sheet (it returned 8 rows for a file with 5 unique components), while
// the rules themselves are exact. The AI is kept only as a fallback for files
// with no recognisable header row (see handleFiles/handleSDFiles).
// Returns null when the sheet doesn't look like a structured BOM at all.
// Finds the header row and works out which column plays which role. Returns
// EVERY column that matched a role, not only the first: a sheet with two
// "Part Description" columns (the assembly's and the component's) or two
// "Factory Unit" columns is genuinely ambiguous, and choosing silently is how
// the wrong description — or the wrong quantity basis — ends up in a quote.
// The caller decides whether to run with the first-match guess or ask.
export function _xlsFindHeaderRow(rows){
  for(let i=0;i<Math.min(30,rows.length);i++){
    const cells=(rows[i]||[]).map(_xlsSquash);
    const candidates={};
    cells.forEach((c,ci)=>{
      if(!c) return;
      for(const key in _XLS_COL_ALIASES){
        if(_XLS_COL_ALIASES[key].some(a=>_xlsSquash(a)===c)) (candidates[key]=candidates[key]||[]).push(ci);
      }
    });
    if(candidates.internal_pn===undefined){
      const ci=cells.findIndex(c=>c && _xlsIsInternalPnHeader(c));
      if(ci>=0) candidates.internal_pn=[ci];
    }
    const keys=Object.keys(candidates);
    if(keys.length>=2 && (candidates.internal_pn||candidates.mfpn||candidates.description||candidates.name)){
      const colMap={};
      keys.forEach(k=>{ colMap[k]=candidates[k][0]; });
      return {hdrIdx:i, candidates, colMap};
    }
  }
  return null;
}

// Some exports write ONE ROW PER APPROVED MANUFACTURER: the same component
// repeats, differing only in Manufacturer / Mnf. Part No. Read literally that
// is three parts with three quantities, and the quote comes out multiplied.
// It is the same QVL relationship the hierarchical exports express with child
// rows, so fold it the same way — one line, every manufacturer in alt_mpns.
export function _xlsMergeRepeatedRows(out){
  const merged=[], byKey=new Map();
  for(const r of out){
    const key=String(r.atlantium_pn||r.description||'').trim().toLowerCase();
    if(!key){ merged.push(r); continue; }
    const first=byKey.get(key);
    if(!first){ byKey.set(key,r); merged.push(r); continue; }
    const mpn=String(r.part_number||'').trim();
    if(mpn && !(first.alt_mpns||[]).some(a=>String(a.mpn||'').toLowerCase()===mpn.toLowerCase())){
      first.alt_mpns=first.alt_mpns||[];
      first.alt_mpns.push({mpn, manufacturer:r.manufacturer||''});
    }
    if(!first.part_number && mpn){ first.part_number=mpn; first.manufacturer=r.manufacturer||''; }
  }
  return merged;
}
// How many rows would disappear if the repeats above were folded together.
export function _xlsCountRepeatedRows(out){
  const seen=new Set(); let repeats=0;
  for(const r of out){
    const key=String(r.atlantium_pn||r.description||'').trim().toLowerCase();
    if(!key) continue;
    if(seen.has(key)) repeats++; else seen.add(key);
  }
  return repeats;
}

export function _parseStructuredBOMSheet(rows, opts={}){
  // A confirmed mapping from the column dialog wins over the auto-guess.
  const found = (opts.colMap && opts.hdrIdx!=null)
    ? {hdrIdx:opts.hdrIdx, colMap:opts.colMap}
    : _xlsFindHeaderRow(rows);
  if(!found) return null;
  const hdrIdx=found.hdrIdx, colMap=found.colMap;

  // Top-level assembly number from the banner above the header — stamped onto
  // every row as its Drawing #.
  let reportPN=_xlsFindReportPartNumber(rows, hdrIdx);
  // No banner number? Fall back to an assembly-number column that repeats the
  // top-level number on every row. It's the sheet's own answer, and better
  // than the file name the caller falls back to otherwise.
  if(!reportPN && colMap.assembly!==undefined){
    for(let i=hdrIdx+1;i<rows.length;i++){
      const v=String((rows[i]||[])[colMap.assembly]??'').trim();
      if(v){ reportPN=v; break; }
    }
  }
  const cell=(row,key)=>colMap[key]===undefined?'':String(row[colMap[key]]??'').trim();
  const out=[];          // one entry per component line, in sheet order
  let current=null;      // last emitted component, for attaching its vendor rows

  for(let i=hdrIdx+1;i<rows.length;i++){
    const row=rows[i]||[];
    if(!row.some(c=>String(c??'').trim())) continue;
    const type=cell(row,'type');
    const pn=cell(row,'internal_pn');
    const nm=cell(row,'name');
    const desc=cell(row,'description');
    const kind=_xlsClassifyType(type);

    // ── Vendor / QVL child row: not its own BOM line. Supplies a manufacturer
    //    PN + name for the component above it.
    //
    //    A QVL (Qualified Vendor List) deliberately names SEVERAL approved
    //    manufacturers for one customer part — they are interchangeable by the
    //    customer's own engineering approval, so the right one to buy is simply
    //    the cheapest available. We therefore collect them ALL into alt_mpns
    //    instead of taking the first and discarding the rest; Check Price prices
    //    every alternative and keeps the cheapest (see checkOne).
    //
    //    MNF P/N takes the MFPN (a real manufacturer number like
    //    "GRM426X7R103K50") rather than the customer's internal catalog number
    //    — that's the value a distributor can actually price. The internal
    //    number stays in Customer PN. See the no-vendor-row fallback below for
    //    the case where a component has no MFPN at all.
    if(kind==='vendor'){
      if(current){
        const mfpn=cell(row,'mfpn');
        if(mfpn){
          current.alt_mpns = current.alt_mpns || [];
          // Some exports restate the same approved part on several lines.
          if(!current.alt_mpns.some(a=>a.mpn.toLowerCase()===mfpn.toLowerCase())){
            current.alt_mpns.push({mpn:mfpn, manufacturer:cell(row,'vendor')});
          }
          // First one is the provisional pick, so the row is usable before any
          // price check has run.
          if(!current.part_number){
            current.part_number = mfpn;
            current.manufacturer = cell(row,'vendor');
          }
        }
      }
      continue;
    }
    // ── Sub-assembly / internal document row.
    const isSub = kind==='subassembly';
    if(isSub && !_xlsIncludeSubAssemblies){ current=null; continue; }
    // A "... Revision" row is a historical restatement of the row it belongs
    // to — never a separate part. Skip, but keep `current` so any vendor rows
    // that follow still attach to the right component.
    if(_XLS_TYPE_REVISION.test(type)) continue;
    // Must carry some identity to be a real row.
    if(!pn && !nm && !desc) continue;

    // Every line of the source file becomes its own row, repeats included.
    // Previously a repeated component was dropped outright, so the sheet showed
    // one line carrying only the FIRST occurrence's quantity — three connectors
    // ordered as one. Keeping the lines is the faithful reading: each carries
    // its own item number and quantity, and the totals downstream add up because
    // they sum rows rather than trusting one merged figure.
    const rec={
      item:cell(row,'item'),
      atlantium_pn:pn,
      // A FLAT export carries MFG P/N and MFG NAME as columns on the component
      // row itself, with no QVL child row underneath — reading them only from
      // QVL rows left every line unpriceable on those files. A hierarchical
      // export leaves both cells blank here and still fills them from the QVL
      // rows below, exactly as before.
      part_number:cell(row,'mfpn'),
      manufacturer:cell(row,'vendor'),
      // Prefer the longer of Name / Description — exports often truncate one.
      description:(desc.length>nm.length?desc:nm)||nm||desc,
      qty:cell(row,'qty')||'1',          // these exports frequently have no qty column
      unit:cell(row,'uom'),
      // Drawing # comes from the report banner; Dwg Name is deliberately left
      // empty so the caller fills it from the FILE NAME (same as PDF imports).
      drawing_number:reportPN, drawing_name:'',
      pin_count:'', price:'',
      // Every approved manufacturer PN (QVL). The row's OWN MPN is seeded here
      // too when it has one, because the "fewer than two means no real choice"
      // test at the bottom counts this list — leaving the row's own number out
      // would make one row + one approved alternative look like no choice.
      alt_mpns: cell(row,'mfpn') ? [{mpn:cell(row,'mfpn'), manufacturer:cell(row,'vendor')}] : [],
      _isSubAssembly:!!isSub,
    };
    out.push(rec); current=rec;
  }
  const finalRows = opts.mergeDuplicates ? _xlsMergeRepeatedRows(out) : out;
  // Fallback for components the export lists with NO vendor/QVL row at all:
  // rather than leave MNF P/N blank, fall back to the sheet's own part number.
  // It's the only identifier such a row has, and a blank MNF P/N would make the
  // line unpriceable AND unsearchable. Customer PN is cleared in that case so
  // the same value isn't shown twice in two different columns.
  for(const r of finalRows){
    if(!r.part_number && r.atlantium_pn){
      r.part_number = r.atlantium_pn;
      r.atlantium_pn = '';
    }
    // A single alternative is not a choice — drop the list so downstream code
    // only ever sees alt_mpns when there's genuinely something to compare.
    if((r.alt_mpns||[]).length<2) r.alt_mpns=[];
    delete r._hasVendorRow;
  }
  return finalRows.length?finalRows:null;
}
export function _xlsMapSignature(headers){
  return (headers||[]).map(_xlsSquash).join('|').slice(0,300);
}

// The roles a person can actually reason about, in the order they appear in the
// BOM table. Everything else the auto-guess found (row type, status) is carried
// through untouched — those are structural, not judgement calls.
export const _XLS_MAP_FIELDS=[
  {key:'mfpn',        label:'MNF P/N — manufacturer part number', required:true},
  {key:'internal_pn', label:'Customer PN'},
  {key:'description', label:'Description'},
  {key:'vendor',      label:'Manufacturer'},
  {key:'qty',         label:'QTY'},
  {key:'uom',         label:'Units'},
  {key:'item',        label:'Item'},
  {key:'assembly',    label:'Drawing # (assembly number)'},
];

// Everything the column-mapping dialog needs to describe a sheet to a human:
// the header row, one real sample value per column, which roles matched more
// than one column, and how many rows are repeats. needsConfirmation is the
// single question the import flow asks — "can I run this without checking?".
export function _xlsAnalyzeSheet(rows){
  const found=_xlsFindHeaderRow(rows);
  if(!found) return null;
  const headers=(rows[found.hdrIdx]||[]).map(h=>String(h??'').trim());
  const sample=headers.map((_,c)=>{
    for(let i=found.hdrIdx+1;i<Math.min(found.hdrIdx+9,rows.length);i++){
      const v=String((rows[i]||[])[c]??'').trim();
      if(v) return v;
    }
    return '';
  });
  const guessed=_parseStructuredBOMSheet(rows,{hdrIdx:found.hdrIdx,colMap:found.colMap})||[];
  const repeats=_xlsCountRepeatedRows(guessed);
  const ambiguous=Object.keys(found.candidates).filter(k=>found.candidates[k].length>1);
  return {
    hdrIdx:found.hdrIdx, colMap:found.colMap, candidates:found.candidates,
    headers, sample, rowCount:guessed.length, repeats, ambiguous,
    // Ask when the manufacturer part number wasn't found at all (the number
    // everything downstream prices on), when a role matched several columns,
    // or when repeated rows mean a quantity decision has to be made.
    needsConfirmation: found.candidates.mfpn===undefined || ambiguous.length>0 || repeats>0,
  };
}

export function parseExcelSheetsStructured(sheets, opts={}){
  for(const s of sheets){
    const rows=_parseStructuredBOMSheet(s.rows, opts.sheetName && s.name!==opts.sheetName ? {} : opts);
    if(rows && rows.length) return rows;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PRIORITY IMPORT — Excel (part_number + price) → Part Stock priority_price ─
// ══════════════════════════════════════════════════════════════════════════════
export const _PN_HEADER_HINTS=['part number','part_number','partnumber','pn','p/n','מק"ט','מקט','catalog','item number','item no','cat no','cat#'];
export const _PRICE_HEADER_HINTS=['price','unit price','מחיר','cost','rate'];
export const _CURRENCY_HEADER_HINTS=['currency','curr','מטבע'];
export const _UNIT_HEADER_HINTS=['unit','units','uom','u/m','יחידה','יחידות',"יח'",'יח'];
export const _DESC_HEADER_HINTS=['description','desc','product description','part description','name','item name','תיאור','תאור','שם פריט','שם מוצר'];

// Priority ERP exports label their units column ("יח'") with these Hebrew/
// English tokens rather than pc/mm/gr directly — map them to our 3 canonical
// units. This is a straight label mapping (not a qty rescale): Priority
// import rows carry a per-part unit-of-measure label, not a quantity value.
//   יח' / יח / K / טר  → pc
//   מטר (meter)        → mm
//   רגל (foot)         → mm
//   מל                 → gr
// Anything else falls back to the general system-wide canonical fold (covers
// the case where Priority already exported pc/mm/gr/M/EA/cm/etc. directly).
export function _priorityMapUnit(raw){
  const s=String(raw||'').trim();
  if(!s) return '';
  if(s==="יח'"||s==='יח'||s.toLowerCase()==='k'||s==='טר') return 'pc';
  if(s==='מטר') return 'mm';
  if(s==='רגל') return 'mm';
  if(s==='מל') return 'gr';
  return _normalizeUnitQty(1, s).unit;
}

export function _priorityFindCol(headers, hints){
  const norm=headers.map(h=>String(h||'').trim().toLowerCase());
  for(const hint of hints){
    const idx=norm.findIndex(h=>h===hint);
    if(idx>=0) return idx;
  }
  for(const hint of hints){
    const idx=norm.findIndex(h=>h.includes(hint));
    if(idx>=0) return idx;
  }
  return -1;
}
// Higher score = more likely to be the real Part Number / Price data table, as opposed to
// e.g. a PivotTable summary sheet (common in Priority ERP exports) that only has a single
// "Row Labels" column and none of our real data.
export function _priorityScoreSheet(headers){
  let score=0;
  if(_priorityFindCol(headers,_PN_HEADER_HINTS)>=0) score+=10;
  if(_priorityFindCol(headers,_PRICE_HEADER_HINTS)>=0) score+=10;
  if(_priorityFindCol(headers,_CURRENCY_HEADER_HINTS)>=0) score+=2;
  score += Math.min(headers.length,20)*0.1;
  return score;
}

// ══════════════════════════════════════════════════════════════════════════════
// TOOLS CATALOG IMPORT — Excel (part_number + description) → Database ────────
// Reuses _priorityParseSheet/_priorityFindCol (both generic despite the name)
// with PN + Description column hints, mirroring the Priority Import flow's
// structure (drop zone → sheet/column mapping → editable preview → save).
// ══════════════════════════════════════════════════════════════════════════════
export function _toolsScoreSheet(headers){
  let score=0;
  if(_priorityFindCol(headers,_PN_HEADER_HINTS)>=0) score+=10;
  if(_priorityFindCol(headers,_DESC_HEADER_HINTS)>=0) score+=10;
  score += Math.min(headers.length,20)*0.1;
  return score;
}
