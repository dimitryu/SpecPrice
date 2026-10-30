import { S } from '../core/state.js';
import { toast } from '../core/ui.js';
import { _csT } from '../features/cutstrip/i18n.js';

// ── PDF export ────────────────────────────────────────────────────────────────
// html2canvas + jsPDF rather than a text-drawing PDF library, specifically
// because of the Hebrew and Russian views: rasterising the already-correct DOM
// keeps RTL, bidi and the SVG diagrams exactly as they appear on screen, which
// text-drawing libraries handle badly or not at all. Both are ~700 KB, so they
// load only when someone actually exports.
export let _csPdfPromise=null;
export function _csLoadPdfLibs(){
  if(window.html2canvas && window.jspdf) return Promise.resolve();
  if(_csPdfPromise) return _csPdfPromise;
  const one=src=>new Promise((res,rej)=>{
    const el=document.createElement('script'); el.src=src;
    el.onload=res; el.onerror=()=>rej(new Error('Could not load the PDF library — check your connection'));
    document.head.appendChild(el);
  });
  _csPdfPromise=Promise.all([
    window.html2canvas?Promise.resolve():one('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    window.jspdf?Promise.resolve():one('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
  ]).then(()=>{
    if(!window.html2canvas||!window.jspdf) throw new Error('PDF libraries failed to initialise');
  });
  return _csPdfPromise;
}
export async function _csExportPDF(){
  const btn=document.getElementById('btn-cs-pdf');
  const sheet=document.getElementById('cs-sheet');
  if(!sheet) return;
  const old=btn?btn.textContent:'';
  if(btn){ btn.disabled=true; btn.textContent='…'; }
  // html2canvas measures SVGs by their width/height ATTRIBUTES, not by CSS.
  // These are sized with width:100% and only a viewBox, so without this they
  // rasterise at their intrinsic size — or not at all. Stamped before the
  // capture and stripped again after, so the on-screen layout is untouched.
  const svgs=[...sheet.querySelectorAll('svg')];
  const stamped=svgs.map(s=>{
    const r=s.getBoundingClientRect();
    const had=s.hasAttribute('width');
    if(!had){ s.setAttribute('width', Math.round(r.width)); s.setAttribute('height', Math.round(r.height)); }
    return had;
  });
  try{
    await _csLoadPdfLibs();
    const canvas=await html2canvas(sheet,{scale:2, backgroundColor:'#ffffff', useCORS:true, logging:false});
    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
    const pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
    const M=8, iw=pw-M*2;
    const ih=canvas.height*iw/canvas.width;             // full image height in mm
    const pageH=ph-M*2;
    const pages=Math.max(1, Math.ceil(ih/pageH));
    const sliceCanvasH=Math.floor(canvas.height*pageH/ih);
    for(let p=0;p<pages;p++){
      if(p) pdf.addPage();
      const sy=p*sliceCanvasH;
      const sh=Math.min(sliceCanvasH, canvas.height-sy);
      const slice=document.createElement('canvas');
      slice.width=canvas.width; slice.height=sh;
      slice.getContext('2d').drawImage(canvas,0,sy,canvas.width,sh,0,0,canvas.width,sh);
      pdf.addImage(slice.toDataURL('image/jpeg',0.92),'JPEG',M,M,iw, sh*iw/canvas.width);
      pdf.setFontSize(8); pdf.setTextColor(120);
      pdf.text(`${_csT('Page')} ${p+1} ${_csT('of')} ${pages}`, pw-M, ph-3, {align:'right'});
    }
    const dwg=(S.csCurrent?.drawing_number||'spec').replace(/[^A-Za-z0-9._-]+/g,'_');
    pdf.save(`${dwg}_cut_and_strip.pdf`);
    toast('PDF exported','success');
  }catch(e){
    console.error('[CutStrip PDF]',e);
    toast('PDF export failed: '+e.message,'error');
  }finally{
    svgs.forEach((s,i)=>{ if(!stamped[i]){ s.removeAttribute('width'); s.removeAttribute('height'); } });
    if(btn){ btn.disabled=false; btn.textContent=old; }
  }
}
