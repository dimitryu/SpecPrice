// ── Line icons (Copper & Graphite, v1.79) ─────────────────────────────────────
// One small set of 24-px stroke icons, drawn in currentColor, instead of emoji:
// an emoji looks different on every computer, cannot take the theme's colour,
// and reads as a toy in a quoting tool.
//
// The screens still write their labels with an emoji in front ("💾 Save"), so
// nothing else had to change. decorateIcons() swaps that leading emoji for the
// matching icon in buttons, headings, tiles and the user guide's key names;
// watchIcons() keeps doing it for everything drawn later. An emoji with no icon
// here is left as it is.
const P = {
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  database:'<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  quote:'<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8.5 12h7M8.5 16h4.5M8.5 8h3"/>',
  filePlus:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M12.5 11v6M9.5 14h6"/>',
  fileText:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 12.5h7M9 16h7"/>',
  paperclip:'<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="6"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash:'<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
  tag:'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  package:'<path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2"/>',
  users:'<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.9-3.1 3.2-4.6 6-4.6s5.1 1.5 6 4.6"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.2c1.7.6 2.9 2 3.5 4.3"/>',
  sheet:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',
  help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.6M12 17.2v.3"/>',
  wrench:'<path d="M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3L17.5 3.5M20.5 6.5l-2.8 2.8"/>',
  scissors:'<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.4L20 17M8.2 15.6L20 7"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  shield:'<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8.5 7.5h7M8.5 11h7"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  building:'<path d="M4 21V5l8-2v18M12 8h8v13"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M3 21h18"/>',
  lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  flask:'<path d="M9 3h6M10 3v6l-5.5 9.5A1.8 1.8 0 0 0 6 21h12a1.8 1.8 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  printer:'<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
  undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  pencil:'<path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M13.5 6.5l4 4"/>',
  download:'<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  inbox:'<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  clipboard:'<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  alert:'<path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  message:'<path d="M4 5h16v11H9l-5 4z"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="M21 16l-5.5-5.5L5 20"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5z"/>',
  bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  hourglass:'<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9S7 16 7 21M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  sparkles:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plug:'<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  ruler:'<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2"/>',
  droplet:'<path d="M12 3.5c3 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.5 6-10.5z"/>',
  bolt:'<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  recycle:'<path d="M7 19H4.5l2.6-4.5M7.1 14.5l2.6 1.5M17 19h2.5l-2.6-4.5M12 4l-2.6 4.5M12 4l2.6 4.5M9.4 8.5L7 9.5M7.1 14.5L4.5 19M16.9 14.5L19.5 19M14.6 8.5L17 9.5M9 19h6"/>',
  headset:'<path d="M4 13.5V12a8 8 0 0 1 16 0v1.5"/><rect x="3" y="13" width="4" height="6" rx="1.6"/><rect x="17" y="13" width="4" height="6" rx="1.6"/><path d="M19 19.2V20a3 3 0 0 1-3 3h-3"/>',
};

// The emoji each icon replaces. (Arrows, ✓, ✕ and the like are typography,
// not pictures, and stay as they are.)
const EMOJI = {
  '💾':'save','📎':'filePlus','📦':'package','🔍':'search','🔎':'search','📊':'sheet','🗑':'trash','📋':'clipboard',
  '📥':'inbox','✂':'scissors','🛠':'wrench','💰':'quote','🏢':'building','🔒':'lock','📄':'fileText','🧪':'flask',
  '🖨':'printer','♻':'recycle','➕':'plus','＋':'plus','👥':'users','👤':'user','🔑':'key','✏':'pencil','✎':'pencil',
  '📧':'mail','↩':'undo','🔄':'refresh','↻':'refresh','💬':'message','⚙':'settings','🏠':'home','📘':'book','🛡':'shield',
  '📐':'ruler','🔌':'plug','📜':'fileText','🤖':'sparkles','⏳':'hourglass','💡':'bulb','⚠':'alert','🖼':'image','📕':'book',
  '🌐':'globe','❓':'help','⏱':'clock','⬇':'download','📈':'chart','📉':'chart','🧴':'droplet','⚡':'bolt','🔗':'link',
  '✏️':'pencil','📑':'fileText','🗂':'database','📝':'pencil','✉':'mail','🧾':'quote','↧':'inbox',
};

