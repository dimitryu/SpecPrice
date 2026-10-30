import { logAudit } from '../core/audit.js';
import { route } from '../core/router.js';
import { loadColOrder, makeColumnsReorderable, makeTableResizable, parseBoolQuery, wireScrollButtons, wireSearchClear, wireShiftCheck } from '../core/table.js';
import { closeModal, debounce, esc, fmtDate, setActions, setContent, showModal, toast } from '../core/ui.js';
import { listCustomers } from '../data/customers.js';
import { createProject, deleteDrawing, deleteProject, listDrawings, listProjects, listProjectsNewestFirst, removeDrawingItems } from '../data/projects.js';
import { openAddDrawingModal } from './bomImport.js';
import { exportBOMExcel } from './salesDesk/export.js';

// ══════════════════════════════════════════════════════════════════════════════
// RFQ LIST
// ══════════════════════════════════════════════════════════════════════════════
export let _rfqCustFilter='';
export async function renderRFQList(){
  setContent(`<div style="text-align:center;padding:60px;color:var(--muted)"><div class="ring" style="margin:0 auto 12px"></div>Loading RFQs…</div>`);
  setActions(`<button class="btn btn-green" id="btn-new-rfq">＋ New RFQ</button>`);

  document.getElementById('btn-new-rfq').addEventListener('click', createRFQ);

  let projects=[];
  try { projects=await listProjectsNewestFirst(); }
  catch(e2){ setContent(`<p style="color:red;padding:20px">${e2.message}</p>`); return; }

  if(!projects.length){
    setContent(`<div style="text-align:center;padding:80px;color:var(--muted)">
      <div style="font-size:48px;margin-bottom:12px">📋</div>
      <div>No RFQs yet. Click <strong>＋ New RFQ</strong> to create one.</div></div>`);
    return;
  }

  const customers=[...new Set(projects.map(p=>p.customer_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(_rfqCustFilter && !customers.includes(_rfqCustFilter)) _rfqCustFilter='';
  const filtered = _rfqCustFilter ? projects.filter(p=>p.customer_name===_rfqCustFilter) : projects;

  // Group RFQs by customer (alphabetical order; RFQs without a customer form a
  // "No Customer" group shown last). Order of RFQs within each group is preserved
  // from `filtered` (already sorted by updatedAt desc from the query above).
  const groupsMap={};
  filtered.forEach(p=>{
    const key=p.customer_name||'';
    (groupsMap[key]=groupsMap[key]||[]).push(p);
  });
  // Within each customer group, RFQs are sorted alphabetically (A→Z) by name.
  Object.keys(groupsMap).forEach(key=>{
    groupsMap[key].sort((a,b)=>String(a.name||a._id||'').localeCompare(String(b.name||b._id||'')));
  });
  const groupKeys=Object.keys(groupsMap).sort((a,b)=>{
    if(!a) return 1; if(!b) return -1;
    return a.localeCompare(b);
  });

  setContent(`
    <div class="toolbar">
      ${customers.length>1?`
      <label style="font-size:12px;color:var(--muted);white-space:nowrap">Filter by Customer:</label>
      <select id="rfq-cust-filter" class="search-box" style="flex:0 0 auto;max-width:280px;padding:5px 9px">
        <option value="">All Customers (${customers.length})</option>
        ${customers.map(c=>`<option value="${esc(c)}" ${c===_rfqCustFilter?'selected':''}>${esc(c)}</option>`).join('')}
      </select>`:''}
      <span class="count-badge">${filtered.length} RFQs</span>
    </div>
    ${groupKeys.map(key=>`
      <div class="rfq-group">
        <div style="display:flex;align-items:center;gap:8px;margin:16px 0 8px;padding-bottom:6px;border-bottom:1.5px solid var(--border)">
          <h3 style="font-size:13px;font-weight:700;color:var(--blue-dark);text-transform:uppercase;letter-spacing:.4px;margin:0">${key?esc(key):'No Customer'}</h3>
          <span class="count-badge">${groupsMap[key].length}</span>
        </div>
        <div class="card-grid">
        ${groupsMap[key].map(p=>`
          <div class="rfq-card" data-id="${esc(p._id)}">
            <div class="rfq-card-icon">📋</div>
            <div class="rfq-card-body">
              <h3>${esc(p.name||p._id)}</h3>
              <p>${fmtDate(p.updatedAt)||'—'}</p>
            </div>
            <button class="btn btn-red btn-sm del-rfq" data-id="${esc(p._id)}" data-name="${esc(p.name||p._id)}"
              title="Delete" style="flex-shrink:0;align-self:center">✕</button>
          </div>`).join('')}
        </div>
      </div>`).join('')}
    `);

  document.getElementById('rfq-cust-filter')?.addEventListener('change',e=>{
    _rfqCustFilter=e.target.value;
    renderRFQList();
  });
  document.querySelectorAll('.rfq-card').forEach(el=>{
    el.addEventListener('click',e=>{if(!e.target.classList.contains('del-rfq')) renderRFQDetail(el.dataset.id, el.querySelector('h3').textContent);});
  });
  document.querySelectorAll('.del-rfq').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation(); deleteRFQ(btn.dataset.id, btn.dataset.name);});
  });
}

