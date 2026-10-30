import { S } from '../../core/state.js';
import { _csLastRawReply, aiAnalyzeCutStrip } from '../../ai/cutstrip.js';
import { logAudit } from '../../core/audit.js';
import { closeModal, esc, showModal, toast } from '../../core/ui.js';
import { writeSpecDoc } from '../../data/specs.js';
import { _csAttachDatasheets } from './datasheets.js';
import { _CS_SOURCE_LANG, _csEnsureLang, _csLang, _csT } from './i18n.js';
import { _csDocId, _csTBCCount, loadCutStripSpecs } from './list.js';
import { renderCutStripSheet } from './sheet.js';
import { encodeImage, extractPDFPages } from '../../io/pdf.js';

// Vision needs to read dimension callouts, not fine-print BOM rows, so the
// analysis image can be smaller than the one BOM extraction uses. Less to
// upload is less time spent before the model even starts.
export const _CS_IMG_MAXDIM = 1800, _CS_IMG_QUALITY = 0.82;
// How many sheets of one drawing go to the analysis. Enough for the packages
// seen so far (assembly view, wiring table, notes) without turning one import
// into a request that times out.
export const _CS_MAX_SHEETS = 6;
// A second, smaller copy is kept ON the spec as the reference figure. It has to
// live inside the Firestore document, which caps at 1 MB for everything else
// too, so it is deliberately smaller than the one sent for analysis and is
// dropped rather than risking a save that fails.
export const _CS_REF_MAXDIM = 1400, _CS_REF_QUALITY = 0.68, _CS_REF_MAX_BYTES = 420000;

// Re-encodes an already-rendered page smaller. Rendering again from the PDF
// would be cleaner but costs a second full render; this is a cheap resize of
// something already in memory.
export function _csShrinkJpeg(b64, maxDim, quality){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      // The whole body is guarded, not just toDataURL. A throw anywhere in here
      // used to leave this promise unsettled forever — the analysis would then
      // hang until the 180 s timeout with no clue why. Allocating a canvas for a
      // large scan is exactly the kind of call that fails on a loaded machine.
      try{
        const scale=Math.min(1, maxDim/Math.max(img.width,img.height));
        if(scale>=1){ resolve(b64); return; }
        const c=document.createElement('canvas');
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg',quality).split(',')[1]);
      }catch{ resolve(b64); }   // tainted canvas, no memory — the original still works
    };
    img.onerror=()=>resolve(b64);     // never let a resize failure block the analysis
    img.src='data:image/jpeg;base64,'+b64;
  });
}