// An icon as an <svg> string.
export function icon(name, size=16, stroke=1.8){
  const d=P[name]; if(!d) return '';
  return `<svg class="ic ic-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
export function iconNames(){ return Object.keys(P); }

// Leading emoji (plus its variation selector and the space after it).
const LEAD = new RegExp('^(\\s*)(' + Object.keys(EMOJI).sort((a,b)=>b.length-a.length)
  .map(e=>e.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')\\uFE0F?\\s?');
const SCOPE = '.icon-big, .empty-ic, button, .btn, h1, h2, h3, h4, summary, .home-btn-icon, .sd-panel-title, .modal-head, .gd-key, .stat-block-title, .adm-alert, label, th, a.btn, .tab, .ic-slot';

function sizeFor(el){
  if(el.closest('.icon-big, .empty-ic')) return 44;
  if(el.closest('.home-btn-icon')) return 24;
  if(el.closest('h1')) return 20;
  if(el.closest('h2, h3, .modal-head')) return 17;
  if(el.closest('.btn-sm, .gd-key, th, .adm-alert')) return 13;
  return 15;
}
// Replaces the leading emoji of every text node inside the scoped elements of root.
export function decorateIcons(root){
  if(!root || typeof document==='undefined') return;
  const base = root.nodeType===1 ? root : root.parentElement;
  if(!base || typeof base.querySelectorAll!=='function') return;
  const hosts = [...(base.matches && base.matches(SCOPE) ? [base] : []), ...base.querySelectorAll(SCOPE)];
  for(const host of hosts){
    const walker = document.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes=[]; let n; while((n=walker.nextNode())) nodes.push(n);
    for(const t of nodes){
      if(t.parentElement && t.parentElement.closest('svg, textarea, input, [contenteditable="true"], .no-icons')) continue;
      const m = LEAD.exec(t.nodeValue);
      if(!m) continue;
      const name = EMOJI[m[2]];
      const span = document.createElement('span');
      span.className = 'ic-wrap';
      span.style.cssText = 'display:inline-flex;align-items:center';
      span.innerHTML = icon(name, sizeFor(t.parentElement));
      // keep the space between the icon and the words that followed the emoji
      t.nodeValue = m[1] + t.nodeValue.slice(m[0].length);
      t.parentNode.insertBefore(span, t);
      if(m[1]==='' && t.nodeValue && !/^\s/.test(t.nodeValue)) t.nodeValue = ' ' + t.nodeValue;
    }
  }
}
// Keeps decorating whatever the app draws from now on.
let _iconObserver=null;
export function watchIcons(root){
  if(typeof document==='undefined') return;
  const r = root || document.body;
  decorateIcons(r);
  const MO = globalThis.MutationObserver;
  if(typeof MO!=='function' || _iconObserver) return;
  let pending=[], queued=false;
  _iconObserver = new MO(list=>{
    for(const m of list){
      if(m.type==='characterData'){ if(m.target.parentElement) pending.push(m.target.parentElement); continue; }
      for(const a of m.addedNodes){ if(a.nodeType===1) pending.push(a); else if(a.nodeType===3 && a.parentElement) pending.push(a.parentElement); }
    }
    if(queued || !pending.length) return;
    queued=true;
    Promise.resolve().then(()=>{
      queued=false;
      const todo=pending; pending=[];
      for(const el of todo){
        if(!el.isConnected) continue;
        // a text node whose host is above it: decorate from the nearest scoped ancestor
        const host = el.closest ? (el.closest(SCOPE) || el) : el;
        decorateIcons(host);
      }
    });
  });
  _iconObserver.observe(r, {childList:true, subtree:true, characterData:true});
}
