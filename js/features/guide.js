import { esc, setActions, setContent } from '../core/ui.js';
import { APP_VER } from '../core/version.js';

// ══════════════════════════════════════════════════════════════════════════════
// USER GUIDE — the Hebrew user guide, inside the app
// ------------------------------------------------------------------------------
// One source for two outputs: web/guide/content.json is rendered here, and the
// same file builds the Word guide (tools/build-guide-docx.js). So a change to a
// screen is documented in ONE place — edit content.json (and the screenshot in
// web/guide/img/ when the screen looks different), and both stay in step.
//
// Block types in content.json:
//   h1 {id,text}   chapter          h2 {text}   section        p {text}
//   steps {items}  numbered list    list {items}               tip / warn {text}
//   img {src,caption,callouts[]}    screenshot; callouts[i] explains marker i+1
//   table {head[],rows[][]}
// Inline: **bold** and `button text`.
// ══════════════════════════════════════════════════════════════════════════════
export let _guideData=null;
export let _guideQuery='';

export function _guideInline(s){
  return esc(String(s==null?'':s))
    .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
    .replace(/`(.+?)`/g,'<span class="gd-key">$1</span>');
}
export function _guideImgSrc(src){ return `./guide/${src}?v=${APP_VER}`; }

export function _guideBlockHTML(b){
  const T=_guideInline;
  switch(b.t){
    case 'h1':   return `<h2 class="gd-h1" id="gd-${esc(b.id)}">${T(b.text)}</h2>`;
    case 'h2':   return `<h3 class="gd-h2">${T(b.text)}</h3>`;
    case 'p':    return `<p class="gd-p">${T(b.text)}</p>`;
    case 'steps':return `<ol class="gd-steps">${(b.items||[]).map(i=>`<li>${T(i)}</li>`).join('')}</ol>`;
    case 'list': return `<ul class="gd-list">${(b.items||[]).map(i=>`<li>${T(i)}</li>`).join('')}</ul>`;
    case 'tip':  return `<div class="gd-box gd-tip"><span class="gd-box-ic">💡</span><div>${T(b.text)}</div></div>`;
    case 'warn': return `<div class="gd-box gd-warn"><span class="gd-box-ic">⚠️</span><div>${T(b.text)}</div></div>`;
    case 'img':  return `<figure class="gd-fig">
        <img src="${esc(_guideImgSrc(b.src))}" alt="${esc(b.caption||'')}" loading="lazy">
        ${b.caption?`<figcaption>${T(b.caption)}</figcaption>`:''}
        ${(b.callouts||[]).length?`<ol class="gd-callouts">${b.callouts.map((c,i)=>
          `<li><span class="gd-num">${i+1}</span><span>${T(c)}</span></li>`).join('')}</ol>`:''}
      </figure>`;
    case 'table':return `<table class="gd-table"><thead><tr>${(b.head||[]).map(h=>`<th>${T(h)}</th>`).join('')}</tr></thead>
        <tbody>${(b.rows||[]).map(r=>`<tr>${r.map(c=>`<td>${T(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    default:     return '';
  }
}

// Splits the flat block list into chapters at every h1, so the table of
// contents and the search can work chapter by chapter.
export function _guideChapters(blocks){
  const out=[];
  for(const b of blocks||[]){
    if(b.t==='h1' || !out.length) out.push({id:b.id||'intro', title:b.t==='h1'?b.text:'', blocks:[]});
    out[out.length-1].blocks.push(b);
  }
  return out;
}
export function _guideChapterText(ch){
  return ch.blocks.map(_guideBlockText).join(' ').toLowerCase();
}
// Plain text of one block, the way a reader sees it (markdown marks removed).
export function _guideBlockText(b){
  return [b.text,b.caption,...(b.items||[]),...(b.callouts||[]),...(b.head||[]),...((b.rows||[]).flat())]
    .filter(Boolean).join(' ').replace(/\*\*|`/g,'');
}
// The words searched for: every word must appear in a block for it to count.
export function _guideTerms(q){
  return [...new Set(String(q||'').toLowerCase().split(/\s+/).map(w=>w.trim()).filter(Boolean))];
}
export function _guideReEscape(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
// Every block that contains all the terms, with where it sits (chapter and
// section) and a short excerpt around the first hit — the search results list.
export function _guideSearch(blocks, q){
  const terms=_guideTerms(q);
  if(!terms.length) return [];
  const out=[];
  let ch=null, sec='';
  (blocks||[]).forEach((b,i)=>{
    if(b.t==='h1'){ ch={id:b.id, title:b.text}; sec=''; }
    else if(b.t==='h2') sec=b.text;
    const text=_guideBlockText(b);
    const low=text.toLowerCase();
    if(!terms.every(t=>low.includes(t))) return;
    let hits=0;
    for(const t of terms){ let k=-1; while((k=low.indexOf(t,k+1))!==-1) hits++; }
    const at=low.indexOf(terms[0]);
    // Cut the excerpt at word boundaries, about 45 characters before the hit and 70 after.
    let from=Math.max(0,at-45), to=Math.min(text.length,at+terms[0].length+70);
    if(from>0){ const sp=text.lastIndexOf(' ',from); from=sp>=0&&at-sp<70?sp+1:from; }
    if(to<text.length){ const sp=text.indexOf(' ',to); to=sp>=0&&sp-to<25?sp:to; }
    out.push({b:i, chapterId:ch?ch.id:'', chapter:ch?ch.title:'', section:b.t==='h2'||b.t==='h1'?'':sec,
              hits, snippet:(from>0?'…':'')+text.slice(from,to).trim()+(to<text.length?'…':'')});
  });
  return out;
}
// Escaped text with the terms wrapped in <mark>.
export function _guideMark(text, terms){
  const safe=esc(text);
  if(!terms.length) return safe;
  const re=new RegExp('('+terms.map(t=>_guideReEscape(esc(t))).join('|')+')','gi');
  return safe.replace(re,'<mark class="gd-hit">$1</mark>');
}
// Wraps the terms in <mark> inside the rendered blocks that matched, by walking
// their text nodes — so no tag or attribute is ever touched.
export function _guideHighlight(root, terms, blockIds){
  if(!terms.length) return 0;
  const re=new RegExp(terms.map(_guideReEscape).join('|'),'gi');
  let n=0;
  for(const id of blockIds){
    const host=root.querySelector(`[data-b="${id}"]`);
    if(!host) continue;
    const walker=document.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    for(const node of nodes){
      const v=node.nodeValue; re.lastIndex=0;
      if(!re.test(v)) continue;
      re.lastIndex=0;
      const frag=document.createDocumentFragment();
      let last=0, m;
      while((m=re.exec(v))){
        if(m.index>last) frag.appendChild(document.createTextNode(v.slice(last,m.index)));
        const mk=document.createElement('mark'); mk.className='gd-hit'; mk.textContent=m[0];
        frag.appendChild(mk); n++;
        last=m.index+m[0].length;
      }
      if(last<v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      node.parentNode.replaceChild(frag,node);
    }
  }
  return n;
}
export let _guideHitAt=-1;

export async function renderGuide(){
  setActions(`<button class="btn btn-ghost btn-sm" id="btn-gd-print">🖨 הדפסה</button>`);
  setContent(`<div style="text-align:center;padding:60px"><div class="ring" style="margin:0 auto"></div></div>`);
  if(!_guideData){
    try{
      const resp=await fetch(`./guide/content.json?v=${APP_VER}`);
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      _guideData=await resp.json();
    }catch(e){
      setContent(`<div class="card" style="color:var(--red)">Could not load the user guide: ${esc(e.message)}</div>`);
      return;
    }
  }
  const chapters=_guideChapters(_guideData.blocks);
  const blocks=_guideData.blocks;
  setContent(`<div class="gd-wrap" dir="rtl">
    <aside class="gd-toc">
      <div class="gd-toc-title">${_guideInline(_guideData.title||'מדריך למשתמש')}</div>
      <div class="gd-search-row">
        <input class="search-box gd-search" id="gd-search" placeholder="חיפוש במדריך — מילה או כמה מילים…" value="${esc(_guideQuery)}" autocomplete="off">
        <button type="button" class="gd-search-x" id="gd-search-x" title="ניקוי">✕</button>
      </div>
      <div id="gd-results" class="gd-results"></div>
      <nav id="gd-toc-list">${chapters.filter(c=>c.title).map(c=>
        `<a href="#gd-${esc(c.id)}" data-id="${esc(c.id)}">${_guideInline(c.title)}<span class="gd-count" data-count="${esc(c.id)}"></span></a>`).join('')}</nav>
      <div class="gd-ver">${esc(_guideData.version?('גרסת המדריך: '+_guideData.version):'')}</div>
    </aside>
    <article class="gd-body" id="gd-body">${chapters.map(c=>`<section class="gd-chapter">${
      c.blocks.map(bl=>`<div class="gd-blk" data-b="${blocks.indexOf(bl)}">${_guideBlockHTML(bl)}</div>`).join('')}</section>`).join('')}</article>
  </div>`);

  const body=document.getElementById('gd-body');
  const resultsEl=document.getElementById('gd-results');
  const pristine=body.innerHTML;
  let found=[];
  // Screenshots load lazily, so a picture above the place jumped to can finish
  // loading after the jump and push that place off the screen. For a moment
  // after each jump, every picture that loads brings the place back into view —
  // unless the user scrolls by hand.
  let keep=null;
  const jumpTo=(el, block, smooth)=>{
    el.scrollIntoView({behavior:smooth?'smooth':'auto', block});
    keep={el, block, until:Date.now()+3000};
  };
  body.addEventListener('load',e=>{
    if(e.target.tagName==='IMG' && keep && Date.now()<keep.until && keep.el.isConnected)
      keep.el.scrollIntoView({behavior:'auto', block:keep.block});
  }, true);
  ['wheel','touchstart','keydown'].forEach(ev=>window.addEventListener(ev,e=>{
    if(ev!=='keydown' || /^(Arrow|Page|Home|End| )/.test(e.key)) keep=null; }, {passive:true}));
  const go=(k, smooth=true)=>{
    if(!found.length) return;
    _guideHitAt=(k+found.length)%found.length;
    const r=found[_guideHitAt];
    const host=body.querySelector(`[data-b="${r.b}"]`);
    body.querySelectorAll('.gd-blk-on').forEach(x=>x.classList.remove('gd-blk-on'));
    resultsEl.querySelectorAll('.gd-res-on').forEach(x=>x.classList.remove('gd-res-on'));
    if(host){ host.classList.add('gd-blk-on'); jumpTo(host,'center',smooth); }
    const li=resultsEl.querySelector(`[data-k="${_guideHitAt}"]`);
    if(li){ li.classList.add('gd-res-on');
      // Scroll only the results list: scrollIntoView here would also stop the
      // page's smooth scroll to the place found.
      const list=li.parentElement, top=li.offsetTop, bot=top+li.offsetHeight;
      if(top<list.scrollTop) list.scrollTop=top;
      else if(bot>list.scrollTop+list.clientHeight) list.scrollTop=bot-list.clientHeight; }
    const pos=document.getElementById('gd-pos'); if(pos) pos.textContent=`${_guideHitAt+1} / ${found.length}`;
  };
  const paint=()=>{
    const terms=_guideTerms(_guideQuery);
    body.innerHTML=pristine;
    found=_guideSearch(blocks,_guideQuery);
    _guideHitAt=-1;
    const marks=_guideHighlight(body, terms, found.map(r=>r.b));
    // Per-chapter counts beside the table of contents.
    const per={}; found.forEach(r=>{ per[r.chapterId]=(per[r.chapterId]||0)+1; });
    document.querySelectorAll('#gd-toc-list a').forEach(a=>{
      const n=per[a.dataset.id]||0;
      a.classList.toggle('gd-dim', !!terms.length && !n);
      const c=a.querySelector('.gd-count'); if(c) c.textContent = terms.length && n ? String(n) : '';
    });
    document.getElementById('gd-search-x').style.visibility = _guideQuery ? 'visible' : 'hidden';
    if(!terms.length){ resultsEl.innerHTML=''; return; }
    if(!found.length){
      resultsEl.innerHTML=`<div class="gd-res-none">לא נמצא "${esc(_guideQuery)}" במדריך.</div>`;
      return;
    }
    resultsEl.innerHTML=`<div class="gd-res-head">
        <span>${found.length} מקומות · ${marks} התאמות</span>
        <span class="gd-res-nav"><button type="button" id="gd-prev" title="הקודם">▲</button>
          <span id="gd-pos"></span><button type="button" id="gd-next" title="הבא (Enter)">▼</button></span></div>
      <ol class="gd-res-list">${found.map((r,k)=>`<li data-k="${k}"><a href="#gd-b-${r.b}">
        <span class="gd-res-where">${esc(String(r.chapter||'').replace(/^\d+\.\s*/,''))}${r.section?` › ${esc(r.section)}`:''}</span>
        <span class="gd-res-snip">${_guideMark(r.snippet, terms)}</span></a></li>`).join('')}</ol>`;
    resultsEl.querySelectorAll('li[data-k] a').forEach(a=>a.addEventListener('click',e=>{
      e.preventDefault(); go(+a.parentElement.dataset.k); }));
    document.getElementById('gd-prev').addEventListener('click',()=>go(_guideHitAt-1));
    document.getElementById('gd-next').addEventListener('click',()=>go(_guideHitAt+1));
    go(0,false);
  };
  paint();
  const inp=document.getElementById('gd-search');
  let t=null;
  inp.addEventListener('input',e=>{ _guideQuery=e.target.value; clearTimeout(t); t=setTimeout(paint,220); });
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); clearTimeout(t);
      if(_guideTerms(_guideQuery).join(' ')!==_guideTerms(inp.value).join(' ')){ _guideQuery=inp.value; paint(); }
      else go(_guideHitAt+(e.shiftKey?-1:1)); }
    if(e.key==='Escape'){ inp.value=''; _guideQuery=''; paint(); }
  });
  document.getElementById('gd-search-x').addEventListener('click',()=>{ inp.value=''; _guideQuery=''; paint(); inp.focus(); });
  document.querySelectorAll('#gd-toc-list a').forEach(a=>a.addEventListener('click',e=>{
    e.preventDefault();
    const h=document.getElementById('gd-'+a.dataset.id); if(h) jumpTo(h,'start',true);
  }));
  document.getElementById('btn-gd-print')?.addEventListener('click',()=>window.print());
}
