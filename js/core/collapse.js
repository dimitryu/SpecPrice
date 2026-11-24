import { icon } from './icons.js';

// ══════════════════════════════════════════════════════════════════════════════
// Collapsible panels (v1.83.8) — Admin, Settings and Statistics.
// Every `.settings-panel` with a heading (an <h3>, or a Statistics block title)
// gets a toggle: click the heading to fold the panel down to its heading line,
// click again to open it. "Expand all" / "Collapse all" in the top bar do the
// same for every panel on the screen. What is folded is remembered per screen
// in this browser only (localStorage), so nothing is shared or saved to the
// server, and a browser that blocks storage simply starts with all open.
// ══════════════════════════════════════════════════════════════════════════════

function _cpStoreKey(screen){ return 'sp.collapsed.'+screen; }

export function _cpLoad(screen){
  try{
    const raw=globalThis.localStorage?.getItem(_cpStoreKey(screen));
    const v=JSON.parse(raw||'[]');
    return new Set(Array.isArray(v)?v.map(String):[]);
  }catch(e){ return new Set(); }
}
export function _cpSave(screen, set){
  try{ globalThis.localStorage?.setItem(_cpStoreKey(screen), JSON.stringify([...set])); }catch(e){}
}
// A stable name for a panel from its heading text ("🔑 AI API Keys" → "ai-api-keys").
export function _cpSlug(text){
  return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'panel';
}

// The element that carries the panel's title, or null when the panel has none
// (the Statistics date bar, an error box) — those stay as they are.
function _cpTitleOf(panel){
  for(const c of panel.children){
    if(c.tagName==='H3') return c;
    if(c.classList.contains('stat-block-head')){
      const t=c.querySelector('.stat-block-title');
      if(t) return t;
    }
  }
  return null;
}

function _cpShow(panel, open){
  panel.classList.toggle('is-collapsed', !open);
  const btn=panel.querySelector('.cp-toggle');
  if(btn){
    btn.setAttribute('aria-expanded', open?'true':'false');
    btn.title = open ? 'Collapse this section' : 'Expand this section';
  }
}

// Opens or closes one panel and remembers it.
export function setPanelOpen(panel, open, screen){
  if(!panel?.dataset?.cp) return;
  _cpShow(panel, open);
  const closed=_cpLoad(screen);
  if(open) closed.delete(panel.dataset.cp); else closed.add(panel.dataset.cp);
  _cpSave(screen, closed);
}

// Adds the toggle to every titled panel under root and applies the remembered
// state. Safe to call again after part of the screen is redrawn: a panel that
// already has its toggle is only brought back to its remembered state.
export function makePanelsCollapsible(root, screen){
  if(!root || typeof root.querySelectorAll!=='function') return [];
  const closed=_cpLoad(screen);
  const used=new Set();
  const out=[];
  for(const panel of root.querySelectorAll('.settings-panel')){
    if(panel.dataset.cp){ used.add(panel.dataset.cp); _cpShow(panel, !closed.has(panel.dataset.cp)); out.push(panel); continue; }
    const title=_cpTitleOf(panel);
    if(!title) continue;
    let key=panel.dataset.cpKey||_cpSlug(title.textContent);
    for(let n=2; used.has(key); n++) key=_cpSlug(title.textContent)+'-'+n;
    used.add(key);
    panel.dataset.cp=key;
    const head = title.tagName==='H3' ? title : title.closest('.stat-block-head');
    head.classList.add('cp-head');
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='cp-toggle';
    while(title.firstChild) btn.appendChild(title.firstChild);
    btn.insertAdjacentHTML('afterbegin', `<span class="cp-chev">${icon('chevron',14,2.2)}</span>`);
    title.appendChild(btn);
    btn.addEventListener('click',()=>setPanelOpen(panel, panel.classList.contains('is-collapsed'), screen));
    _cpShow(panel, !closed.has(key));
    out.push(panel);
  }
  return out;
}

// Opens or closes every titled panel under root.
export function setAllPanels(root, screen, open){
  const panels=makePanelsCollapsible(root, screen);
  const closed=_cpLoad(screen);
  for(const p of panels){
    _cpShow(p, open);
    if(open) closed.delete(p.dataset.cp); else closed.add(p.dataset.cp);
  }
  _cpSave(screen, closed);
  return panels.length;
}

// The two top-bar buttons, and their wiring. The buttons act on whatever
// panels are on screen at the moment of the click, so a Statistics redraw
// (new dates) needs no re-wiring.
export function collapseControlsHTML(){
  return `<button class="btn btn-sm cp-all" id="cp-expand-all" title="Open every section on this screen">Expand all</button>
    <button class="btn btn-sm cp-all" id="cp-collapse-all" title="Fold every section down to its title">Collapse all</button>`;
}
export function bindCollapseControls(screen){
  const root=()=>document.getElementById('content');
  document.getElementById('cp-expand-all')?.addEventListener('click',()=>setAllPanels(root(), screen, true));
  document.getElementById('cp-collapse-all')?.addEventListener('click',()=>setAllPanels(root(), screen, false));
}
