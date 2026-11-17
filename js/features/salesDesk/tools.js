import { S } from '../../core/state.js';
import { _aiReady } from '../../ai/client.js';
import { aiFindCrimpTools } from '../../ai/tooling.js';
import { lookupPartPrices } from '../../data/pricing.js';
import { _bomKnownTools, _isCrimpContactRow } from '../../domain/bom.js';
import { _sdIsToolOwned, _sdIsToolRow, _sdRecalcRow, sdItems } from './salesDesk.js';

// ══════════════════════════════════════════════════════════════════════════════
// CRIMP TOOLS — for the CONTACTS (pins, sockets, terminals)
// ------------------------------------------------------------------------------
// Used after a drawing is read (the rows of the preview) and when parts are
// added from the Database (rows already on the Sales Desk). For each row:
//   • a MIL-DTL-38999 connector → the standard tooling table (_bomKnownTools);
//   • a crimp contact (_isCrimpContactRow):
//       1. a tool already in the Database for this contact (its "tool_for", or
//          the contact's number in the tool's description);
//       2. otherwise the AI looks it up in the contact maker's datasheet /
//          product page with web search (aiFindCrimpTools — one request for all).
// Every tool not priced in the Database is then priced at Mouser / DigiKey, so
// the row arrives with the tool's part number, price, and links.
// ══════════════════════════════════════════════════════════════════════════════
export const _SD_TOOL_SOURCE_LABEL={
  'db':'Existing tool in the Database',
  known:'Standard tooling table (MIL spec)',
  web:'Contact maker’s datasheet / web (AI) — verify',
  ai:'AI suggestion — verify before ordering',
  none:'Not found yet — check the contact maker’s tooling and type the tool P/N',
};
export function _sdToolSourceLabel(r){
  const base=_SD_TOOL_SOURCE_LABEL[r.tool_source]||_SD_TOOL_SOURCE_LABEL.ai;
  return r.tool_in_db && r.tool_source!=='db' ? base+' · already in the Database' : base;
}
const _key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Tools in the Database that belong to this contact (or connector).
export function _sdDbToolsFor(pn, parts){
  const k=_key(pn);
  if(k.length<4) return [];
  return (parts||[]).filter(p=>_sdIsToolRow(p) && _key(p.part_number)!==k && (
    _key(p.tool_for)===k || (k.length>=5 && _key(p.description).includes(k))));
}
function _dbPart(pn, parts){
  const k=String(pn||'').trim().toLowerCase();
  return k ? (parts||[]).find(p=>String(p.part_number||'').trim().toLowerCase()===k) : null;
}
// Mouser / DigiKey fields of a lookupPartPrices answer, as stored on a row.
export function _toolPriceFields(r){
  if(!r) return {};
  const f={};
  for(const [k,v] of [['mouser',r.mouser],['digikey',r.digikey]]){
    if(!v) continue;
    f[k+'_price']=v.price>0?v.price:'';
    f[k+'_stock']=String(parseInt(v.stock,10)||0);
    f[k+'_url']=String(v.url||'').slice(0,400);
    f[k+'_brk']=parseInt(v.breakQty,10)||0;
    f[k+'_match']=!(v.price>0)?'noprice':(v.exact?'exact':'approx');
    f[k+'_mpn']=v.mpn||'';
  }
  const mfr=(r.best&&r.best.manufacturer)||'';
  if(mfr) f._mfr=mfr;
  return f;
}
// Which tools each row needs. Returns {plan: Map(row → [{spec, source}]), stats}.
export async function _findToolsFor(rows, onStatus){
  const parts=S.allParts||[];
  const plan=new Map(), askAi=[];
  const stats={db:0, known:0, web:0, ai:0, none:0, contacts:0, aiError:'', notFound:[]};
  for(const r of rows){
    if(_sdIsToolRow(r) || !String(r.part_number||'').trim()) continue;
    const known=_bomKnownTools(r.part_number);
    if(known){
      if(!String(r.pin_count||'').trim() && known.pins) r.pin_count=String(known.pins);
      plan.set(r, known.tools.map(t=>({spec:t, source:'known'}))); continue;
    }
    if(!_isCrimpContactRow(r)) continue;
    stats.contacts++;
    const fromDb=_sdDbToolsFor(r.part_number, parts);
    if(fromDb.length){ plan.set(r, fromDb.map(p=>({spec:p, source:'db'}))); continue; }
    askAi.push(r);
  }
  if(askAi.length && _aiReady()){
    // One question per distinct contact; rows sharing a number share the answer.
    const uniq=[], idxOf=new Map();
    for(const r of askAi){ const k=_key(r.part_number); if(!idxOf.has(k)){ idxOf.set(k,uniq.length); uniq.push(r); } }
    if(onStatus) onStatus(`Looking up the crimp tool for ${uniq.length} contact(s) in the makers' datasheets…`);
    const res=await aiFindCrimpTools(uniq);
    if(res.error) stats.aiError=res.error;
    const src=res.web?'web':'ai';
    for(const r of askAi){
      const i=idxOf.get(_key(r.part_number));
      const found=res.tools.filter(t=>t.for_idx===i);
      if(found.length) plan.set(r, found.map(t=>({spec:t, source:src})));
    }
  }else if(askAi.length) stats.aiError='AI is not set up, so the crimp tools were not looked up';
  // A contact still needs a crimp tool even when none was found: it gets a
  // TOOL row without a part number, so the quote shows it and the user types
  // the tool's P/N into it.
  for(const r of askAi){
    if(plan.has(r)) continue;
    const pn=String(r.part_number).trim();
    if(!stats.notFound.includes(pn)) stats.notFound.push(pn);
    plan.set(r, [{spec:{part_number:'', manufacturer:'', source_url:'',
      description:`CRIMP TOOL for ${pn} — not identified yet, check the contact maker's tooling list`}, source:'none'}]);
  }
  // Prices: a tool the Database does not price is looked up at Mouser / DigiKey.
  const toPrice=new Map();
  for(const list of plan.values()) for(const x of list){
    const db=_dbPart(x.spec.part_number, parts);
    const priced=db && ((+db.mouser_price>0)||(+db.digikey_price>0)||(+db.priority_price>0));
    if(!priced && x.spec.part_number) toPrice.set(_key(x.spec.part_number), x.spec);
  }
  if(toPrice.size){
    if(onStatus) onStatus(`Checking the price of ${toPrice.size} tool(s) at Mouser / DigiKey…`);
    const got=new Map();
    for(const [k,spec] of toPrice){
      try{ got.set(k, _toolPriceFields(await lookupPartPrices(spec.part_number, 1, spec.description||''))); }
      catch(e){ console.warn('[tools] price', spec.part_number, e.message); }
    }
    for(const list of plan.values()) for(const x of list){
      const f=got.get(_key(x.spec.part_number));
      if(f) x.price=f;
    }
  }
  for(const list of plan.values()) for(const x of list) stats[x.source]++;
  return {plan, stats};
}
// The fields of one tool row (shared by the preview rows and Sales Desk rows).
function _toolFields(x, conn, parts){
  const db=_dbPart(x.spec.part_number, parts);
  const p=x.price||{};
  const out={
    part_number:x.spec.part_number||'',
    description:(db&&db.description)||x.spec.description||'TOOL',
    manufacturer:(db&&db.manufacturer)||x.spec.manufacturer||p._mfr||'',
    drawing_number:conn.drawing_number||'', drawing_name:conn.drawing_name||'', revision:conn.revision||'',
    atlantium_pn:'', customer_supplied:false, qty:1, unit:'pc',
    tool_for:conn.part_number||'', tool_source:x.source, tool_in_db:!!db, tool_url:x.spec.source_url||'',
    est_price: db ? (parseFloat(db.est_price)||0) : 0,
    priority_price: db ? (parseFloat(db.priority_price)||0) : 0,
    mouser_price: db&&+db.mouser_price>0 ? +db.mouser_price : (p.mouser_price||''),
    digikey_price: db&&+db.digikey_price>0 ? +db.digikey_price : (p.digikey_price||''),
  };
  for(const k of ['mouser_url','digikey_url','mouser_brk','digikey_brk','mouser_stock','digikey_stock','mouser_match','digikey_match','mouser_mpn','digikey_mpn'])
    out[k]=(db&&db[k])||p[k]||(k.endsWith('_brk')?0:'');
  if(!_sdIsToolRow(out)) out.description=`TOOL — ${out.description}`;
  return out;
}
// A Sales Desk tool row, for row `conn` (kept for the Database picker).
export function _sdToolItem(spec, conn, source, parts, price){
  const it={..._toolFields({spec, source, price}, conn, parts), total:0, labor_time:'', labor_total:0};
  _sdRecalcRow(it);
  return it;
}
// Inserts the planned tools under their rows in `list` (the preview rows, or
// sdItems), once per drawing. `make` builds the row object.
function _insertTools(list, plan, make){
  let added=0; const per={db:0, known:0, web:0, ai:0, none:0};
  for(const [conn, tools] of plan){
    let at=list.indexOf(conn);
    if(at<0) continue;
    const dwg=String(conn.drawing_number||'').trim();
    for(const x of tools){
      const pnk=String(x.spec.part_number||'').trim().toLowerCase();
      const forK=String(conn.part_number||'').trim().toLowerCase();
      // A tool is listed once per drawing; an unidentified one once per contact.
      const dup = pnk
        ? list.some(r=>_sdIsToolRow(r) && String(r.part_number||'').trim().toLowerCase()===pnk && String(r.drawing_number||'').trim()===dwg)
        : list.some(r=>_sdIsToolRow(r) && String(r.tool_for||'').trim().toLowerCase()===forK && String(r.drawing_number||'').trim()===dwg);
      if(dup) continue;
      list.splice(++at, 0, make(x, conn));
      added++; per[x.source]++;
    }
  }
  return {added, ...per};
}
// Drawing import: tool rows into the extracted rows, before the preview.
export async function _addToolsToRows(rows, onStatus){
  const parts=S.allParts||[];
  const {plan, stats}=await _findToolsFor(rows, onStatus);
  const r=_insertTools(rows, plan, (x,conn)=>({item:'', pin_count:'', price:'', ..._toolFields(x, conn, parts)}));
  return {...r, contacts:stats.contacts, aiError:stats.aiError, notFound:stats.notFound};
}
// One line for the user after a lookup: how many contacts got a tool, which did
// not, and why the web search did not run when it did not.
export function _toolLookupMessage(t){
  if(!t || !t.contacts) return '';
  const nf=t.notFound||[];
  let m=`Crimp tools: found for ${t.contacts-nf.length} of ${t.contacts} contact(s)`;
  if(nf.length) m+=` — not found for ${nf.join(', ')} (TOOL row added, type the tool P/N)`;
  if(t.aiError) m+=`. ${t.aiError}`;
  return m;
}
// Add from Database: tool rows into the Sales Desk under what was just added.
export async function _sdAddToolsFor(added, onStatus){
  const parts=S.allParts||[];
  const {plan, stats}=await _findToolsFor(added, onStatus);
  const r=_insertTools(sdItems, plan, (x,conn)=>_sdToolItem(x.spec, conn, x.source, parts, x.price));
  const owned=sdItems.filter(it=>_sdIsToolRow(it) && _sdIsToolOwned(it)).length;
  return {...r, owned, contacts:stats.contacts, aiError:stats.aiError, notFound:stats.notFound};
}
