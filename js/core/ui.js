// Builds a windowed pager control ("‹ 1 … 4 5 6 … 12 ›") for Part Stock (or any paginated table)
export function _buildPager(page,totalPages,idPrefix){
  if(totalPages<=1) return '';
  const pages=[]; const w=2;
  pages.push(1);
  if(page-w>2) pages.push('…');
  for(let p=Math.max(2,page-w); p<=Math.min(totalPages-1,page+w); p++) pages.push(p);
  if(page+w<totalPages-1) pages.push('…');
  if(totalPages>1) pages.push(totalPages);
  return `<div class="pager" id="${idPrefix}-pager">
    <button class="tbl-scroll-btn pager-btn" data-page="${page-1}" ${page<=1?'disabled':''}>‹</button>
    ${pages.map(p=>p==='…'?`<span class="pager-ellipsis">…</span>`:`<button class="tbl-scroll-btn pager-btn${p===page?' pager-active':''}" data-page="${p}">${p}</button>`).join('')}
    <button class="tbl-scroll-btn pager-btn" data-page="${page+1}" ${page>=totalPages?'disabled':''}>›</button>
  </div>`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// Show error on splash
export function splashErr(msg) {
  const el = document.getElementById('splash-msg');
  if (el) { el.textContent = msg; el.style.color = '#E53E3E'; }
  const ring = document.getElementById('splash-ring');
  if (ring) ring.style.display = 'none';
}
export function splashMsg(msg) {
  const el = document.getElementById('splash-msg');
  if (el) el.textContent = msg;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Escapes for safe embedding in BOTH HTML text content AND double-quoted HTML
// attributes (e.g. data-id="${esc(x)}"). Part numbers/descriptions routinely
// contain a literal " (inch mark, e.g. 3/4", 1/4") — without escaping quotes,
// that " prematurely closes the attribute and corrupts whatever follows it
// (e.g. a checkbox's data-id gets truncated, breaking Delete Selected for that
// row). Must escape & first so the entities below aren't double-escaped.
export function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
export function mkEl(tag,cls='',html=''){const e=document.createElement(tag);if(cls)e.className=cls;if(html)e.innerHTML=html;return e;}
export function fmtPrice(v){const n=parseFloat(v);return isNaN(n)||n===0?'':'$'+n.toFixed(4);}
export function fmtDate(v){if(!v)return'';try{const d=v.toDate?v.toDate():new Date(v);return d.toLocaleDateString('en-GB');}catch{return String(v);}}
export function fmtDateTime(v){if(!v)return'';try{const d=v.toDate?v.toDate():new Date(v);return d.toLocaleDateString('en-GB')+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}catch{return String(v);}}
export function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
export function nowISO(){return new Date().toISOString();}

export let toastTimer;
export function toast(msg,type='info'){
  const el=document.getElementById('toast-el');
  el.textContent=msg; el.className=`toast toast-${type}`; el.style.display='block';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.style.display='none',3500);
}

export function showModal(html){
  closeModal();
  const bg=mkEl('div','modal-bg'); bg.id='modal-bg';
  bg.innerHTML=html; document.body.appendChild(bg);
  bg.addEventListener('click',e=>{if(e.target===bg)closeModal();});
  return bg;
}
export function closeModal(){const m=document.getElementById('modal-bg');if(m)m.remove();}

export function setContent(html){document.getElementById('content').innerHTML=html;}
export function setActions(html){document.getElementById('topbar-actions').innerHTML=html;}

// A progress panel for a long save: a bar plus "12 / 40", so a user saving a
// big BOM can see the work moving and how much is left. Inserted at the top of
// `host`; set(done,total,label) updates it, done(text) shows the finish.
export function progressPanel(host, label){
  const el=document.createElement('div');
  el.className='db-progress';
  el.setAttribute('role','status'); el.setAttribute('aria-live','polite');
  el.innerHTML=`<div class="ai-status"><div class="ring"></div><span class="db-progress-txt"></span></div>
    <div class="progress-bar" style="height:8px"><div class="progress-fill" style="transition:width .15s"></div></div>`;
  host.prepend(el);
  const txt=el.querySelector('.db-progress-txt'), bar=el.querySelector('.progress-fill');
  const api={
    el,
    set(done,total,what){
      const pct=total?Math.round(100*done/total):0;
      bar.style.width=pct+'%';
      txt.textContent= total ? `${what||label||'Saving…'} ${done} / ${total} (${pct}%)` : (what||label||'Saving…');
    },
    note(text){ txt.textContent=text; },
    finish(text){ bar.style.width='100%'; txt.textContent=text||'Done';
      const r=el.querySelector('.ring'); if(r){ r.className=''; r.textContent='✓'; r.style.cssText='color:#1B6B3A;font-weight:700'; } },
  };
  api.set(0,0,label);
  return api;
}
