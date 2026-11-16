import { S } from '../../core/state.js';
import { aiFindToolsForParts } from '../../ai/bom.js';
import { _aiReady } from '../../ai/client.js';
import { _bomKnownTools } from '../../domain/bom.js';
import { _sdDwgKey, _sdIsToolOwned, _sdIsToolRow, _sdRecalcRow, _sdTraceFields, sdItems } from './salesDesk.js';

// ══════════════════════════════════════════════════════════════════════════════
// TOOLS FOR PARTS ADDED FROM THE DATABASE
// ------------------------------------------------------------------------------
// A drawing's analysis adds crimp/insertion tools on its own (ai/bom.js). Parts
// picked from the Database have no drawing behind them, so their tools are found
// here, in this order:
//   1. the Database — a tool already saved there for this connector
//      (its "tool_for", or the connector's number in the tool's description);
//   2. the standard tooling table (_bomKnownTools — MIL-DTL-38999 today);
//   3. one AI question for all remaining parts together.
// A tool that is already in the Database comes in with the Database's data; one
// marked In Stock costs nothing (see _sdIsToolOwned). Each tool row says where
// it came from (tool_source), and that it is not part of the customer's BOM.
// ══════════════════════════════════════════════════════════════════════════════
export const _SD_TOOL_SOURCE_LABEL={
  'db':'Existing tool in the Database',
  known:'Standard tooling table (MIL spec)',
  ai:'AI suggestion — verify before ordering',
};
export function _sdToolSourceLabel(r){
  const base=_SD_TOOL_SOURCE_LABEL[r.tool_source]||_SD_TOOL_SOURCE_LABEL.ai;
  return r.tool_in_db && r.tool_source!=='db' ? base+' · already in the Database' : base;
}
const _key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Tools in the Database that belong to this connector.
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
// A Sales Desk tool row, for connector row `conn`.
export function _sdToolItem(spec, conn, source, parts){
  const db=_dbPart(spec.part_number, parts);
  const it={
    part_number:spec.part_number||'', description:(db&&db.description)||spec.description||'TOOL',
    manufacturer:(db&&db.manufacturer)||spec.manufacturer||'',
    drawing_number:conn.drawing_number||'', drawing_name:conn.drawing_name||'', revision:conn.revision||'',
    atlantium_pn:'', customer_supplied:false,
    qty:1, unit:'pc', tool_for:conn.part_number||'', tool_source:source, tool_in_db:!!db,
    est_price: db ? (parseFloat(db.est_price)||0) : (parseFloat(spec.price)||0),
    priority_price: db ? (parseFloat(db.priority_price)||0) : 0,
    mouser_price: db ? (parseFloat(db.mouser_price)||'') : '',
    digikey_price: db ? (parseFloat(db.digikey_price)||'') : '',
    ...(db?_sdTraceFields(db):{}),
    total:0, labor_time:'', labor_total:0,
  };
  if(!_sdIsToolRow(it)) it.description=`TOOL — ${it.description}`;
  _sdRecalcRow(it);
  return it;
}
// Finds and inserts the tools for `added` (rows already in sdItems). Returns
// counts for the message shown afterwards.
export async function _sdAddToolsFor(added, onStatus){
  const parts=S.allParts||[];
  const res={added:0, db:0, known:0, ai:0, owned:0, aiError:''};
  const plan=new Map();   // connector row → [{spec, source}]
  const askAi=[];
  for(const conn of added){
    if(_sdIsToolRow(conn) || !String(conn.part_number||'').trim()) continue;
    const fromDb=_sdDbToolsFor(conn.part_number, parts);
    if(fromDb.length){ plan.set(conn, fromDb.map(p=>({spec:p, source:'db'}))); continue; }
    const known=_bomKnownTools(conn.part_number);
    if(known){
      if(!String(conn.pin_count||'').trim() && known.pins) conn.pin_count=String(known.pins);
      plan.set(conn, known.tools.map(t=>({spec:t, source:'known'}))); continue;
    }
    askAi.push(conn);
  }
  if(askAi.length && _aiReady()){
    if(onStatus) onStatus(`Checking which of ${askAi.length} part(s) need a crimp or insertion tool…`);
    try{
      const found=await aiFindToolsForParts(askAi);
      for(const t of found){
        const conn=askAi[t.for_idx];
        if(!plan.has(conn)) plan.set(conn,[]);
        plan.get(conn).push({spec:t, source:'ai'});
      }
    }catch(e){ res.aiError=e.message; }
  }
  // Insert each connector's tools right after it, once per drawing.
  for(const [conn, list] of plan){
    let at=sdItems.indexOf(conn);
    if(at<0) continue;
    for(const {spec, source} of list){
      const pnk=String(spec.part_number||'').trim().toLowerCase();
      if(!pnk) continue;
      const dup=sdItems.some(r=>_sdIsToolRow(r) && String(r.part_number||'').trim().toLowerCase()===pnk
                              && _sdDwgKey(r)===_sdDwgKey(conn));
      if(dup) continue;
      const it=_sdToolItem(spec, conn, source, parts);
      sdItems.splice(++at, 0, it);
      res.added++; res[source]++;
      if(_sdIsToolOwned(it)) res.owned++;
    }
  }
  return res;
}
