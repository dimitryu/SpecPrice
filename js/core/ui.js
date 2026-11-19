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
  if (el) { el.textContent = msg; el.style.color = 'var(--bad)'; }
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
// A list of steps, each with its state and its own progress bar — for a job
// that runs several stages one after the other (read a drawing → add to Sales
// Desk → save to the Database → check prices), so the user sees which stage is
// running, how far it is, what each finished one did and how long it took.
// stages: [{k, label}]. set(k, {state, text, done, total}) — state is
// 'wait' | 'run' | 'done' | 'warn' | 'skip'. A stage's clock starts the first
// time it is 'run' and stops when it is 'done' or 'warn'; a running stage's
// time counts up live. totalMs() = from the first stage's start to the last
// one's end. mount() redraws it into host (after something else, e.g. a
// column-mapping question, used the same space).
export function fmtDuration(ms){
  if(!(ms>=0)) return '';
  const s=ms/1000;
  if(s<10) return s.toFixed(1)+' s';
  if(s<60) return Math.round(s)+' s';
  const m=Math.floor(s/60), r=Math.round(s-m*60);
  return r===60 ? `${m+1} min` : `${m} min ${String(r).padStart(2,'0')} s`;
}
export function stagesPanel(host, stages){
  const st=stages.map(x=>({state:'wait', text:'', done:0, total:0, pct:null, t0:null, t1:null, ...x}));
  const ICON={wait:'○', run:'', done:'✓', warn:'⚠', skip:'–'};
  const COLOR={wait:'#94A3B8', run:'var(--blue-mid)', done:'#1B6B3A', warn:'#B45309', skip:'#94A3B8'};
  // A monotonic clock: a duration must not jump when the computer's clock is set.
  const now=()=>{ const pf=globalThis.performance; return pf && typeof pf.now==='function' ? pf.now() : Date.now(); };
  let root=null, ticker=null;
  const elapsed=x=>x.t0==null ? null : ((x.t1!=null ? x.t1 : now())-x.t0);
  const rowHTML=x=>{
    const pct = x.pct!=null ? x.pct : (x.total ? Math.round(100*x.done/x.total) : null);
    const showBar = x.state==='run' || (x.state==='done' && pct!=null);
    const ms=elapsed(x);
    return `<div class="stage stage-${x.state}" data-stage="${esc(x.k)}" style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border)">
      <span class="stage-icon" style="width:18px;flex-shrink:0;text-align:center;font-weight:700;color:${COLOR[x.state]}">${x.state==='run'?'<span class="ring" style="width:14px;height:14px;border-width:2px;display:inline-block"></span>':ICON[x.state]}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:10px;align-items:baseline">
          <div style="flex:1;font-size:13px;font-weight:${x.state==='run'?700:600};color:${x.state==='wait'||x.state==='skip'?'var(--muted)':'var(--text)'}">${esc(x.label)}</div>
          ${ms!=null?`<span class="stage-time" title="How long this step took" style="font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;color:${x.state==='run'?'var(--blue-mid)':'var(--muted)'}">⏱ ${fmtDuration(ms)}</span>`:''}
        </div>
        ${x.text||(x.total&&x.state==='run')?`<div class="stage-text" style="font-size:12px;color:var(--muted);margin-top:2px">${esc(x.text||'')}${x.total?` <span style="white-space:nowrap">${x.done} / ${x.total}${pct!=null?` (${pct}%)`:''}</span>`:''}</div>`:''}
        ${showBar?`<div class="progress-bar" style="height:6px;margin-top:5px"><div class="progress-fill" style="width:${pct==null?0:pct}%;transition:width .15s;${x.state==='done'?'background:#1B6B3A':''}"></div></div>`:''}
      </div></div>`;
  };
  // While a stage runs its clock is redrawn every second; it stops by itself.
  const tick=()=>{
    if(!root || !root.isConnected || !st.some(x=>x.state==='run')){ ticker=null; return; }
    api.render(); ticker=setTimeout(tick,1000);
  };
  const api={
    mount(){
      root=document.createElement('div');
      root.className='stages-panel'; root.setAttribute('role','status'); root.setAttribute('aria-live','polite');
      host.innerHTML=''; host.appendChild(root); api.render(); return api;
    },
    render(){ if(root && root.isConnected) root.innerHTML=st.map(rowHTML).join(''); },
    set(k, patch){
      const x=st.find(y=>y.k===k); if(!x) return;
      const was=x.state;
      Object.assign(x, patch);
      if(x.state==='run' && x.t0==null) x.t0=now();
      if((x.state==='done'||x.state==='warn') && was!==x.state){ if(x.t0==null) x.t0=now(); x.t1=now(); }
      api.render();
      if(x.state==='run' && !ticker) ticker=setTimeout(tick,1000);
    },
    get(k){ return st.find(y=>y.k===k); },
    // ms per stage that ran, e.g. {read: 41250, db: 820} — for the log
    times(){ return Object.fromEntries(st.filter(x=>x.t0!=null).map(x=>[x.k, Math.round(elapsed(x))])); },
    totalMs(){
      const ran=st.filter(x=>x.t0!=null); if(!ran.length) return 0;
      return Math.max(...ran.map(x=>x.t1!=null?x.t1:now())) - Math.min(...ran.map(x=>x.t0));
    },
    el(){ return root; },
  };
  return api.mount();
}
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
