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
  return ch.blocks.map(b=>[b.text,b.caption,...(b.items||[]),...(b.callouts||[]),
    ...(b.head||[]),...((b.rows||[]).flat())].filter(Boolean).join(' ')).join(' ').toLowerCase();
}

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
  setContent(`<div class="gd-wrap" dir="rtl">
    <aside class="gd-toc">
      <div class="gd-toc-title">${_guideInline(_guideData.title||'מדריך למשתמש')}</div>
      <input class="search-box gd-search" id="gd-search" placeholder="חיפוש במדריך…" value="${esc(_guideQuery)}">
      <nav id="gd-toc-list">${chapters.filter(c=>c.title).map(c=>
        `<a href="#gd-${esc(c.id)}" data-id="${esc(c.id)}">${_guideInline(c.title)}</a>`).join('')}</nav>
      <div class="gd-ver">${esc(_guideData.version?('גרסת המדריך: '+_guideData.version):'')}</div>
    </aside>
    <article class="gd-body" id="gd-body"></article>
  </div>`);

  const body=document.getElementById('gd-body');
  const paint=()=>{
    const q=_guideQuery.trim().toLowerCase();
    const shown=q ? chapters.filter(c=>_guideChapterText(c).includes(q)) : chapters;
    body.innerHTML = shown.length
      ? shown.map(c=>`<section class="gd-chapter">${c.blocks.map(_guideBlockHTML).join('')}</section>`).join('')
      : `<p class="gd-p" style="color:var(--muted)">לא נמצא פרק שמכיל את "${esc(_guideQuery)}".</p>`;
    document.querySelectorAll('#gd-toc-list a').forEach(a=>{
      a.style.display = (!q || shown.some(c=>c.id===a.dataset.id)) ? '' : 'none';
    });
  };
  paint();
  document.getElementById('gd-search').addEventListener('input',e=>{ _guideQuery=e.target.value; paint(); });
  document.querySelectorAll('#gd-toc-list a').forEach(a=>a.addEventListener('click',e=>{
    e.preventDefault();
    document.getElementById('gd-'+a.dataset.id)?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  document.getElementById('btn-gd-print')?.addEventListener('click',()=>window.print());
}