// The title block carries the customer's logo and name, and the sheet goes to a
// shop floor that should not be carrying someone else's branding. Asking a vision
// model where the logo was did not work — it ate the drawing number and left the
// logo showing. A fixed region does work, because on an ISO/ANSI sheet the title
// block is always the bottom-right corner. Nothing identifying is lost: drawing
// number, name, project and revision are already printed at the top of the sheet.
// Checked against the real WLS-122-050 sheet: this clears the logo, the company
// name and the whole title block while leaving the part list — including its QTY
// and Ref columns — fully readable.
export const _CS_TITLEBLOCK = {x:0.655, y:0.775};   // fallback when no ruling line is found
// A drawing frames its title block with real lines. Snapping the mask to the
// nearest of those, instead of covering a fixed fraction, means the white area
// stops exactly where the block does — no part list clipped, no logo left
// showing. Searched only near the expected corner, so a busy drawing cannot
// pull the mask across the harness.
export function _csFindRule(px, w, h, vertical){
  const lo = vertical ? Math.round(w*0.50) : Math.round(h*0.60);
  const hi = vertical ? Math.round(w*0.80) : Math.round(h*0.92);
  const span = vertical ? h : w;
  const from = vertical ? Math.round(h*0.70) : Math.round(w*0.55);   // only the corner region
  let best=-1, bestScore=0;
  for(let i=lo; i<hi; i++){
    let dark=0;
    for(let j=from; j<span; j+=2){
      const x = vertical ? i : j, y = vertical ? j : i;
      const o=(y*w+x)*4;
      if(px[o]<110 && px[o+1]<110 && px[o+2]<110) dark++;
    }
    const frac = dark / ((span-from)/2);
    if(frac>bestScore){ bestScore=frac; best=i; }
  }
  // A ruling line is nearly solid. Anything less is text or hatching, not a frame.
  return bestScore>0.55 ? best/(vertical?w:h) : null;
}
export function _csMaskTitleBlock(b64){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');
        c.width=img.width; c.height=img.height;
        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0);
        let fx=_CS_TITLEBLOCK.x, fy=_CS_TITLEBLOCK.y;
        try{
          const d=ctx.getImageData(0,0,img.width,img.height).data;
          const vx=_csFindRule(d, img.width, img.height, true);
          const hy=_csFindRule(d, img.width, img.height, false);
          // Two failure modes, both bad: a line found too far in eats the part
          // list, one too far out leaves the logo showing. Measured against real
          // sheets, the finder does both — so a snap is only accepted inside a
          // narrow envelope around the fraction that was checked by eye, and it
          // may only grow the mask. Outside the envelope the fixed mask stands.
          if(vx!=null && vx>=0.60 && vx<=0.70) fx=Math.min(fx, vx);
          if(hy!=null && hy>=0.74 && hy<=0.84) fy=Math.min(fy, hy);
        }catch{ /* tainted canvas or out of memory — the fixed fraction still works */ }
        const x=fx*img.width, y=fy*img.height;
        ctx.fillStyle='#FFFFFF';
        ctx.fillRect(x, y, img.width-x, img.height-y);
        resolve(c.toDataURL('image/jpeg',0.9).split(',')[1]);
      }catch{ resolve(null); }   // could not mask ⇒ do not store, handled by caller
    };
    img.onerror=()=>resolve(null);
    img.src='data:image/jpeg;base64,'+b64;
  });
}

// A reference copy of the drawing, small enough to travel inside the Firestore
// document. Returns null rather than an oversized string: a spec that fails to
// save is far worse than a spec without the picture attached.
export async function _csRefImage(b64){
  try{
    if(!b64) return null;
    // Masking first, so the branding is gone before anything is stored. A failure
    // here returns null rather than the original: publishing a customer's logo is
    // the one outcome worth losing the picture over.
    const masked=await _csMaskTitleBlock(b64);
    if(!masked) return null;
    const small=await _csShrinkJpeg(masked, _CS_REF_MAXDIM, _CS_REF_QUALITY);
    if(!small || small.length > _CS_REF_MAX_BYTES){
      console.log('[CutStrip] reference image dropped —',
        small?(small.length/1e3).toFixed(0)+' kB over budget':'shrink failed');
      return null;
    }
    return small;
  }catch(e){ console.log('[CutStrip] reference image skipped:', e.message); return null; }
}

// ── Import ────────────────────────────────────────────────────────────────────
export function openCSFileModal(){
  showModal(`<div class="modal">
    <div class="modal-head"><h3>New Cut &amp; Strip Specification</h3><button class="close-modal" onclick="closeModal()">✕</button></div>
    <div class="modal-body" id="cs-modal-body">
      <div class="drop-zone" id="cs-drop-zone" tabindex="0">
        <span class="icon-big">✂️</span>
        <strong>Drop a cable or harness drawing here</strong>
        <p>PDF / PNG / JPG — one drawing at a time. The analysis reads the cut length, strip dimensions,
           sleeve and marker positions, then builds a bench sheet with diagrams.</p>
        <input type="file" id="cs-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp" style="display:none">
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
  </div>`);
  const dz=document.getElementById('cs-drop-zone'), fi=document.getElementById('cs-file-input');
  dz.addEventListener('click',()=>fi.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');
    if(e.dataTransfer.files.length) handleCSFile(e.dataTransfer.files[0]);});
  fi.addEventListener('change',()=>{ if(fi.files.length) handleCSFile(fi.files[0]); });
}

