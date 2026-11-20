import { S } from '../core/state.js';
import { logAudit, logSystemAudit } from '../core/audit.js';
import { arrayUnion, collection, db, deleteField, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, writeBatch } from '../core/firebase.js';
import { PROTECTED_ROLE } from '../core/roles.js';
import { companyId, currentUserRole } from '../core/session.js';
import { toast } from '../core/ui.js';
import { _dbNormalizeUnit, _mergePartDrawing, _partDrawingsPatch, _sdDbNewDoc, _sdDbPatch } from '../domain/bom.js';

// ── Loading the parts list ───────────────────────────────────────────────────
// The whole parts_cache (about a thousand documents) is one read of a few
// seconds. Four things keep the Database screen from waiting on it (v1.83):
//  · prefetchParts() starts that read while the user is still on Home, so the
//    list is usually in memory before the Database card is clicked;
//  · loadParts() shares a read already in flight instead of starting another;
//  · peekParts(n) reads only the first n parts, for a first look on a cold load;
//  · refreshParts() reads again in the background after the screen is drawn
//    from memory, and says whether anything changed.
// Code that needs a fresh list still clears S.allParts and calls loadParts():
// a read that started BEFORE the clear is never trusted for that call.
const _partsCol=()=>collection(db,'companies',companyId,'parts_cache');
const _partsDocs=snap=>snap.docs.map(d=>({_id:d.id,...d.data()}));
export function _partsFingerprint(docs){ try{ return JSON.stringify(docs); }catch{ return 'x'+Math.random(); } }
function _partsApply(docs){
  // A deleted part is only marked, never removed at once (see the recycle
  // bin below). Every screen reads allParts, so splitting here is the one
  // place that keeps a deleted part out of searches, quotes and exports.
  S.allParts=docs.filter(p=>!_psIsDeleted(p));
  S.trashParts=docs.filter(_psIsDeleted);
  S._partsSig=_partsFingerprint(docs);
  S._partsAt=Date.now();
}
let _partsFetch=null;   // {ref, p}: the read in flight, and the S.allParts it was started for
function _partsStart(){
  const e={ref:S.allParts};
  e.p=getDocs(_partsCol()).then(_partsDocs);
  _partsFetch=e;
  e.p.then(()=>{ if(_partsFetch===e) _partsFetch=null; }, ()=>{ if(_partsFetch===e) _partsFetch=null; });
  return e;
}
export function _partsInFlight(){ return !!_partsFetch; }
export async function loadParts(){
  if(S.allParts.length>0) return;
  const e=(_partsFetch && _partsFetch.ref===S.allParts) ? _partsFetch : _partsStart();
  const docs=await e.p;
  if(S.allParts!==e.ref){
    if(S.allParts.length>0) return;   // another read filled it meanwhile
    return loadParts();               // cleared after this read started: read again
  }
  _partsApply(docs);
}
// Start reading the list in the background (Home calls this). Never throws.
export function prefetchParts(){
  if(!companyId || S.allParts.length>0 || _partsFetch) return;
  loadParts().catch(e=>console.warn('[parts] prefetch', e?.message));
}
// The first n parts in document order, deleted ones left out. For display only
// while the full list loads: never search, sort, price or export from these.
export async function peekParts(n){
  const snap=await getDocs(query(_partsCol(), limit(n)));
  return _partsDocs(snap).filter(p=>!_psIsDeleted(p));
}
// Read the list again and replace the one in memory. true when it changed.
// Skipped (false) if something else replaced S.allParts while it was reading.
export async function refreshParts(){
  const ref=S.allParts;
  const docs=_partsDocs(await getDocs(_partsCol()));
  if(S.allParts!==ref) return false;
  const sig=_partsFingerprint(docs);
  if(sig===S._partsSig) return false;
  _partsApply(docs);
  return true;
}

