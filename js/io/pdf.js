// ── PDF extraction: text + render pages as PNG images (like Windows app) ────────
export async function extractPDFPages(file){
  if(!window.pdfjsLib) throw new Error('PDF.js not loaded — please reload the page and try again.');
  if(!pdfjsLib.GlobalWorkerOptions.workerSrc)
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:ab}).promise;
  const pageTexts=[], pageImages=[], pageLayouts=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    // -- Text --
    const content = await page.getTextContent();
    const cells = content.items.map(it=>({x:it.transform[4],y:it.transform[5],str:it.str}));
    cells.sort((a,b)=>b.y-a.y||a.x-b.x);
    let lastY=null, line='', lines=[];
    for(const it of cells){
      if(lastY!==null && Math.abs(it.y-lastY)>4){lines.push(line);line='';}
      line+=(line?' ':'')+it.str; lastY=it.y;
    }
    if(line) lines.push(line);
    pageTexts.push(lines.join('\n'));
    // The same text with its columns kept: each piece placed at its own
    // horizontal position (see _pdfLayoutText). In a parts list that sits beside
    // the title block, the plain version runs table cells and title-block text
    // together on one line; this one keeps every table column under its header.
    pageLayouts.push(_pdfLayoutText(content.items));
    // -- Render page as JPEG, capped to a max dimension. An earlier version of
    // this rendered at a smaller size (1600px/q0.75) on the theory that an
    // oversized payload was causing "Failed to fetch" errors — that turned
    // out to be wrong (the real cause was a CORS header bug in the Anthropic
    // fetch call, since fixed), so this was needlessly hurting legibility of
    // dense multi-column tables (e.g. an Assembly Parts List with many small-
    // print rows) when read via vision. Now rendered larger/sharper by
    // default for better OCR-style accuracy; the size-safety fallback below
    // only kicks in if a page is genuinely huge. --
    const _renderAt=async(maxDim,quality)=>{
      const baseVp = page.getViewport({scale:1});
      const scale = Math.min(3, maxDim/Math.max(baseVp.width, baseVp.height));
      const vp = page.getViewport({scale});
      const canvas = document.createElement('canvas');
      canvas.width=vp.width; canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'), viewport:vp}).promise;
      return canvas.toDataURL('image/jpeg',quality).split(',')[1];
    };
    try{
      let b64 = await _renderAt(2400,0.88);
      // base64 is ~4/3 the binary size; ~4,000,000 chars ≈ ~3MB binary — only
      // step down for genuinely huge pages, not as a matter of course.
      if(b64.length>4000000){
        console.warn('[PDF render] page',i,'still large at',(b64.length/1e6).toFixed(1),'MB base64 — re-rendering smaller');
        b64 = await _renderAt(1600,0.75);
      }
      console.log('[PDF render] page',i,'final image size:',(b64.length/1e6).toFixed(2),'MB base64');
      pageImages.push(b64);
    }catch(e){ pageImages.push(null); }
  }
  // A region of a page, rendered sharp. The whole sheet is sent at 2400px, but
  // the API scales any image down to about 1568px on its long edge before the
  // model sees it — so a parts list printed in a corner of an A3 sheet arrives
  // with letters two or three pixels high. Rendering just that region, at a
  // scale where it fills the model's view, is what makes it readable.
  // box = [x0,y0,x1,y1] as fractions of the page; returns JPEG base64 bands,
  // top to bottom, each at most _BOM_VIS_MAX px on either side.
  const crop=async(pageIdx, box)=>{
    const page=await pdf.getPage(pageIdx+1);
    return _bomRenderBands(page, box);
  };
  return {pageTexts, pageImages, pageLayouts, crop, numPages:pdf.numPages};
}
// pdf.js text items → lines with their columns kept, like "pdftotext -layout":
// items on the same baseline form a line, and each item starts at the column
// matching its x position (one character ≈ 4.5 points).
export const _PDF_LAYOUT_PT_PER_CHAR=4.5;
export function _pdfLayoutText(items){
  const cells=(items||[]).filter(it=>String(it.str||'').trim())
    .map(it=>({x:it.transform[4], y:it.transform[5], str:String(it.str).replace(/\s+/g,' ').trim()}));
  cells.sort((a,b)=>b.y-a.y||a.x-b.x);
  const lines=[]; let cur=null;
  for(const c of cells){
    if(!cur || Math.abs(c.y-cur.y)>3){ cur={y:c.y, cells:[]}; lines.push(cur); }
    cur.cells.push(c);
  }
  return lines.map(l=>{
    let out='';
    for(const c of l.cells.sort((a,b)=>a.x-b.x)){
      const col=Math.max(0, Math.round(c.x/_PDF_LAYOUT_PT_PER_CHAR));
      out += out.length<col ? ' '.repeat(col-out.length) : (out ? ' ' : '');
      out += c.str;
    }
    return out.replace(/\s+$/,'');
  }).join('\n');
}

