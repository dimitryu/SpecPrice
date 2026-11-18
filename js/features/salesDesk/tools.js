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
  manual:'Typed in by you — Save to Database and it is used for this contact next time',
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
  for(const [k,v] of [['mouser',r.mouser],['digikey',r.digikey],['onlinecomp',r.onlinecomp]]){
    if(!v) continue;
    f[k+'_price']=v.price>0?v.price:'';
    f[k+'_stock']=String(parseInt(v.stock,10)||0);
    f[k+'_url']=String(v.url||'').slice(0,400);
    f[k+'_brk']=parseInt(v.breakQty,10)||0;
    f[k+'_match']=!(v.price>0)?'noprice':(v.exact?'exact':'approx');
    f[k+'_mpn']=v.mpn||'';
    if(k==='onlinecomp') f.onlinecomp_uom=v.uom||'';
  }
  const mfr=(r.best&&r.best.manufacturer)||'';
  if(mfr) f._mfr=mfr;
  return f;
}
// What the lookup did, in one line kept on the tool row — so it can be seen
// later whether the web was searched, for what, and which pages were opened.
export function _toolSearchNote(res){
  if(!res) return '';
  if(!res.web) return res.error || 'Answered from the AI\u2019s knowledge (no web search)';
  const host=u=>{ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; } };
  const q=(res.searches||[]).slice(0,4).map(s=>`"${s}"`).join(', ');
  const o=[...new Set((res.opened||[]).map(host).filter(Boolean))].slice(0,4).join(', ');
  return `Web: ${(res.searches||[]).length} search(es)${q?` — ${q}`:''}${o?` · opened ${(res.opened||[]).length} page(s): ${o}`:' · no page opened'}`;
}
// Which tools each row needs. Returns {plan: Map(row → [{spec, source}]), stats}.
export async function _findToolsFor(rows, onStatus){
  const parts=S.allParts||[];
  const plan=new Map(), askAi=[];
  const stats={db:0, known:0, web:0, ai:0, none:0, contacts:0, aiError:'', notFound:[], searches:[], opened:[]};
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
    stats.searches=res.searches||[]; stats.opened=res.opened||[];
    const note=_toolSearchNote(res), pages=(res.opened||[]).filter(u=>/^https:\/\//i.test(u)).slice(0,3);
    for(const r of askAi){
      const i=idxOf.get(_key(r.part_number));
      const found=res.tools.filter(t=>t.for_idx===i);
      // From the web only when a page states it; a "likely" answer is the AI's.
      if(found.length) plan.set(r, found.map(t=>({spec:t, source:res.web && t.confidence!=='likely' ? 'web' : 'ai', note, pages})));
      else r._toolNote={note, pages};
    }
  }else if(askAi.length){
    stats.aiError='AI is not set up, so the crimp tools were not looked up';
    for(const r of askAi) r._toolNote={note:stats.aiError, pages:[]};
  }
  // A contact still needs a crimp tool even when none was found: it gets a
  // TOOL row without a part number, so the quote shows it and the user types
  // the tool's P/N into it.
  for(const r of askAi){
    if(plan.has(r)) continue;
    const pn=String(r.part_number).trim();
    if(!stats.notFound.includes(pn)) stats.notFound.push(pn);
    const tn=r._toolNote||{note:'', pages:[]}; delete r._toolNote;
    plan.set(r, [{spec:{part_number:'', manufacturer:'', source_url:'',
      description:`CRIMP TOOL for ${pn} — not identified yet, check the contact maker's tooling list`}, source:'none', note:tn.note, pages:tn.pages}]);
  }
  // Prices: a tool the Database does not price is looked up at Mouser / DigiKey.
  const toPrice=new Map();
  for(const list of plan.values()) for(const x of list){
    const db=_dbPart(x.spec.part_number, parts);
    const priced=db && ((+db.mouser_price>0)||(+db.digikey_price>0)||(+db.onlinecomp_price>0)||(+db.priority_price>0));
    if(!priced && x.spec.part_number) toPrice.set(_key(x.spec.part_number), x.spec);
  }
  if(toPrice.size){
    if(onStatus) onStatus(`Checking the price of ${toPrice.size} tool(s) at the distributors…`);
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
    tool_note:x.note||'', tool_pages:Array.isArray(x.pages)?x.pages:[],
    est_price: db ? (parseFloat(db.est_price)||0) : 0,
    priority_price: db ? (parseFloat(db.priority_price)||0) : 0,
    mouser_price: db&&+db.mouser_price>0 ? +db.mouser_price : (p.mouser_price||''),
    digikey_price: db&&+db.digikey_price>0 ? +db.digikey_price : (p.digikey_price||''),
    onlinecomp_price: db&&+db.onlinecomp_price>0 ? +db.onlinecomp_price : (p.onlinecomp_price||''),
  };
  for(const k of ['mouser_url','digikey_url','onlinecomp_url','mouser_brk','digikey_brk','onlinecomp_brk','mouser_stock','digikey_stock','onlinecomp_stock',
                  'mouser_match','digikey_match','onlinecomp_match','mouser_mpn','digikey_mpn','onlinecomp_mpn','onlinecomp_uom'])
    out[k]=(db&&db[k])||p[k]||(k.endsWith('_brk')?0:'');
  if(!_sdIsToolRow(out)) out.description=`TOOL — ${out.description}`;
  return out;
}
// A Sales Desk tool row, for row `conn` (kept for the Database picker).
export function _sdToolItem(spec, conn, source, parts, price, extra={}){
  const it={..._toolFields({spec, source, price, ...extra}, conn, parts), total:0, labor_time:'', labor_total:0};
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
  return {...r, contacts:stats.contacts, aiError:stats.aiError, notFound:stats.notFound, searches:stats.searches, opened:stats.opened};
}
// One line for the user after a lookup: how many contacts got a tool, which did
// not, and why the web search did not run when it did not.
export function _toolLookupMessage(t){
  if(!t || !t.contacts) return '';
  const nf=t.notFound||[];
  let m=`Crimp tools: found for ${t.contacts-nf.length} of ${t.contacts} contact(s)`;
  if(nf.length) m+=` — not found for ${nf.join(', ')} (TOOL row added, type the tool P/N)`;
  if((t.searches||[]).length) m+=` · web: ${t.searches.length} search(es), ${(t.opened||[]).length} page(s) opened`;
  if(t.aiError) m+=`. ${t.aiError}`;
  return m;
}
// Add from Database: tool rows into the Sales Desk under what was just added.
export async function _sdAddToolsFor(added, onStatus){
  const parts=S.allParts||[];
  const {plan, stats}=await _findToolsFor(added, onStatus);
  const r=_insertTools(sdItems, plan, (x,conn)=>_sdToolItem(x.spec, conn, x.source, parts, x.price, {note:x.note, pages:x.pages}));
  const owned=sdItems.filter(it=>_sdIsToolRow(it) && _sdIsToolOwned(it)).length;
  return {...r, owned, contacts:stats.contacts, aiError:stats.aiError, notFound:stats.notFound, searches:stats.searches, opened:stats.opened};
}
// "Search again" on a tool row that has no part number yet (e.g. after web
// search was switched on): the contact's tool is looked up again and, when
// found, its rows take the place of the empty one.
export async function _sdRetryToolRow(i, onStatus){
  const ph=sdItems[i];
  if(!ph || !_sdIsToolRow(ph) || String(ph.part_number||'').trim()) return {found:0};
  const dwg=String(ph.drawing_number||'').trim(), forK=_key(ph.tool_for);
  const conn=sdItems.find(r=>!_sdIsToolRow(r) && _key(r.part_number)===forK && String(r.drawing_number||'').trim()===dwg)
    || {part_number:ph.tool_for, description:`PIN ${ph.tool_for}`, manufacturer:'', drawing_number:ph.drawing_number,
        drawing_name:ph.drawing_name, revision:ph.revision};
  const {plan, stats}=await _findToolsFor([{...conn, description:_isCrimpContactRow(conn)?conn.description:`CONTACT ${conn.description||''}`}], onStatus);
  const tools=[...plan.values()][0]||[];
  const at=sdItems.indexOf(ph);
  if(!tools.length || tools.every(x=>!x.spec.part_number)){
    const x=tools[0];
    if(x){ ph.tool_note=x.note||ph.tool_note; ph.tool_pages=x.pages||[]; }
    return {found:0, aiError:stats.aiError, note:ph.tool_note};
  }
  const parts=S.allParts||[];
  sdItems.splice(at, 1, ...tools.filter(x=>x.spec.part_number).map(x=>_sdToolItem(x.spec, conn, x.source, parts, x.price, {note:x.note, pages:x.pages})));
  return {found:tools.filter(x=>x.spec.part_number).length, aiError:stats.aiError};
}