// ── Recycle bin ───────────────────────────────────────────────────────────────
// Deleting from the Database used to be a deleteDoc: gone on the spot, with
// nothing kept but a count in the audit log. Now a delete only MARKS the part
// (deleted:true + who and when). It disappears from every screen, an admin can
// see it under "Deleted items" and put it back in one click, and it is purged
// for good only after the company's retention period. All of it is ordinary
// updates to documents the company already owns, so the Firestore rules do
// not have to change for it to work.
export const _PS_TRASH_DAY_OPTIONS=[7,14,30,60,90];
export const _PS_DAY_MS=86400000;
export function _psTrashDaysOf(v){
  const n=parseInt(v,10);
  return _PS_TRASH_DAY_OPTIONS.includes(n) ? n : 30;
}
export function _psIsDeleted(p){ return !!p && p.deleted===true; }
// When the part was deleted, in ms. deletedAtMs is written by the client at
// delete time so the age is known even before the server timestamp resolves.
export function _psDeletedMs(p){
  const n=Number(p?.deletedAtMs);
  if(Number.isFinite(n) && n>0) return n;
  const t=p?.deletedAt;
  if(t && typeof t.toMillis==='function') return t.toMillis();
  return 0;
}
// Whole days the part has left in the bin; 0 means it is due for purging.
export function _psDaysLeft(p, days, now){
  const at=_psDeletedMs(p);
  if(!at) return days;
  return Math.max(0, Math.ceil((at + days*_PS_DAY_MS - (now??Date.now())) / _PS_DAY_MS));
}
export function _psIsAdmin(){ return currentUserRole===PROTECTED_ROLE; }
// What the audit log keeps of a part: every field, with Firestore timestamps
// written as ISO strings so the record reads the same anywhere it is shown.
export function _psAuditCopy(p){
  const out={};
  Object.keys(p||{}).forEach(k=>{
    const v=p[k];
    if(v && typeof v.toDate==='function'){ try{ out[k]=v.toDate().toISOString(); }catch{ out[k]=String(v); } }
    else if(v!==undefined && typeof v!=='function') out[k]=v;
  });
  out.id=p?._id||out.id||''; delete out._id;
  return out;
}
// The audit trail of a delete, restore or purge, with the parts themselves in
// it. Written in chunks: one audit document is capped at 1 MiB, and a delete
// of a few hundred parts with long descriptions would pass that in one go.
export const _PS_AUDIT_CHUNK=100;
export async function _psAuditParts(action, parts, extra){
  const copies=(parts||[]).map(_psAuditCopy);
  const chunks=Math.max(1, Math.ceil(copies.length/_PS_AUDIT_CHUNK));
  for(let i=0;i<chunks;i++){
    const items=copies.slice(i*_PS_AUDIT_CHUNK, (i+1)*_PS_AUDIT_CHUNK);
    await logAudit(action, {count:copies.length, part:chunks>1?`${i+1}/${chunks}`:'',
      ...(extra||{}), items}, true);
  }
}
// Firestore allows 500 writes in a batch; 400 leaves room.
export async function _psBatchWrite(ids, fn){
  for(let i=0;i<ids.length;i+=400){
    const batch=writeBatch(db);
    ids.slice(i,i+400).forEach(id=>fn(batch, doc(db,'companies',companyId,'parts_cache',id)));
    await batch.commit();
  }
}
export async function _psSoftDelete(ids){
  const now=Date.now();
  const gone=S.allParts.filter(p=>ids.includes(p._id));
  await _psBatchWrite(ids, (b,ref)=>b.update(ref,{
    deleted:true, deletedAt:serverTimestamp(), deletedAtMs:now, deletedBy:S.currentUserEmail||''}));
  S.allParts=S.allParts.filter(p=>!ids.includes(p._id));
  gone.forEach(p=>{ p.deleted=true; p.deletedAtMs=now; p.deletedBy=S.currentUserEmail||''; });
  S.trashParts=[...gone, ...S.trashParts];
  await _psAuditParts('database_delete_parts', gone, {to:'recycle_bin', keep_days:S._psTrashDays});
  return gone.length;
}
export async function _psRestore(ids){
  const back=S.trashParts.filter(p=>ids.includes(p._id));
  await _psBatchWrite(ids, (b,ref)=>b.update(ref,{
    deleted:false, deletedAt:deleteField(), deletedAtMs:deleteField(), deletedBy:deleteField(),
    updatedAt:serverTimestamp()}));
  S.trashParts=S.trashParts.filter(p=>!ids.includes(p._id));
  back.forEach(p=>{ delete p.deleted; delete p.deletedAt; delete p.deletedAtMs; delete p.deletedBy; });
  S.allParts=[...back, ...S.allParts];
  await _psAuditParts('database_restore_parts', back);
  return back.length;
}
export async function _psPurge(ids, why){
  const gone=S.trashParts.filter(p=>ids.includes(p._id));
  // The audit copy is written FIRST: once the documents are gone it is the
  // only record of what they held.
  await _psAuditParts('database_purge_parts', gone, {reason:why||'manual'});
  await _psBatchWrite(ids, (b,ref)=>b.delete(ref));
  S.trashParts=S.trashParts.filter(p=>!ids.includes(p._id));
  return gone.length;
}
// Parts whose retention ran out are purged when an admin opens the Database —
// the only role allowed to remove them for good. Quiet, and never in the way
// of the screen loading.
export async function _psAutoPurge(){
  if(!_psIsAdmin() || !S.trashParts.length) return 0;
  const due=S.trashParts.filter(p=>_psDaysLeft(p, S._psTrashDays)===0).map(p=>p._id);
  if(!due.length) return 0;
  try{ return await _psPurge(due, `retention ${S._psTrashDays} days`); }
  catch(e){ console.warn('[RecycleBin] auto purge', e.message); return 0; }
}
export async function _psSetTrashDays(n){
  S._psTrashDays=_psTrashDaysOf(n);
  await setDoc(doc(db,'companies',companyId),{trash_days:S._psTrashDays},{merge:true});
  logAudit('database_trash_days',{days:S._psTrashDays},true);
}

