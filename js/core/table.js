// ══════════════════════════════════════════════════════════════════════════════
// PART STOCK
// ══════════════════════════════════════════════════════════════════════════════
// ── Resizable columns ──────────────────────────────────────────────────────
// Dragging a header's right edge sets that column's width; the columns after
// it move with it (the table grows or shrinks), the way a spreadsheet does.
// To get there the table is switched to a fixed layout on the first drag: every
// column is pinned at the width it has on screen, so changing one changes only
// that one. (In the automatic layout a narrower column just handed its space to
// the others or refused to shrink below its content, and the frozen columns
// kept their old places — the empty gaps.) With a storageKey the widths of the
// <th data-col> columns are remembered per browser and put back on every
// re-render (sort, reorder, Compact/Full, a new drawing).
export const MIN_COL_W = 40;
export function loadColWidths(storageKey){
  if(!storageKey) return {};
  try{ const o=JSON.parse(localStorage.getItem('colWidths_'+storageKey)||'{}'); return o && typeof o==='object' ? o : {}; }catch{ return {}; }
}
export function saveColWidths(storageKey, widths){
  if(!storageKey) return;
  try{ localStorage.setItem('colWidths_'+storageKey, JSON.stringify(widths)); }catch{}
}
// Pins every column at its current on-screen width (stored widths win) and
// switches the table to table-layout:fixed. Returns the widths, in column order.
export function lockTableLayout(table, stored={}){
  const ths=[...(table.tHead?.rows[0]?.cells||[])];
  const ws=ths.map(th=>{
    const k=th.dataset && th.dataset.col;
    const sw=k && parseFloat(stored[k]);
    return sw>0 ? Math.max(MIN_COL_W, sw) : th.getBoundingClientRect().width;
  });
  ths.forEach((th,i)=>{ th.style.width=ws[i]+'px'; th.style.minWidth=''; th.style.maxWidth=''; });
  table.classList.add('cols-fixed');
  table.style.tableLayout='fixed';
  table.style.width=ws.reduce((a,b)=>a+b,0)+'px';
  return ws;
}
export function makeTableResizable(table, storageKey){
  if(!table) return;
  const stored=loadColWidths(storageKey);
  const head=table.tHead && table.tHead.rows[0];
  let ws=null;
  // Remembered widths go back on now, if the table already has rows to measure;
  // otherwise on the first drag.
  if(head && Object.keys(stored).length && table.tBodies[0] && table.tBodies[0].querySelector('tr:not(.empty-row)')) ws=lockTableLayout(table, stored);
  table.querySelectorAll('thead th').forEach((th,ci)=>{
    if(th.querySelector('.col-resizer')) return;
    const r=document.createElement('div');
    r.className='col-resizer';
    r.draggable=false;
    r.title='Drag to change the width';
    r.addEventListener('dragstart',e=>e.preventDefault());
    th.appendChild(r);
    r.addEventListener('click',e=>{e.stopPropagation();e.preventDefault();});
    let x0=0,w0=0,dragged=false;
    r.addEventListener('mousedown',e=>{
      if(!table.classList.contains('cols-fixed') || !ws) ws=lockTableLayout(table, loadColWidths(storageKey));
      x0=e.clientX; w0=ws[ci]; dragged=false;
      document.body.classList.add('col-resizing');
      const move=ev=>{
        dragged=true;
        const w=Math.max(Math.min(MIN_COL_W,w0), Math.round(w0+ev.clientX-x0));
        ws[ci]=w;
        th.style.width=w+'px';
        table.style.width=ws.reduce((a,b)=>a+b,0)+'px';
      };
      const up=()=>{
        document.removeEventListener('mousemove',move);
        document.removeEventListener('mouseup',up);
        document.body.classList.remove('col-resizing');
        if(dragged){
          const k=th.dataset && th.dataset.col;
          if(k && storageKey){ const all=loadColWidths(storageKey); all[k]=ws[ci]; saveColWidths(storageKey, all); }
          // The mouseup that ends a drag almost never lands back on the thin
          // resizer strip — it lands on the header cell itself, so the browser
          // fires a native "click" on the th right after this handler returns,
          // which would otherwise trigger a column sort and wipe the resize on
          // re-render. Swallow that one trailing click.
          const suppressClick=ce=>{
            ce.stopPropagation(); ce.preventDefault();
            document.removeEventListener('click',suppressClick,true);
          };
          document.addEventListener('click',suppressClick,true);
          setTimeout(()=>document.removeEventListener('click',suppressClick,true),0);
        }
      };
      document.addEventListener('mousemove',move);
      document.addEventListener('mouseup',up);
      e.preventDefault(); e.stopPropagation();
    });
  });
}

