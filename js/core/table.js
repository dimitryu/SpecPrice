// ══════════════════════════════════════════════════════════════════════════════
// PART STOCK
// ══════════════════════════════════════════════════════════════════════════════
// ── Resizable columns ──────────────────────────────────────────────────────
export function makeTableResizable(table){
  if(!table) return;
  table.querySelectorAll('thead th').forEach((th,ci)=>{
    if(th.querySelector('.col-resizer')) return;
    const r=document.createElement('div');
    r.className='col-resizer';
    r.draggable=false;
    r.addEventListener('dragstart',e=>e.preventDefault());
    th.appendChild(r);
    r.addEventListener('click',e=>{e.stopPropagation();e.preventDefault();});
    let x0=0,w0=0,dragged=false;
    r.addEventListener('mousedown',e=>{
      x0=e.clientX; w0=th.getBoundingClientRect().width; dragged=false;
      const move=ev=>{
        dragged=true;
        const w=Math.max(40,w0+ev.clientX-x0);
        th.style.minWidth=w+'px'; th.style.width=w+'px';
      };
      const up=()=>{
        document.removeEventListener('mousemove',move);
        document.removeEventListener('mouseup',up);
        if(dragged){
          const finalW=th.offsetWidth;
          table.querySelectorAll(`tbody tr > *:nth-child(${ci+1})`).forEach(td=>{
            td.style.whiteSpace='normal';
            td.style.maxWidth=finalW+'px';
            td.style.lineHeight='1.35';
          });
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