// ── One-time cleanup: remove the dead FindChips fields ───────────────────────
// FindChips scraping was removed — prices now come from the Mouser and DigiKey
// APIs. Its three leftover fields (price / distributor / findchips_url) would
// otherwise sit in every one of the ~1000 part documents forever, showing up in
// exports and confusing anyone reading the data later.
//
// Runs at most once per browser: the flag below stops it re-scanning on every
// visit. It's safe to run again (deleting an absent field is a no-op), so
// clearing the localStorage key re-triggers it if a document is ever missed —
// e.g. one created by another user's browser before they upgraded.
export const _FC_PURGE_KEY='fc_fields_purged_v1';
export async function purgeLegacyFindChipsFields(){
  if(!companyId || localStorage.getItem(_FC_PURGE_KEY)) return;
  try{
    const snap=await getDocs(collection(db,'companies',companyId,'parts_cache'));
    const stale=snap.docs.filter(d=>{
      const v=d.data()||{};
      return ('price' in v) || ('distributor' in v) || ('findchips_url' in v);
    });
    if(!stale.length){ localStorage.setItem(_FC_PURGE_KEY,'1'); return; }
    // Batched so ~1000 documents cost a handful of round-trips, not 1000.
    // 500 is Firestore's hard cap on writes per batch.
    for(let i=0;i<stale.length;i+=400){
      const batch=writeBatch(db);
      for(const d of stale.slice(i,i+400)){
        batch.update(d.ref,{
          price:deleteField(), distributor:deleteField(), findchips_url:deleteField(),
        });
      }
      await batch.commit();
    }
    localStorage.setItem(_FC_PURGE_KEY,'1');
    console.info(`[Cleanup] removed FindChips fields from ${stale.length} part(s)`);
    logSystemAudit('fc_fields_purged',`${stale.length} part(s)`,true);
  }catch(e){
    // Never block the screen over cleanup — the app works fine with the fields
    // still present, they're simply no longer read.
    console.warn('[Cleanup] FindChips field purge failed:',e.message);
  }
}