export async function handleCSFile(file){
  const body=document.getElementById('cs-modal-body');
  const foot=document.querySelector('#modal-bg .modal-foot');
  const isPDF=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const isImg=file.type.startsWith('image/');
  if(!isPDF && !isImg){ toast('Drop a PDF or an image of the drawing','error'); return; }

  body.innerHTML=`<div class="ai-status"><div class="ring"></div><span id="cs-msg">Reading drawing…</span></div>
    <div class="progress-bar"><div class="progress-fill" id="cs-prog"></div></div>`;
  if(foot) foot.innerHTML='';
  const setM=(m,p)=>{ const e=document.getElementById('cs-msg'); if(e)e.textContent=m;
                      const b=document.getElementById('cs-prog'); if(b)b.style.width=p+'%'; };

  try{
    let text='', isImage=false, imgData=null, rawImage=null;
    if(isPDF){
      setM('Extracting drawing…',20);
      const {pageTexts,pageImages}=await extractPDFPages(file);
      text=pageTexts.join('\n');
      // Vision, not the text layer: cut lengths, strip callouts and marker
      // positions live on the picture. And on EVERY sheet — the assembly view is
      // usually sheet 1, but the connector names and the pin lists are just as
      // often on sheet 2 or 3, and an analysis that never sees them has no way
      // to know what the ends are called.
      const usable=pageImages.filter(Boolean).slice(0, _CS_MAX_SHEETS);
      if(usable.length){
        setM(`Preparing ${usable.length} sheet${usable.length>1?'s':''}…`, 30);
        const pages=[];
        for(const raw of usable){
          const small=await _csShrinkJpeg(raw, _CS_IMG_MAXDIM, _CS_IMG_QUALITY);
          if(small) pages.push(small);
        }
        console.log('[CutStrip]', pages.length, 'sheet(s),',
                    (pages.reduce((a,b)=>a+b.length,0)/1e6).toFixed(2), 'MB base64');
        if(pages.length){
          isImage=true; imgData={mimeType:'image/jpeg', b64:pages[0], pages};
          // The reference figure stays sheet 1: the cut & strip sheet wants the
          // cable, not the pin tables.
          rawImage=usable[0];
        }
      }
    } else {
      setM('Reading image…',20);
      imgData=await encodeImage(file); isImage=true;
      rawImage=(imgData && imgData.b64) || null;
    }

    // Generated straight into the display language. No translation pass on the
    // normal path — see _csPrompt for why that matters.
    // Always analysed in Hebrew, whatever the screen is set to. One source
    // language keeps every spec written the same way — comparable, editable in
    // one place, and translated through one path instead of two. English and
    // Russian are translations of it, produced on demand by the language
    // buttons, exactly like each other.
    setM('Analysing cut & strip requirements… a dense drawing can take up to 2 minutes — leave this open',55);
    S._csOnProgress=(n,phase)=>setM(
      phase==='detail' ? _csT('Reading the wiring table, the labels and the notes…')
      : phase==='retry' ? _csT('Reading the drawing again…')
      : phase==='bom'   ? _csT('Reading the part list…')
                        : `The drawing is bigger than one reply — continuing (${n})…`,
      phase==='detail' ? 72 : phase==='retry' ? 62 : phase==='bom' ? 68 : 55+n*3);
    let spec;
    try{ spec=await aiAnalyzeCutStrip(text, isImage, imgData, _CS_SOURCE_LANG); }
    finally{ S._csOnProgress=null; }
    // The drawing is only kept once the analysis has said where the customer's
    // branding is. No boxes, no stored copy — the sheet says so rather than
    // quietly publishing someone else's logo to the shop floor.
    if(rawImage){
      const img=await _csRefImage(rawImage);
      if(img) spec.source_image=img;
      else spec.source_image_skipped='the drawing could not be prepared for storage — it was too large, or the title block could not be masked';
    }

    // A drawing number is what the sheet is filed and found under. Falling back
    // to the file name is better than an "UNTITLED" doc, but it is recorded as a
    // discrepancy so nobody mistakes the file name for the title-block number.
    if(!String(spec.drawing_number||'').trim()){
      const fromName=file.name.replace(/\.[^.]+$/,'').trim();
      spec.drawing_number=fromName;
      spec.discrepancies.push({what:'No drawing number found in the title block',
        detail:`Filed under the file name "${fromName}". Confirm the real drawing number before this sheet is used.`});
    }
    // The same check the operator would make by eye, done every time: the file
    // name and the title block disagreeing is a common and expensive mix-up.
    const fileStem=file.name.replace(/\.[^.]+$/,'').trim();
    const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(fileStem && norm(fileStem) && !norm(fileStem).includes(norm(spec.drawing_number))
       && !norm(spec.drawing_number).includes(norm(fileStem))){
      spec.discrepancies.push({what:'File name does not match the title block',
        detail:`File is named "${fileStem}" but the title block reads "${spec.drawing_number}". This sheet follows the title block — confirm which is correct before the label is printed.`});
    }

    spec.source_file=file.name;
    spec.spec_no='CS-'+_csDocId(spec.drawing_number)+'-01';

    // The datasheets are fetched here, while the operator is already waiting on
    // the analysis, rather than behind a button nobody remembers to press. It
    // is best-effort: anything the distributors do not know about simply has no
    // link, and a failure never costs the analysis.
    setM('Looking up connector datasheets…',86);
    try{
      const n=await _csAttachDatasheets(spec,(d,t)=>setM(`Looking up connector datasheets… ${d}/${t}`, 86+Math.round(d/t*3)));
      if(n) logAudit('cut_strip_datasheets',{drawing:spec.drawing_number, found:n},true);
    }catch(e){ console.warn('[CutStrip] datasheets', e.message); }

    setM('Saving…',90);
    const id=_csDocId(spec.drawing_number);
    await writeSpecDoc(id, {...spec, createdBy:S.currentUserEmail||''});
    logAudit('cut_strip_generated',{drawing:spec.drawing_number, unverified:_csTBCCount(spec)},true);

    S.csSpecs=[]; await loadCutStripSpecs(true);
    S.csCurrent=S.csSpecs.find(s=>s._id===id) || {_id:id, ...spec};
    S._csEditing=false; S._csEditBackup=null;

    // Only when the operator is reading in something other than the source.
    if(_csLang!==_CS_SOURCE_LANG){
      setM('Translating…',94);
      await _csEnsureLang(S.csCurrent, _csLang, (n,t)=>setM(`Translating… ${Math.round(n/t*100)}%`, 94+Math.round(n/t*5)));
    }
    closeModal();
    toast(`Specification created for ${spec.drawing_number}`,'success');
    renderCutStripSheet();
  }catch(e){
    console.error('[CutStrip]',e);
    logAudit('cut_strip_generated',{file:file.name, error:e.message},false);
    body.innerHTML=`<div class="card" style="border-color:var(--danger)">
      <strong style="color:var(--danger)">Analysis failed</strong>
      <p style="font-size:13px;margin-top:8px">${esc(e.message)}</p>
      <p style="font-size:12px;color:var(--muted);margin-top:10px">
        Nothing was saved. If the drawing is a scan, a sharper image usually fixes this.</p></div>`;
    if(foot) foot.innerHTML=(_csLastRawReply
        ? `<button class="btn btn-ghost" id="btn-cs-copy-raw">\u{1F4CB} Copy the AI reply</button>` : '')
      + `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
    document.getElementById('btn-cs-copy-raw')?.addEventListener('click',async ev=>{
      try{ await navigator.clipboard.writeText(_csLastRawReply);
           ev.currentTarget.textContent='\u2713 Copied'; }
      catch{ toast('Could not copy — the reply is in the browser console','error'); }
    });
  }
}