// ── Column order persistence (per browser) ────────────────────────────────
export function loadColOrder(storageKey, defaultCols){
  try{
    const saved=JSON.parse(localStorage.getItem('colOrder_'+storageKey)||'null');
    if(Array.isArray(saved) && saved.length){
      const byKey=Object.fromEntries(defaultCols.map(c=>[c.k,c]));
      const ordered=saved.filter(k=>byKey[k]).map(k=>byKey[k]);
      // A column added since the user last dragged their layout used to be
      // appended at the far RIGHT. That silently broke pairings that only make
      // sense side by side — Mouser Stock ended up nowhere near Mouser Price.
      // Insert each new column after the neighbour it follows by default, so a
      // saved layout keeps the user's choices AND stays coherent.
      defaultCols.forEach((c,di)=>{
        if(saved.includes(c.k)) return;
        const prev = di>0 ? defaultCols[di-1].k : null;
        const at = prev ? ordered.findIndex(o=>o.k===prev) : -1;
        if(at>=0) ordered.splice(at+1, 0, c);
        else ordered.splice(Math.min(di, ordered.length), 0, c);
      });
      if(ordered.length===defaultCols.length) return ordered;
    }
  }catch{}
  return defaultCols;
}
export function saveColOrder(storageKey, cols){
  try{ localStorage.setItem('colOrder_'+storageKey, JSON.stringify(cols.map(c=>c.k))); }catch{}
}
// Makes <th data-col="..."> headers in `table` drag-reorderable; on drop, reorders
// `cols` (array of {k,l,...}), persists the new order under storageKey, and calls
// rerenderFn() so the table redraws with the new column order.
export function makeColumnsReorderable(table, storageKey, cols, rerenderFn){
  if(!table) return;
  table.querySelectorAll('thead th[data-col]').forEach(th=>{
    th.draggable=true;
    th.addEventListener('dragstart',e=>{
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', th.dataset.col);
      th.classList.add('col-dragging');
    });
    th.addEventListener('dragend',()=>th.classList.remove('col-dragging'));
    th.addEventListener('dragover',e=>{ e.preventDefault(); th.classList.add('col-drop-target'); });
    th.addEventListener('dragleave',()=>th.classList.remove('col-drop-target'));
    th.addEventListener('drop',e=>{
      e.preventDefault(); e.stopPropagation();
      th.classList.remove('col-drop-target');
      const fromKey=e.dataTransfer.getData('text/plain');
      const toKey=th.dataset.col;
      if(!fromKey||fromKey===toKey) return;
      const newCols=[...cols];
      const fromIdx=newCols.findIndex(c=>c.k===fromKey);
      const toIdx=newCols.findIndex(c=>c.k===toKey);
      if(fromIdx<0||toIdx<0) return;
      const [moved]=newCols.splice(fromIdx,1);
      newCols.splice(toIdx,0,moved);
      saveColOrder(storageKey,newCols);
      rerenderFn();
    });
  });
}
// Keeps the first `count` columns of a table in place while the rest scroll
// sideways (position:sticky; left:…). The offsets are measured from the header
// cells, so they follow column resizing, reordering and Compact/Full, and they
// are re-applied whenever the body is re-rendered. Cells that span several
// columns (the drawing group rows) are left alone. If the frozen block would
// take more than `maxShare` of the visible width (a narrow window), columns are
// dropped from its right end until it fits — otherwise nothing could scroll.
export function freezeLeftColumns(table, count, maxShare=0.75){
  if(!table || !(count>0)) return;
  const wrap=table.closest('.table-wrap')||table.parentElement;
  const head=table.tHead && table.tHead.rows[0];
  if(!head) return;
  table.classList.add('has-frozen');
  const apply=()=>{
    const ths=[...head.cells];
    const avail=(wrap && wrap.clientWidth) || 0;
    // Fractional positions (getBoundingClientRect), not offsetLeft: offsetLeft is
    // rounded, and half a pixel between two frozen cells lets the scrolled
    // text show through as a thin stripe.
    // Positions are the running sum of the WIDTHS. Reading where a header cell
    // is would be wrong once the table has scrolled: a frozen cell is then
    // where it is stuck, not where it belongs, and after a resize the next
    // frozen column kept its old place and left an empty gap.
    const widths=ths.map(th=>th.getBoundingClientRect().width);
    const lefts=[]; let acc=0;
    for(const w of widths){ lefts.push(acc); acc+=w; }
    let n=Math.min(count, ths.length);
    while(n>1 && avail && (lefts[n-1]+widths[n-1]) > avail*maxShare) n--;
    if(n===1 && avail && widths[0] > avail*maxShare) n=0;
    for(const tr of table.rows){
      let col=0;
      for(const cell of tr.cells){
        const span=cell.colSpan||1;
        const frozen = span===1 && col<n;
        cell.classList.toggle('col-frozen', frozen);
        cell.classList.toggle('col-frozen-last', frozen && col===n-1);
        if(frozen) cell.style.left=lefts[col]+'px';
        else if(cell.style.left) cell.style.left='';
        col+=span;
      }
    }
  };
  let queued=false;
  const later=()=>{ if(queued) return; queued=true; (globalThis.requestAnimationFrame||setTimeout)(()=>{ queued=false; apply(); }); };
  if(table._freeze){ table._freeze.ro && table._freeze.ro.disconnect(); table._freeze.mo && table._freeze.mo.disconnect(); }
  const RO=globalThis.ResizeObserver, MO=globalThis.MutationObserver;
  const ro = typeof RO==='function' ? new RO(later) : null;
  if(ro){ [...head.cells].slice(0,count+1).forEach(th=>ro.observe(th)); if(wrap) ro.observe(wrap); }
  const mo = typeof MO==='function' ? new MO(later) : null;
  if(mo) [...table.tBodies].forEach(tb=>mo.observe(tb,{childList:true}));
  table._freeze={ro,mo,apply};
  apply();
}
// Wires up ◀/▶ buttons (if present in the DOM) to scroll a .table-wrap horizontally.
export function wireScrollButtons(wrapEl, leftBtnId, rightBtnId){
  const wrap = typeof wrapEl==='string' ? document.querySelector(wrapEl) : wrapEl;
  const leftBtn=document.getElementById(leftBtnId), rightBtn=document.getElementById(rightBtnId);
  if(!wrap||!leftBtn||!rightBtn) return;
  leftBtn.addEventListener('click',()=>wrap.scrollBy({left:-220,behavior:'smooth'}));
  rightBtn.addEventListener('click',()=>wrap.scrollBy({left:220,behavior:'smooth'}));
}
// Wires a "✕" clear button next to a search input (both passed by id): shows the
// button only while the input has text, and clicking it empties the input, fires a
// synthetic 'input' event (so the existing debounced filter/search listener re-runs),
// and refocuses the field.
export function wireSearchClear(inputId, clearId){
  const inp=document.getElementById(inputId), clearBtn=document.getElementById(clearId);
  if(!inp||!clearBtn) return;
  const sync=()=>clearBtn.classList.toggle('show', !!inp.value);
  sync();
  inp.addEventListener('input', sync);
  clearBtn.addEventListener('click', ()=>{
    inp.value='';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.focus();
  });
}
// Shift-click range selection for a table's row checkboxes: click one checkbox, then
// shift-click another — every checkbox in between (inclusive) is set to match the
// checked state of the one just clicked. Uses event delegation on `container` so it
// keeps working across re-renders of the checkboxes inside it (e.g. Sales Desk rows
// re-rendered by renderSD()) without needing to be re-wired each time.
export function wireShiftCheck(container, checkboxSelector){
  if(!container) return;
  let lastIdx=null;
  container.addEventListener('click',e=>{
    const cb=e.target.closest(checkboxSelector);
    if(!cb) return;
    const all=[...container.querySelectorAll(checkboxSelector)];
    const idx=all.indexOf(cb);
    if(e.shiftKey && lastIdx!==null && idx>=0){
      const [from,to]=lastIdx<idx?[lastIdx,idx]:[idx,lastIdx];
      const state=cb.checked;
      for(let i=from;i<=to;i++) all[i].checked=state;
    }
    lastIdx=idx;
  });
}