// ── Save BOM rows to Part Stock (parts_cache) ─────────────────────────────────
// Upserts each row by part_number; never overwrites existing price/stock/distributor.
// rfqName (optional): when the BOM being saved belongs to a specific RFQ (i.e. this
// was called from the "Add Drawing" flow inside an RFQ, not the standalone Sales
// Desk "From File" import), that RFQ's name is added to the part's rfq_names array
// — a part_number can be referenced by more than one RFQ, so this is a set, not a
// single value, and existing entries are always preserved (arrayUnion).
export async function saveBOMToPartStock(rows, rfqName='', onProgress){
  let created=0, skipped=0, revived=0, _done=0;
  for(const r of rows){
    if(onProgress && _done) onProgress(_done, rows.length);
    _done++;
    const pn=(r.part_number||'').trim();
    // The Database is keyed on the part number, so a row without one has
    // nowhere to live. It used to be dropped in silence, which looked exactly
    // like a successful save until the part couldn't be found later — say so
    // instead (count them up and warn once, below).
    if(!pn){ skipped++; continue; }
    // Firestore doc IDs can't have / ; replace unsafe chars
    const key=pn.replace(/[\/\\#\[\]*?]/g,'_').slice(0,500);
    const ref=doc(db,'companies',companyId,'parts_cache',key);
    try{
      const snap=await getDoc(ref);
      if(snap.exists()){
        // Merge — only fill in fields that are currently empty. QTY is the
        // one exception: the Database always shows 1 (it's a master catalog,
        // not a per-order tally), so every save re-pins it regardless.
        const d=snap.data();
        const patch={updatedAt:serverTimestamp(), qty:1};
        // Saving a part that sits in the recycle bin brings it back: the user
        // has just asked for it to be in the Database again.
        if(d.deleted===true){
          Object.assign(patch,{deleted:false, deletedAt:deleteField(), deletedAtMs:deleteField(), deletedBy:deleteField()});
          revived++;
        }
        if(r.description && !d.description) patch.description=r.description;
        // The drawing this row comes from is ADDED to the part's drawings (the
        // first drawing used to stay forever, or be replaced by the newest).
        Object.assign(patch, _partDrawingsPatch([r], d));
        if(r.drawing_name && !d.drawing_name) patch.drawing_name=r.drawing_name;
        if(r.manufacturer && !d.manufacturer) patch.manufacturer=r.manufacturer;
        if(r.unit && !d.unit) patch.unit=_dbNormalizeUnit(r.unit);
        if(r.atlantium_pn && !d.atlantium_pn) patch.atlantium_pn=r.atlantium_pn;
        if(r.pin_count && !d.pin_count) patch.pin_count=r.pin_count;
        if(r.revision && !d.revision) patch.revision=r.revision;
        if(r.tool_for && !d.tool_for) patch.tool_for=r.tool_for;
        // A tool priced during the import keeps its prices and links.
        for(const k of ['mouser_price','digikey_price','onlinecomp_price','farnell_price']) if(+r[k]>0 && !(+d[k]>0)) patch[k]=+r[k];
        for(const k of ['mouser_url','digikey_url','onlinecomp_url','mouser_stock','digikey_stock','onlinecomp_stock','onlinecomp_uom','farnell_url','farnell_stock','farnell_uom']) if(r[k] && !d[k]) patch[k]=r[k];
        // Customer-supplied records what the latest import said; it is never
        // read back into a quote (that is decided per quote).
        if(r.customer_supplied!=null && !!r.customer_supplied!==!!d.customer_supplied) patch.customer_supplied=!!r.customer_supplied;
        // Refresh the approved-alternatives list whenever an import supplies
        // one — a newer QVL may have added or withdrawn a manufacturer.
        if((r.alt_mpns||[]).length>1) patch.alt_mpns=r.alt_mpns;
        // r.price only ever arrives set on a synthesized crimp-tool BOM row (see
        // _BOM_TEXT_PROMPT/_BOM_VISION_PROMPT rule 5). It's an AI ESTIMATE, not a
        // distributor quote, so it goes in its own field rather than sitting in a
        // price column next to real Mouser/DigiKey numbers — a guess and a quote
        // shouldn't be indistinguishable. Sales Desk uses it only as a last
        // resort when no real source has a price (see _sdRecalcTotal).
        if(r.price && !d.est_price) patch.est_price=parseFloat(r.price)||'';
        if(rfqName && !(d.rfq_names||[]).includes(rfqName)) patch.rfq_names=arrayUnion(rfqName);
        await updateDoc(ref,patch);
      } else {
        await setDoc(ref,{
          part_number:pn, description:r.description||'',
          drawing_number:r.drawing_number||'', drawing_name:r.drawing_name||'', manufacturer:r.manufacturer||'',
          drawings:_mergePartDrawing([], r),
          unit:_dbNormalizeUnit(r.unit)||'', atlantium_pn:r.atlantium_pn||'', qty:1,
          pin_count:r.pin_count||'', revision:r.revision||'', tool_for:r.tool_for||'',
          customer_supplied:!!r.customer_supplied,
          ...(+r.mouser_price>0?{mouser_price:+r.mouser_price, mouser_url:r.mouser_url||'', mouser_stock:r.mouser_stock||''}:{}),
          ...(+r.digikey_price>0?{digikey_price:+r.digikey_price, digikey_url:r.digikey_url||'', digikey_stock:r.digikey_stock||''}:{}),
          ...(+r.onlinecomp_price>0?{onlinecomp_price:+r.onlinecomp_price, onlinecomp_url:r.onlinecomp_url||'', onlinecomp_stock:r.onlinecomp_stock||'', onlinecomp_uom:r.onlinecomp_uom||''}:{}),
          ...(+r.farnell_price>0?{farnell_price:+r.farnell_price, farnell_url:r.farnell_url||'', farnell_stock:r.farnell_stock||'', farnell_uom:r.farnell_uom||''}:{}),
          alt_mpns:(r.alt_mpns||[]).length>1?r.alt_mpns:[],
          est_price:r.price?(parseFloat(r.price)||''):'', stock:'', price_description:'',
          rfq_names: rfqName ? [rfqName] : [],
          updatedAt:serverTimestamp()
        });
        created++;
      }
    }catch(e){ console.warn('[PartStock] save error:',pn,e.message); }
  }
  if(onProgress) onProgress(rows.length, rows.length);
  if(skipped){
    toast(`${skipped} of ${rows.length} row(s) had no part number and were NOT saved to the Database — fill MNF P/N and import again`,'error');
  }
  // Refresh in-memory parts list so SD search sees new entries. A revived
  // part was out of allParts, so that case reloads both lists from scratch.
  // Always from the Database again: loadParts() keeps a list it already has,
  // so parts created here stayed invisible to every screen (and to Check
  // Price, which then wrote a second, blank record over them) until a reload.
  S.allParts=[]; S.trashParts=[];
  await loadParts();
  return created;
}

// Upsert priority prices into parts_cache. Existing part_number → update priority_price;
// unknown part_number → create a new row with just part_number + priority_price.
export async function savePriorityImport(rows, onProgress){
  await loadParts();
  let updated=0, created=0, _done=0;
  for(const r of rows){
    if(onProgress) onProgress(_done, rows.length);
    _done++;
    const pn=r.part_number.trim();
    if(!pn) continue;
    const existing=S.allParts.find(p=>String(p.part_number||'').toLowerCase()===pn.toLowerCase());
    const unit=_dbNormalizeUnit(r.unit);
    try{
      if(existing){
        const patch={priority_price:r.priority_price, updatedAt:serverTimestamp(), qty:1};
        if(unit) patch.unit=unit;
        await updateDoc(doc(db,'companies',companyId,'parts_cache',existing._id), patch);
        existing.priority_price=r.priority_price; if(unit) existing.unit=unit;
        updated++;
      } else {
        const key=pn.replace(/[\/\\#\[\]*?]/g,'_').slice(0,500);
        await setDoc(doc(db,'companies',companyId,'parts_cache',key),{
          part_number:pn, description:'', drawing_number:'', manufacturer:'',
          unit, atlantium_pn:'', price:'', distributor:'', stock:'', price_description:'', qty:1,
          priority_price:r.priority_price, updatedAt:serverTimestamp(), deleted:false
        },{merge:true});
        S.allParts.push({_id:key, part_number:pn, priority_price:r.priority_price, unit, qty:1});
        created++;
      }
    }catch(e){ console.warn('[PriorityImport] save error:',pn,e.message); }
  }
  if(onProgress) onProgress(rows.length, rows.length);
  return {updated, created};
}

// Upsert tool part numbers + descriptions into parts_cache. Existing
// part_number → update description; unknown part_number → create a new row.
// This is deliberately a straight overwrite of description (unlike BOM saves,
// which only fill it in if blank) since the user is explicitly (re-)importing
// a tools catalog and expects its descriptions to take effect.
// own_stock is always set true here — items brought in via this specific
// import are, by definition, tools the company already has in stock (see the
// "Stock" column in _psCellHTML, and Sales Desk's ownership check in
// handleSDFiles, which excludes own_stock=true tool rows from the final price).
export async function saveToolsImport(rows, onProgress){
  await loadParts();
  let updated=0, created=0, _done=0;
  for(const r of rows){
    if(onProgress) onProgress(_done, rows.length);
    _done++;
    const pn=r.part_number.trim();
    if(!pn) continue;
    const existing=S.allParts.find(p=>String(p.part_number||'').toLowerCase()===pn.toLowerCase());
    try{
      if(existing){
        await updateDoc(doc(db,'companies',companyId,'parts_cache',existing._id),
          {description:r.description||'', own_stock:true, updatedAt:serverTimestamp(), qty:1});
        existing.description=r.description||''; existing.own_stock=true;
        updated++;
      } else {
        const key=pn.replace(/[\/\\#\[\]*?]/g,'_').slice(0,500);
        await setDoc(doc(db,'companies',companyId,'parts_cache',key),{
          part_number:pn, description:r.description||'', drawing_number:'', manufacturer:'',
          unit:'', atlantium_pn:'', price:'', priority_price:'', distributor:'', stock:'', price_description:'', qty:1,
          own_stock:true, updatedAt:serverTimestamp(), deleted:false
        },{merge:true});
        S.allParts.push({_id:key, part_number:pn, description:r.description||'', own_stock:true, qty:1});
        created++;
      }
    }catch(e){ console.warn('[ToolsImport] save error:',pn,e.message); }
  }
  if(onProgress) onProgress(rows.length, rows.length);
  return {updated, created};
}

// A few fields on one part; `updatedAt` is stamped here.
export async function updatePartFields(id, patch){
  return updateDoc(doc(db,"companies",companyId,"parts_cache",id), {...patch, updatedAt:serverTimestamp()});
}
// Creates the part, or merges into it if one exists under this key (a part in
// the recycle bin included — callers pass deleted:false to bring it back).
export async function mergePartDoc(key, fields){
  return setDoc(doc(db,'companies',companyId,'parts_cache',key), {...fields, updatedAt:serverTimestamp()}, {merge:true});
}

// ── Sales Desk → Database ─────────────────────────────────────────────────────
// Everything on the Sales Desk right now, written to the Database. A part that
// is already there gets ONLY the fields that differ (see _sdDbPatch); a new one
// is created. A part number that appears on several rows is saved once, from
// its first row. Returns what happened, per part, for the result window.
export async function saveSalesDeskToDB(rows, onProgress){
  await loadParts();
  const res={created:0, updated:0, unchanged:0, skipped:0, duplicates:0, revived:0, fields:0, changes:[], errors:[]};
  // One record per part number; a part on the desk in several drawings is
  // saved once, from its first row, with every drawing it is in.
  const seen=new Map(), list=[];
  for(const r of rows){
    const pn=String(r.part_number||'').trim();
    if(!pn){ res.skipped++; continue; }
    const k=pn.toLowerCase();
    if(seen.has(k)){ res.duplicates++; seen.get(k).push(r); continue; }
    seen.set(k,[r]); list.push(r);
  }
  const byPn=new Map([...S.allParts, ...S.trashParts].map(p=>[String(p.part_number||'').trim().toLowerCase(), p]));
  let done=0;
  for(const r of list){
    if(onProgress) onProgress(done, list.length);
    done++;
    const pn=String(r.part_number).trim();
    const known=byPn.get(pn.toLowerCase());
    const key=known ? known._id : pn.replace(/[\/\\#\[\]*?]/g,'_').slice(0,500);
    const ref=doc(db,'companies',companyId,'parts_cache',key);
    try{
      const snap=await getDoc(ref);
      if(snap.exists()){
        const d=snap.data();
        const patch=_sdDbPatch(r, d, seen.get(pn.toLowerCase()));
        const names=Object.keys(patch);
        if(d.deleted===true){
          Object.assign(patch,{deleted:false, deletedAt:deleteField(), deletedAtMs:deleteField(), deletedBy:deleteField()});
          res.revived++;
        }
        if(!Object.keys(patch).length){ res.unchanged++; continue; }
        await updateDoc(ref,{...patch, qty:1, updatedAt:serverTimestamp()});
        res.updated++; res.fields+=names.length;
        res.changes.push({pn, fields:names, revived:d.deleted===true});
      } else {
        await setDoc(ref,{..._sdDbNewDoc(r, seen.get(pn.toLowerCase())), updatedAt:serverTimestamp()});
        res.created++;
        res.changes.push({pn, created:true, fields:[]});
      }
    }catch(e){ res.errors.push(`${pn}: ${e.message}`); }
  }
  if(onProgress) onProgress(list.length, list.length);
  S.allParts=[]; S.trashParts=[];
  await loadParts();
  return res;
}
