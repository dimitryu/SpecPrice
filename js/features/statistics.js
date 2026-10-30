import { S } from '../core/state.js';
import { logAudit } from '../core/audit.js';
import { _isRoleDocId } from '../core/roles.js';
import { esc, setActions, setContent, toast } from '../core/ui.js';
import { listAuditEntriesBetween } from '../data/audit.js';
import { countCustomers } from '../data/customers.js';
import { loadParts } from '../data/parts.js';
import { countProjects } from '../data/projects.js';
import { listRoleDocs } from '../data/roles.js';
import { listUsers } from '../data/users.js';

// ══════════════════════════════════════════════════════════════════════════════
// STATISTICS — how the system is actually being used
// ══════════════════════════════════════════════════════════════════════════════
// Every figure here is derived from data the app already writes: the audit trail
// (companies/{id}/audit_logs) for anything that happened, and live collection
// counts for anything that simply IS. The two are kept in separate blocks and
// labelled as such, because only the first can honestly answer "in this date
// range" — a count of parts in the Database is today's number whatever dates you
// pick, and quietly filtering it would be a lie.
//
// audit_logs is admin-readable only (see firestore.rules), so this screen needs
// the admin role — or a role an admin grants it to.
export let _statFrom=null, _statTo=null;      // Date objects; null until the page opens
export let _statBlocks={};                    // { key: {title, columns, rows} } for export