// ── Boolean search (AND / OR / NOT / parentheses / "quoted phrases") ──────────
// Matches a free-text query against a lowercase haystack string built from all
// searchable field values of a row. Bare terms separated by whitespace are
// implicitly AND-ed; explicit AND/OR/NOT and parentheses are also supported.
export function _tokenizeBoolQuery(q){
  const tokens=[]; const re=/\(|\)|"[^"]*"|[^\s()]+/g; let m;
  while((m=re.exec(q))!==null){
    const raw=m[0];
    if(raw==='(') tokens.push({type:'LPAREN'});
    else if(raw===')') tokens.push({type:'RPAREN'});
    else if(/^AND$/i.test(raw)) tokens.push({type:'AND'});
    else if(/^OR$/i.test(raw)) tokens.push({type:'OR'});
    else if(/^NOT$/i.test(raw)) tokens.push({type:'NOT'});
    else{
      let val=raw;
      if(val.startsWith('"')&&val.endsWith('"')&&val.length>=2) val=val.slice(1,-1);
      tokens.push({type:'TERM', value:val});
    }
  }
  return tokens;
}
export function parseBoolQuery(query){
  const q=(query||'').trim();
  if(!q) return ()=>true;
  const tokens=_tokenizeBoolQuery(q);
  let pos=0;
  const peek=()=>tokens[pos];
  const next=()=>tokens[pos++];
  const startsOperand=t=>t && (t.type==='TERM'||t.type==='LPAREN'||t.type==='NOT');
  function parseOr(){
    let left=parseAnd();
    while(peek() && peek().type==='OR'){
      next(); const right=parseAnd(); const l=left; left=h=>l(h)||right(h);
    }
    return left;
  }
  function parseAnd(){
    let left=parseNot();
    while(peek() && (peek().type==='AND' || startsOperand(peek()))){
      if(peek().type==='AND') next();
      const right=parseNot(); const l=left; left=h=>l(h)&&right(h);
    }
    return left;
  }
  function parseNot(){
    if(peek() && peek().type==='NOT'){ next(); const operand=parseNot(); return h=>!operand(h); }
    return parseAtom();
  }
  function parseAtom(){
    const t=next();
    if(!t) return ()=>true;
    if(t.type==='LPAREN'){
      const inner=parseOr();
      if(peek() && peek().type==='RPAREN') next();
      return inner;
    }
    if(t.type==='TERM'){
      const term=t.value.toLowerCase();
      return h=>h.includes(term);
    }
    return ()=>true;
  }
  try{
    const predicate=parseOr();
    return h=>predicate(h);
  }catch{ return h=>h.includes(q.toLowerCase()); }
}