export async function createRFQ(){
  // Load customers + existing projects
  let customers=[], allProjects=[];
  try {
    [customers, allProjects]=await Promise.all([listCustomers(), listProjects()]);
  } catch(e){ toast('Error: '+e.message,'error'); return; }

  if(!customers.length){
    if(confirm('No customers yet. Go to Customers to add one first?')) route('customers');
    return;
  }

  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>New RFQ</h3><button class="close-modal" id="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field">
        <label>Customer</label>
        <select class="form-input" id="rfq-cust-sel">
          <option value="">— Select customer —</option>
          ${customers.map(c=>`<option value="${c._id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field" style="margin-top:10px">
        <label>RFQ Name (auto-generated)</label>
        <input class="form-input" id="rfq-name-prev" readonly
          style="background:#F7FAFC;color:var(--blue-dark);font-weight:700;letter-spacing:.5px"
          placeholder="Select a customer first…">
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-green" id="btn-confirm-rfq" disabled>✓ Create RFQ</button>
    </div>
  </div>`);

  document.getElementById('modal-close').addEventListener('click',closeModal);
  document.getElementById('modal-cancel').addEventListener('click',closeModal);

  const sel=document.getElementById('rfq-cust-sel');
  const prev=document.getElementById('rfq-name-prev');
  const confirmBtn=document.getElementById('btn-confirm-rfq');

  function calcName(custId, custName){
    const existing=allProjects.filter(p=>p.customer_id===custId
      ||(p.name||'').toLowerCase().startsWith(custName.toLowerCase()+'-'));
    let maxN=0;
    existing.forEach(p=>{const m=(p.name||'').match(/-0*(\d+)$/);if(m)maxN=Math.max(maxN,+m[1]);});
    return `${custName}-${String(maxN+1).padStart(3,'0')}`;
  }

  sel.addEventListener('change',()=>{
    const custId=sel.value;
    const custName=sel.selectedOptions[0]?.dataset.name||'';
    if(!custId){prev.value='';confirmBtn.disabled=true;return;}
    const rfqName=calcName(custId,custName);
    prev.value=rfqName;
    confirmBtn.disabled=false;
    confirmBtn.dataset.custid=custId;
    confirmBtn.dataset.custname=custName;
    confirmBtn.dataset.rfqname=rfqName;
  });

  confirmBtn.addEventListener('click',async()=>{
    const{custid:custId,custname:custName,rfqname:rfqName}=confirmBtn.dataset;
    if(!custId||!rfqName) return;
    try {
      confirmBtn.disabled=true; confirmBtn.textContent='Creating…';
      const newId=await createProject({ name:rfqName, customer_id:custId, customer_name:custName });
      toast('RFQ created','success');
      logAudit('rfq_created',{name:rfqName},true);
      closeModal();
      renderRFQDetail(newId,rfqName);
    } catch(e){ toast('Error: '+e.message,'error'); logAudit('rfq_created',{error:e.message},false); confirmBtn.disabled=false; confirmBtn.textContent='✓ Create RFQ'; }
  });
}

export async function deleteRFQ(id, name){
  if(!confirm(`Delete RFQ "${name}"? This removes all drawings.`)) return;
  try {
    await deleteProject(id);   // its drawings first, then the RFQ
    toast('RFQ deleted','success');
    logAudit('rfq_deleted',{name},true);
    renderRFQList();
  } catch(e){ toast('Error: '+e.message,'error'); logAudit('rfq_deleted',{error:e.message},false); }
}

// ══════════════════════════════════════════════════════════════════════════════
// RFQ DETAIL  (show drawings – each drawing has items[] array)
// ══════════════════════════════════════════════════════════════════════════════
export async function renderRFQDetail(projectId, projectName, searchQ=''){
  setContent(`<div style="text-align:center;padding:60px;color:var(--muted)"><div class="ring" style="margin:0 auto 12px"></div>Loading BOM…</div>`);
  setActions(`
    <button class="btn btn-blue" id="btn-add-drawing">＋ Add Drawing</button>
    <button class="btn btn-green" id="btn-bom-export">📊 Export to Excel</button>
    <button class="btn btn-red" id="btn-bom-del-sel">🗑 Delete Selected</button>
    <button class="btn btn-ghost" id="btn-back-rfq">← Back</button>`);

  document.getElementById('btn-back-rfq').addEventListener('click', renderRFQList);
  document.getElementById('btn-add-drawing').addEventListener('click',
    () => openAddDrawingModal(projectId, projectName));

  document.getElementById('page-title').textContent = `📋 ${projectName}`;

  let drawings=[];
  try {
    drawings=await listDrawings(projectId);
    drawings.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  } catch(e){
    setContent(`<p style="color:red;padding:20px">Error loading BOM: ${e.message}</p>`);
    return;
  }

  // Flatten items from all drawings.
  // Desktop app stores: { name, items:[{item,part_number,...}] }
  // Old web format stored individual docs with BOM fields directly – handle both.
  const allRows = [];
  for(const dwg of drawings){
    if(Array.isArray(dwg.items) && dwg.items.length > 0){
      dwg.items.forEach((it,idx)=>allRows.push({...it, _dwgId:dwg._id, _dwgName:dwg.name||'', _idx:idx, _fmt:'arr'}));
    } else if(dwg.part_number || dwg.description || dwg.drawing_number){
      // Old format: document IS the BOM row
      allRows.push({...dwg, _dwgId:dwg._id, _dwgName:'', _idx:-1, _fmt:'doc'});
    }
  }
  // Sort: drawing name first (keeps groups together), then item number within each drawing
  allRows.sort((a,b)=>{
    const nc=String(a._dwgName||'').localeCompare(String(b._dwgName||''));
    if(nc!==0) return nc;
    return (parseInt(a.item)||0)-(parseInt(b.item)||0);
  });

  const _BOM_DEFAULT_COLS=[
    {k:'item',          l:'Item',        w:'45px'},
    {k:'drawing_number',l:'Drawing #',   w:'110px'},
    {k:'revision',      l:'Revision',    w:'90px'},
    {k:'part_number',   l:'MNF P/N',      w:'130px'},
    {k:'atlantium_pn',  l:'Cust PN',     w:'100px'},
    {k:'description',   l:'Description', w:'210px',wrap:true},
    {k:'qty',           l:'QTY',         w:'55px'},
    {k:'unit',          l:'Units',       w:'55px'},
    {k:'manufacturer',  l:'Manufacturer',w:'110px'},
    {k:'pin_count',       l:'Pins',           w:'55px'},
  ];
  const BOM_COLS=loadColOrder('bom',_BOM_DEFAULT_COLS);
  const bomColspan=BOM_COLS.length+2;

  // Boolean text search (AND/OR/NOT/"phrase"/(...)) across all BOM columns
  const _bomPredicate=parseBoolQuery(searchQ);
  const allRowsFiltered=(searchQ||'').trim()
    ? allRows.filter(r=>_bomPredicate(_BOM_DEFAULT_COLS.map(c=>String(r[c.k]||'')).join(' | ').toLowerCase()))
    : allRows;

  // Unique drawing names for filter
  const uniqueDwgs = [...new Set(allRowsFiltered.map(r=>r._dwgName).filter(Boolean))];

  // Build rows with drawing-name group headers + data-dwg attributes for filtering
  let lastDwgName = null;
  const rowsHtml = allRowsFiltered.map((row,ri)=>{
    let header = '';
    if(row._dwgName && row._dwgName !== lastDwgName){
      lastDwgName = row._dwgName;
      header = `<tr data-dwg="${esc(row._dwgName)}" class="dwg-grp-hdr" style="background:var(--blue-light)"><td colspan="${bomColspan}" style="font-weight:700;color:var(--blue-dark);padding:5px 9px;border-right:none"><span class="dwg-toggle" style="cursor:pointer;user-select:none;display:inline-block;width:14px;text-align:center;font-size:11px;margin-right:5px;color:var(--blue-mid)" title="Collapse/expand">▼</span>📄 ${esc(row._dwgName)}</td></tr>`;
    }
    return header + `<tr data-dwg="${esc(row._dwgName)}">
      <td style="text-align:center"><input type="checkbox" class="bom-check" data-dwgid="${esc(row._dwgId)}" data-idx="${row._idx}" data-fmt="${row._fmt}"></td>
      ${BOM_COLS.map(c=>{
        // Drawing # fallback: if empty, show the drawing container name
        let val=row[c.k]||'';
        if(c.k==='drawing_number'&&!val) val=row._dwgName||'';
        return `<td${c.wrap?' class="wrap"':''}>${esc(val)}</td>`;
      }).join('')}
      <td><button class="btn btn-red btn-sm del-row" data-dwgid="${esc(row._dwgId)}" data-idx="${row._idx}" data-fmt="${row._fmt}" title="Delete row">✕</button></td>
    </tr>`;
  }).join('');

  const filterOpts = uniqueDwgs.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  setContent(`
    <div class="toolbar" style="margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="btn-collapse-all" style="white-space:nowrap;flex-shrink:0">▶ Collapse All</button>
      <div class="search-wrap">
        <input class="search-box" id="bom-search" placeholder='Search — supports AND / OR / NOT / "phrase" / (...)' value="${esc(searchQ)}">
        <button type="button" class="search-clear" id="bom-search-clear" title="Clear">✕</button>
      </div>
      <button class="tbl-scroll-btn" id="bom-scroll-left" title="Scroll left">◀</button>
      <button class="tbl-scroll-btn" id="bom-scroll-right" title="Scroll right">▶</button>
      ${uniqueDwgs.length>1?`
      <label style="font-size:12px;color:var(--muted);white-space:nowrap">Filter by Drawing:</label>
      <select id="dwg-filter" class="search-box" style="flex:0 0 auto;max-width:280px;padding:5px 9px">
        <option value="">All Drawings (${uniqueDwgs.length})</option>
        ${filterOpts}
      </select>`:''}
      <span class="count-badge" id="bom-flt-count">${allRowsFiltered.length} parts</span>
    </div>
    <div class="table-wrap" id="bom-table-wrap"><table id="bom-table">
      <thead><tr><th style="width:28px"><input type="checkbox" id="bom-check-all" title="Select all"></th>${BOM_COLS.map(c=>`<th data-col="${c.k}" style="min-width:${c.w}" title="Drag to reorder">${c.l}</th>`).join('')}<th style="width:40px"></th></tr></thead>
      <tbody id="bom-tbody">${rowsHtml||`<tr class="empty-row"><td colspan="${bomColspan}">No BOM rows yet. Click ＋ Add Drawing to import.</td></tr>`}</tbody>
    </table></div>
    <div style="margin-top:8px;font-size:11px;color:var(--muted)">${allRowsFiltered.length} parts across ${drawings.length} drawing(s)</div>`);

  // Drawing group collapse/expand (per-group toggle)
  document.querySelectorAll('.dwg-grp-hdr').forEach(hdr=>{
    hdr.querySelector('.dwg-toggle')?.addEventListener('click',e=>{
      const dwg=hdr.dataset.dwg;
      const arrow=e.currentTarget;
      const collapsing=arrow.textContent.trim()==='▼';
      arrow.textContent=collapsing?'▶':'▼';
      document.querySelectorAll('#bom-tbody tr:not(.dwg-grp-hdr)').forEach(tr=>{
        if(tr.dataset.dwg===dwg) tr.style.display=collapsing?'none':'';
      });
    });
  });

  // Collapse All / Expand All toggle
  let _allCollapsed=false;
  document.getElementById('btn-collapse-all')?.addEventListener('click',e=>{
    _allCollapsed=!_allCollapsed;
    document.querySelectorAll('.dwg-grp-hdr').forEach(hdr=>{
      const arrow=hdr.querySelector('.dwg-toggle');
      if(arrow) arrow.textContent=_allCollapsed?'▶':'▼';
      const dwg=hdr.dataset.dwg;
      document.querySelectorAll('#bom-tbody tr:not(.dwg-grp-hdr)').forEach(tr=>{
        if(tr.dataset.dwg===dwg) tr.style.display=_allCollapsed?'none':'';
      });
    });
    e.currentTarget.textContent=_allCollapsed?'▼ Expand All':'▶ Collapse All';
  });

  // Drawing filter
  document.getElementById('dwg-filter')?.addEventListener('change',e=>{
    const val=e.target.value;
    document.querySelectorAll('#bom-tbody tr').forEach(tr=>{
      tr.style.display=(!val||tr.dataset.dwg===val)?'':'none';
    });
    const cnt=val?document.querySelectorAll(`#bom-tbody tr[data-dwg="${val}"]:not(.dwg-grp-hdr)`).length:allRowsFiltered.length;
    const el=document.getElementById('bom-flt-count');
    if(el) el.textContent=cnt+' parts';
  });

  // Boolean search box — re-renders BOM view filtered
  const bomSearchInp=document.getElementById('bom-search');
  wireSearchClear('bom-search','bom-search-clear');
  bomSearchInp?.addEventListener('input',debounce(()=>{
    const v=bomSearchInp.value, s=bomSearchInp.selectionStart;
    renderRFQDetail(projectId, projectName, v).then(()=>{
      const ni=document.getElementById('bom-search');
      if(ni){ni.focus();ni.setSelectionRange(s,s);}
    });
  },260));

  makeTableResizable(document.getElementById('bom-table'));
  makeColumnsReorderable(document.getElementById('bom-table'),'bom',BOM_COLS,
    ()=>renderRFQDetail(projectId, projectName, bomSearchInp?.value||''));
  wireScrollButtons('#bom-table-wrap','bom-scroll-left','bom-scroll-right');
  wireShiftCheck(document.getElementById('bom-table'),'.bom-check');

  document.querySelectorAll('.del-row').forEach((btn,ri)=>{
    btn.addEventListener('click', async()=>{
      if(!confirm('Delete this BOM row?')) return;
      const dwgId=btn.dataset.dwgid, idx=parseInt(btn.dataset.idx), fmt=btn.dataset.fmt;
      try {
        if(fmt==='doc'){
          await deleteDrawing(projectId, dwgId);
        } else {
          // Remove item at idx from drawing.items array
          await removeDrawingItems(projectId, dwgId, [idx]);
        }
        toast('Row deleted','success');
        renderRFQDetail(projectId, projectName);
      } catch(e){ toast(e.message,'error'); }
    });
  });

  // Check-all toggle
  document.getElementById('bom-check-all')?.addEventListener('change',e=>{
    document.querySelectorAll('.bom-check').forEach(cb=>cb.checked=e.target.checked);
  });

  // Bulk delete selected rows
  // Export Excel — selected rows only, or every filtered row if none selected
  document.getElementById('btn-bom-export')?.addEventListener('click',()=>{
    const checkedKeys=[...document.querySelectorAll('.bom-check:checked')]
      .map(cb=>cb.dataset.dwgid+'|'+cb.dataset.idx+'|'+cb.dataset.fmt);
    const targets = checkedKeys.length
      ? allRowsFiltered.filter(r=>checkedKeys.includes(r._dwgId+'|'+r._idx+'|'+r._fmt))
      : allRowsFiltered;
    exportBOMExcel(targets, allRowsFiltered.length, BOM_COLS, projectName);
  });

  document.getElementById('btn-bom-del-sel')?.addEventListener('click', async()=>{
    const checked=[...document.querySelectorAll('.bom-check:checked')];
    if(!checked.length){ toast('No rows selected','error'); return; }
    if(!confirm(`Delete ${checked.length} selected row(s)?`)) return;
    const selections=checked.map(cb=>({dwgId:cb.dataset.dwgid, idx:parseInt(cb.dataset.idx), fmt:cb.dataset.fmt}));
    const byDwg={};
    selections.forEach(s=>{ const key=s.dwgId+'|'+s.fmt; (byDwg[key]=byDwg[key]||[]).push(s); });
    try{
      for(const key in byDwg){
        const group=byDwg[key];
        const {dwgId,fmt}=group[0];
        if(fmt==='doc'){
          await deleteDrawing(projectId, dwgId);
        } else {
          await removeDrawingItems(projectId, dwgId, group.map(g=>g.idx));
        }
      }
      toast(`Deleted ${selections.length} row(s)`,'success');
      renderRFQDetail(projectId, projectName);
    }catch(e){ toast('Error: '+e.message,'error'); }
  });
}