export const _STAT_PRESETS=[[7,'7 days'],[30,'30 days'],[90,'90 days'],[365,'12 months']];
export function _statIsoDay(d){
  // Local calendar day, not UTC — "logins per day" must line up with the day the
  // person actually worked, not with Greenwich.
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
export function _statSetRangeDays(days){
  const to=new Date(); to.setHours(23,59,59,999);
  const from=new Date(); from.setDate(from.getDate()-(days-1)); from.setHours(0,0,0,0);
  _statFrom=from; _statTo=to;
}
// Firestore timestamps come back as Timestamp objects, but a row written in the
// same session can still be a pending serverTimestamp (null) — skip those rather
// than counting them on 1970.
export function _statLogDate(l){
  const t=l && l.timestamp;
  if(!t) return null;
  try{ return t.toDate ? t.toDate() : new Date(t); }catch{ return null; }
}
export function _statDetails(l){
  const d=l && l.details;
  return (d && typeof d==='object') ? d : {};
}

// ── Aggregations. Pure functions over a plain array of log rows, so they can be
//    tested without a browser or a database. ──────────────────────────────────
export function _statCount(logs, action, okOnly=true){
  return logs.filter(l=>l.action===action && (!okOnly || l.success!==false)).length;
}
export function _statSum(logs, action, field){
  return logs.reduce((a,l)=>
    l.action===action && l.success!==false ? a+(parseFloat(_statDetails(l)[field])||0) : a, 0);
}
// Average of a numeric detail, ignoring rows that never recorded it. Returns null
// rather than 0 when nothing has been measured yet — "no data" and "zero" are
// different answers and a dashboard must not blur them.
export function _statAvg(logs, action, field){
  const vals=logs.filter(l=>l.action===action && l.success!==false)
                 .map(l=>parseFloat(_statDetails(l)[field]))
                 .filter(v=>isFinite(v) && v>0);
  if(!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
export function _statPerDay(logs, actions){
  const want=new Set([].concat(actions));
  const by={};
  for(const l of logs){
    if(!want.has(l.action) || l.success===false) continue;
    const d=_statLogDate(l); if(!d) continue;
    const k=_statIsoDay(d);
    by[k]=(by[k]||0)+1;
  }
  return Object.entries(by).sort((a,b)=>a[0]<b[0]?-1:1);
}
export function _statPerUser(logs, actions){
  const want=new Set([].concat(actions));
  const by={};
  for(const l of logs){
    if(!want.has(l.action) || l.success===false) continue;
    const u=l.user||'(unknown)';
    if(u==='SYSTEM') continue;          // automated work isn't a person signing in
    by[u]=(by[u]||0)+1;
  }
  return Object.entries(by).sort((a,b)=>b[1]-a[1]);
}
// One row per drawing file the AI was asked to read. Keyed on the filename the
// extraction logged, which is the only drawing identity present in the trail.
export function _statDrawings(logs){
  const by={};
  for(const l of logs){
    if(l.action!=='drawing_bom_search') continue;
    const d=_statDetails(l);
    const name=String(d.filename||'(unnamed)');
    const e=by[name]||(by[name]={drawing:name,runs:0,ok:0,failed:0,rows:[],ms:[],last:null});
    e.runs++;
    if(l.success===false){ e.failed++; }
    else {
      e.ok++;
      // Only a run that produced something contributes to the averages: a
      // failed extraction's duration is the time spent failing, which would
      // quietly drag "avg time to read a drawing" in either direction.
      const rows=parseFloat(d.rowsFound); if(isFinite(rows)) e.rows.push(rows);
      const ms=parseFloat(d.ms);          if(isFinite(ms)&&ms>0) e.ms.push(ms);
    }
    const when=_statLogDate(l);
    if(when && (!e.last || when>e.last)) e.last=when;
  }
  const avg=a=>a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  return Object.values(by).map(e=>({
    drawing:e.drawing, runs:e.runs, ok:e.ok, failed:e.failed,
    avgRows:avg(e.rows), avgMs:avg(e.ms), last:e.last,
  })).sort((a,b)=>b.runs-a.runs || (a.drawing<b.drawing?-1:1));
}
// Price coverage: of the parts in the Database, how many carry a price from any
// source. Answers "can we actually quote what we hold?".
export const _STAT_PRICE_FIELDS=['priority_price','mouser_price','digikey_price'];
export function _statCoverage(parts){
  let withPrice=0;
  const byDwg={};
  for(const p of parts||[]){
    const has=_STAT_PRICE_FIELDS.some(f=>(parseFloat(p[f])||0)>0);
    if(has) withPrice++;
    const d=String(p.drawing_number||'').trim()||'(no drawing #)';
    const e=byDwg[d]||(byDwg[d]={drawing:d,parts:0,priced:0});
    e.parts++; if(has) e.priced++;
  }
  const total=(parts||[]).length;
  return {
    total, withPrice, pct: total ? (100*withPrice/total) : null,
    byDrawing: Object.values(byDwg)
      .map(e=>({...e, pct: e.parts ? (100*e.priced/e.parts) : null}))
      .sort((a,b)=>b.parts-a.parts || (a.drawing<b.drawing?-1:1)),
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────
export function _statFmtMs(ms){
  if(ms==null) return '—';
  return ms<1000 ? `${Math.round(ms)} ms`
       : ms<60000 ? `${(ms/1000).toFixed(1)} s`
       : `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`;
}
export function _statFmtNum(n,dp=0){ return n==null ? '—' : (+n).toLocaleString(undefined,{minimumFractionDigits:dp,maximumFractionDigits:dp}); }
export function _statFmtPct(p){ return p==null ? '—' : `${p.toFixed(1)}%`; }
export function _statFmtDate(d){ return d ? d.toLocaleDateString('en-GB') : '—'; }

// ── Rendering helpers ───────────────────────────────────────────────────────
export function _statTile(label, value, sub){
  return `<div class="stat-tile">
    <div class="stat-tile-v">${esc(String(value))}</div>
    <div class="stat-tile-l">${esc(label)}</div>
    ${sub?`<div class="stat-tile-s">${esc(sub)}</div>`:''}
  </div>`;
}
// A bar list rather than a chart library: the app loads no charting code, and a
// ranked list with proportional bars answers "which days / who / what" without
// 300KB of dependency.
export function _statBars(pairs, fmt){
  if(!pairs.length) return `<p class="stat-empty">Nothing recorded in this range.</p>`;
  const max=Math.max(...pairs.map(p=>p[1]));
  return `<div class="stat-bars">${pairs.map(([k,v])=>`
    <div class="stat-bar-row">
      <span class="stat-bar-k" title="${esc(String(k))}">${esc(String(k))}</span>
      <span class="stat-bar-t"><span class="stat-bar-f" style="width:${max?Math.max(2,100*v/max):0}%"></span></span>
      <span class="stat-bar-v">${esc(String(fmt?fmt(v):v))}</span>
    </div>`).join('')}</div>`;
}
export function _statTable(columns, rows){
  if(!rows.length) return `<p class="stat-empty">Nothing recorded in this range.</p>`;
  return `<div class="table-wrap"><table style="font-size:12px">
    <thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
// Registers a block's tabular form for export at the same moment it is drawn, so
// the spreadsheet can never disagree with the screen.
export function _statBlock(key, title, note, innerHTML, columns, rows){
  _statBlocks[key]={title, columns, rows};
  return `<div class="settings-panel stat-block" style="padding:16px 18px;margin-top:16px">
    <div class="stat-block-head">
      <div>
        <div class="stat-block-title">${esc(title)}</div>
        ${note?`<div class="stat-block-note">${esc(note)}</div>`:''}
      </div>
      <button class="btn btn-ghost btn-sm stat-export" data-block="${esc(key)}" title="Export just this block to Excel">📊 Export</button>
    </div>
    ${innerHTML}
  </div>`;
}

// ── The screen ──────────────────────────────────────────────────────────────
export function renderStatisticsPage(){
  setActions('');
  if(!_statFrom) _statSetRangeDays(30);
  setContent(`
    <div class="stat-wrap">
      <div class="settings-panel" style="padding:14px 18px">
        <div class="stat-filter">
          <strong style="font-size:13px;color:var(--blue-dark)">📊 Statistics</strong>
          <span style="flex:1"></span>
          ${_STAT_PRESETS.map(([d,l])=>`<button class="btn btn-ghost btn-sm stat-preset" data-days="${d}">${l}</button>`).join('')}
          <label for="stat-from" style="font-size:11px;color:var(--muted)">From</label>
          <input type="date" id="stat-from" class="form-input" style="width:150px;padding:4px 7px;font-size:12px" value="${_statIsoDay(_statFrom)}">
          <label for="stat-to" style="font-size:11px;color:var(--muted)">To</label>
          <input type="date" id="stat-to" class="form-input" style="width:150px;padding:4px 7px;font-size:12px" value="${_statIsoDay(_statTo)}">
          <button class="btn btn-blue btn-sm" id="stat-apply">Apply</button>
          <button class="btn btn-green btn-sm" id="stat-export-all" title="Every block, one sheet each">⬇ Export all</button>
        </div>
      </div>
      <div id="stat-body"></div>
    </div>`);

  document.querySelectorAll('.stat-preset').forEach(b=>b.addEventListener('click',()=>{
    _statSetRangeDays(parseInt(b.dataset.days,10)||30);
    document.getElementById('stat-from').value=_statIsoDay(_statFrom);
    document.getElementById('stat-to').value=_statIsoDay(_statTo);
    _statLoad();
  }));
  document.getElementById('stat-apply').addEventListener('click',()=>{
    const f=document.getElementById('stat-from').value, t=document.getElementById('stat-to').value;
    if(!f||!t){ toast('Pick both dates','error'); return; }
    const from=new Date(f+'T00:00:00'), to=new Date(t+'T23:59:59');
    if(!(from<=to)){ toast('The From date must not be after the To date','error'); return; }
    _statFrom=from; _statTo=to;
    _statLoad();
  });
  document.getElementById('stat-export-all').addEventListener('click',()=>_statExportAll());
  _statLoad();
}

export async function _statLoad(){
  const host=document.getElementById('stat-body');
  if(!host) return;
  _statBlocks={};
  host.innerHTML=`<div class="ai-status" style="margin-top:20px"><div class="ring"></div>
    <span>Reading the activity log…</span></div>`;

  // Each source is fetched independently: a permissions error on the audit trail
  // must not also blank the counts that come from elsewhere.
  let logs=null, logErr='';
  try{
    logs=await listAuditEntriesBetween(_statFrom, _statTo, 5000);
  }catch(e){
    logErr = /permission|insufficient/i.test(e.message||'')
      ? 'Reading the activity log needs the administrator role.'
      : e.message;
  }

  let parts=[], counts={}, countErr='';
  try{
    await loadParts();
    parts=S.allParts;
    const [users, roleDocs, projects, customers] = await Promise.all([
      listUsers(), listRoleDocs(), countProjects(), countCustomers(),
    ]);
    counts={
      users: users.length,
      roles: roleDocs.filter(d=>_isRoleDocId(d.id)).length,
      projects,
      customers,
      parts: parts.length,
    };
  }catch(e){ countErr=e.message; }

  host.innerHTML=_statRender(logs, logErr, parts, counts, countErr);
  host.querySelectorAll('.stat-export').forEach(b=>
    b.addEventListener('click',()=>_statExportBlock(b.dataset.block)));
}

export function _statRender(logs, logErr, parts, counts, countErr){
  const rangeLabel=`${_statFmtDate(_statFrom)} – ${_statFmtDate(_statTo)}`;
  let out='';

  if(logErr){
    out += `<div class="settings-panel" style="padding:16px 18px;margin-top:16px;border-color:#FCA5A5;background:#FEF2F2">
      <strong style="color:#9B1C1C;font-size:13px">Activity data unavailable</strong>
      <p style="font-size:12px;color:#7F1D1D;margin-top:4px">${esc(logErr)}</p></div>`;
  }

  if(logs){
    // ── Activity ────────────────────────────────────────────────────────────
    const analysed=_statCount(logs,'drawing_bom_search');
    const analysedFail=logs.filter(l=>l.action==='drawing_bom_search'&&l.success===false).length;
    const toSD=_statSum(logs,'sales_desk_add_from_drawing','count');
    const rfqs=_statCount(logs,'rfq_created');
    const boms=_statCount(logs,'rfq_bom_saved');
    const exports=_statCount(logs,'sales_desk_export');
    const failures=logs.filter(l=>l.success===false).length;
    const actRows=[
      ['Drawings analysed',analysed],['Failed analyses',analysedFail],
      ['Parts sent to Sales Desk',toSD],['RFQs created',rfqs],
      ['BOMs saved to RFQ',boms],['Quotations exported',exports],
      ['Failed actions (all kinds)',failures],['Log entries read',logs.length],
    ];
    out += _statBlock('activity','Activity',`Audit trail · ${rangeLabel}`,
      `<div class="stat-tiles">
        ${_statTile('Drawings analysed',_statFmtNum(analysed), analysedFail?`${analysedFail} failed`:'')}
        ${_statTile('Parts → Sales Desk',_statFmtNum(toSD))}
        ${_statTile('RFQs created',_statFmtNum(rfqs))}
        ${_statTile('Quotations exported',_statFmtNum(exports))}
        ${_statTile('Failed actions',_statFmtNum(failures))}
      </div>
      <div class="stat-sub">Drawing analyses per day</div>
      ${_statBars(_statPerDay(logs,'drawing_bom_search'))}`,
      ['Metric','Value'], actRows);

    // ── Drawings ────────────────────────────────────────────────────────────
    const dwgs=_statDrawings(logs);
    const dwgRows=dwgs.map(d=>[d.drawing,d.runs,d.ok,d.failed,
      d.avgRows==null?'—':d.avgRows.toFixed(1), _statFmtMs(d.avgMs), _statFmtDate(d.last)]);
    const avgAnalysis=_statAvg(logs,'drawing_bom_search','ms');
    out += _statBlock('drawings','Drawings',
      `One row per drawing file the AI was asked to read · ${rangeLabel}`,
      `<div class="stat-tiles">
        ${_statTile('Distinct drawings',_statFmtNum(dwgs.length))}
        ${_statTile('Total analyses',_statFmtNum(dwgs.reduce((a,d)=>a+d.runs,0)))}
        ${_statTile('Avg analysis time',_statFmtMs(avgAnalysis), avgAnalysis==null?'measured from v1.37 onward':'')}
      </div>
      ${_statTable(['Drawing','Analyses','OK','Failed','Avg rows','Avg time','Last'], dwgRows.slice(0,40))}
      ${dwgRows.length>40?`<p class="stat-empty">Showing the 40 most analysed — Export for the full list.</p>`:''}`,
      ['Drawing','Analyses','OK','Failed','Avg rows','Avg time','Last'], dwgRows);

    // ── Pricing ─────────────────────────────────────────────────────────────
    const runs=_statCount(logs,'price_check',false);
    const checked=_statSum(logs,'price_check','checked');
    const found=_statSum(logs,'price_check','found');
    const failedParts=_statSum(logs,'price_check','failed');
    const avgRun=_statAvg(logs,'price_check','ms');
    const cov=_statCoverage(parts);
    const priceRows=[
      ['Price-check runs',runs],['Parts checked',checked],['Prices found',found],
      ['Lookups failed',failedParts],
      ['Hit rate',checked?_statFmtPct(100*found/checked):'—'],
      ['Avg run time',_statFmtMs(avgRun)],
      ['Parts in Database (now)',cov.total],
      ['Parts with a price (now)',cov.withPrice],
      ['Price coverage (now)',_statFmtPct(cov.pct)],
    ];
    out += _statBlock('pricing','Pricing',
      `Runs are from the audit trail (${rangeLabel}); coverage is the Database as it stands now`,
      `<div class="stat-tiles">
        ${_statTile('Price-check runs',_statFmtNum(runs))}
        ${_statTile('Parts checked',_statFmtNum(checked))}
        ${_statTile('Hit rate',checked?_statFmtPct(100*found/checked):'—')}
        ${_statTile('Avg run time',_statFmtMs(avgRun), avgRun==null?'measured from v1.37 onward':'')}
        ${_statTile('Price coverage',_statFmtPct(cov.pct),'Database, now')}
      </div>
      <div class="stat-sub">Price coverage per drawing — Database, now</div>
      ${_statTable(['Drawing','Parts','Priced','Coverage'],
        cov.byDrawing.slice(0,25).map(d=>[d.drawing,d.parts,d.priced,_statFmtPct(d.pct)]))}`,
      ['Metric','Value'], priceRows);

    // ── People ──────────────────────────────────────────────────────────────
    const logins=_statPerDay(logs,'login');
    const byUser=_statPerUser(logs,'login');
    const screens=_statPerUser(logs.map(l=>l.action==='screen_open'
      ? {...l, user:_statDetails(l).screen||'?'} : l), 'screen_open');
    out += _statBlock('people','People',`Audit trail · ${rangeLabel}`,
      `<div class="stat-tiles">
        ${_statTile('Sign-ins',_statFmtNum(_statCount(logs,'login')))}
        ${_statTile('People who signed in',_statFmtNum(byUser.length))}
        ${_statTile('Screens opened',_statFmtNum(_statCount(logs,'screen_open')))}
      </div>
      <div class="stat-sub">Sign-ins per day</div>
      ${_statBars(logins)}
      <div class="stat-sub">Sign-ins per person</div>
      ${_statBars(byUser)}
      <div class="stat-sub">Most opened screens</div>
      ${_statBars(screens.slice(0,10))}`,
      ['Person','Sign-ins'], byUser.map(([u,c])=>[u,c]));
  }

  // ── Current state ─────────────────────────────────────────────────────────
  const nowRows=[
    ['Parts in Database',counts.parts],['Customers',counts.customers],
    ['RFQs / projects',counts.projects],['Users',counts.users],['Roles',counts.roles],
  ].filter(r=>r[1]!=null);
  out += _statBlock('now','System — right now',
    'Live counts. Not affected by the date range above: these are totals as they stand today.',
    countErr
      ? `<p style="color:#9B1C1C;font-size:12px">${esc(countErr)}</p>`
      : `<div class="stat-tiles">
          ${_statTile('Parts in Database',_statFmtNum(counts.parts))}
          ${_statTile('Customers',_statFmtNum(counts.customers))}
          ${_statTile('RFQs',_statFmtNum(counts.projects))}
          ${_statTile('Users',_statFmtNum(counts.users))}
          ${_statTile('Roles',_statFmtNum(counts.roles))}
        </div>`,
    ['Metric','Value'], nowRows);

  return out;
}

// ── Export. SheetJS, already loaded for every other spreadsheet in the app. ──
export function _statSheetName(s){ return String(s||'Sheet').replace(/[\\/?*\[\]:]/g,' ').slice(0,31); }
export function _statExportBlock(key){
  const b=_statBlocks[key];
  if(!b){ toast('Nothing to export in that block','error'); return; }
  if(!window.XLSX){ toast('Excel library not loaded — please reload the page','error'); return; }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet(_statSheetRows(b)), _statSheetName(b.title));
  XLSX.writeFile(wb,`SpecPrice ${b.title} ${_statIsoDay(_statFrom)}_${_statIsoDay(_statTo)}.xlsx`);
  toast(`${b.title} exported`,'success');
}
export function _statExportAll(){
  const keys=Object.keys(_statBlocks);
  if(!keys.length){ toast('Nothing to export yet','error'); return; }
  if(!window.XLSX){ toast('Excel library not loaded — please reload the page','error'); return; }
  const wb=XLSX.utils.book_new();
  keys.forEach(k=>XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet(_statSheetRows(_statBlocks[k])), _statSheetName(_statBlocks[k].title)));
  XLSX.writeFile(wb,`SpecPrice Statistics ${_statIsoDay(_statFrom)}_${_statIsoDay(_statTo)}.xlsx`);
  toast('Dashboard exported','success');
  logAudit('statistics_export',{blocks:keys.length,from:_statIsoDay(_statFrom),to:_statIsoDay(_statTo)},true);
}
// Every sheet states the range it covers — a figure without its window is a
// number nobody can check later.
export function _statSheetRows(b){
  return [[b.title],[`Range: ${_statFmtDate(_statFrom)} – ${_statFmtDate(_statTo)}`],[],
          b.columns, ...b.rows];
}