// ── Reading a parts list that is a picture ─────────────────────────────────────
// What the Anthropic API actually shows the model: an image is scaled so its
// long edge is at most ~1568px. Anything sent bigger is shrunk, not read sharper.
export const _BOM_VIS_MAX=1568;
export const _BOM_VIS_MAX_SCALE=8;      // 576 dpi — beyond this nothing gets clearer
export const _BOM_VIS_OVERLAP=0.08;     // bands overlap so no row is cut in half unseen
// The scale and the bands for a region [x0,y0,x1,y1] (fractions) of a page of
// w × h points. Width is what decides the scale: a table is cut into
// horizontal bands when it is tall, never into columns, because a row split
// down the middle cannot be read back together.
export function _bomBandPlan(w, h, box){
  const [x0,y0,x1,y1]=_bomClampBox(box);
  const bw=(x1-x0)*w, bh=(y1-y0)*h;
  const scale=Math.min(_BOM_VIS_MAX_SCALE, _BOM_VIS_MAX/Math.max(bw,1));
  const pxW=Math.round(bw*scale), pxH=Math.round(bh*scale);
  const step=Math.round(_BOM_VIS_MAX*(1-_BOM_VIS_OVERLAP));
  const bands=[];
  if(pxH<=_BOM_VIS_MAX) bands.push({top:0, height:pxH});
  else for(let top=0; top<pxH; top+=step){
    const height=Math.min(_BOM_VIS_MAX, pxH-top);
    bands.push({top, height});
    if(top+height>=pxH) break;
  }
  return {scale, x0px:Math.round(x0*w*scale), y0px:Math.round(y0*h*scale), pxW, pxH, bands};
}
export function _bomClampBox(box){
  const b=(Array.isArray(box)?box:[0,0,1,1]).map(v=>Math.max(0,Math.min(1,Number(v)||0)));
  let [x0,y0,x1,y1]=b;
  if(x1<x0) [x0,x1]=[x1,x0];
  if(y1<y0) [y0,y1]=[y1,y0];
  // A located box is padded: the model's corners are approximate, and a
  // header row or a last line clipped off is a part that silently goes missing.
  const px=0.02, py=0.02;
  x0=Math.max(0,x0-px); y0=Math.max(0,y0-py); x1=Math.min(1,x1+px); y1=Math.min(1,y1+py);
  if(x1-x0<0.05){ x0=Math.max(0,x0-0.05); x1=Math.min(1,x1+0.05); }
  if(y1-y0<0.05){ y0=Math.max(0,y0-0.05); y1=Math.min(1,y1+0.05); }
  return [x0,y0,x1,y1];
}
export async function _bomRenderBands(page, box){
  const base=page.getViewport({scale:1});
  const plan=_bomBandPlan(base.width, base.height, box);
  const out=[];
  for(const band of plan.bands){
    // Only the band is drawn: the viewport is shifted so the region lands at
    // the canvas origin, and the canvas is the size of the band — a sheet at
    // 8× would otherwise be a canvas of hundreds of megabytes.
    const vp=page.getViewport({scale:plan.scale, offsetX:-plan.x0px, offsetY:-(plan.y0px+band.top)});
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,plan.pxW); canvas.height=Math.max(1,band.height);
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx, viewport:vp}).promise;
    out.push(canvas.toDataURL('image/jpeg',0.92).split(',')[1]);
  }
  return out;
}

// ── Image encoding ─────────────────────────────────────────────────────────────
export function encodeImage(file){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const url=e.target.result;
      res({b64:url.split(',')[1], mimeType:url.split(';')[0].slice(5)});
    };
    reader.onerror=rej;
    reader.readAsDataURL(file);
  });
}
// ── Generic file → base64 (for PDF vision) ──────────────────────────────────
export function fileToB64(file){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=e=>res(e.target.result.split(',')[1]);
    reader.onerror=rej;
    reader.readAsDataURL(file);
  });
}
