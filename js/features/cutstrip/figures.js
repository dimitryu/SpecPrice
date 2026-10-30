import { esc } from '../../core/ui.js';
import { _csAllowanceDoubles, _csBreakouts, _csConnectors, _csCutLength, _csIsBreakout, _csMM, _csNum, _csOverall, _csSegLabel, _csSegments } from '../../domain/cutstrip.js';
import { _csP, _csRTL, _csT } from './i18n.js';
import { _csCutFormula } from './sheet.js';

// The drawing itself, with the few numbers it does not carry: the CUT length of
// each run, allowances included. Everything else on the sheet already exists on
// the drawing, so nothing is redrawn and nothing is covered.
//
// A callout is pinned to the run only when the analysis gave a point AND said it
// was sure. Otherwise it drops to the numbered list underneath, which is always
// rendered in full — so every run is accounted for whether it got a pin or not.
export function _csCallouts(spec){
  return _csSegments(spec).map((seg,i)=>
    ({n:i+1, seg, cut:_csCutLength(seg, spec), label:_csSegLabel(seg)}));
}

export function _csSourceFigure(spec){
  if(!spec || !spec.source_image) return '';
  const T=_csT, rtl=_csRTL()?' dir="rtl"':'';
  const calls=_csCallouts(spec);
  return `
  <figure class="cs-fig" style="margin:0">
    <img src="data:image/jpeg;base64,${esc(spec.source_image)}" alt=""
         style="display:block;max-width:100%;height:auto;border:1px solid #CBD5E1;border-radius:4px"/>
    ${_csAllowanceDoubles(spec).length ? `
    <div class="cs-box cs-stop" style="margin-bottom:10px">
      <b>${esc(T('A strip dimension looks like it was also counted as an allowance'))}</b>
      <ul>${_csAllowanceDoubles(spec).map(d=>`<li><span class="cs-ltr"><b>${esc(d.seg)} · ${esc(d.ref)}</b>:
        ${esc(T('the allowance'))} <b>${d.mm} mm</b> ${esc(T('is the same as strip dimension'))}
        <b>${esc(d.code)}</b></span>${d.reason?` — ${esc(_csP(d.reason))}`:''}</li>`).join('')}</ul>
      <p>${esc(T('Stripping removes jacket, not length — a bared conductor is still where it was. If this is the strip counted twice, the cut length is too long by that much at each end. Check before cutting.'))}</p>
    </div>` : ''}
    <table class="cs-tbl" style="margin-top:10px"><thead><tr>
      <th style="width:6%">#</th><th style="width:22%">${esc(T('Cable run'))}</th>
      <th style="width:14%">${esc(T('Finished'))}</th><th style="width:15%">${esc(T('Cut length'))}</th>
      <th style="width:43%">${esc(T('How it adds up'))}</th></tr></thead>
      <tbody>${calls.map(c=>`<tr>
        <td class="cs-ctr cs-ltr"><b>${c.n}</b></td>
        <td class="cs-ltr">${esc(c.seg.id||'')} · ${esc(c.label)}</td>
        <td class="cs-ctr cs-ltr cs-nowrap">${esc(_csMM(c.cut.finished))}</td>
        <td class="cs-ctr cs-ltr cs-nowrap"><b style="color:#7C2D12">${esc(_csMM(c.cut.total))}</b></td>
        <td class="cs-ltr" style="font:12px/1.4 monospace">${esc(_csCutFormula(c.seg, spec))}</td></tr>`).join('')}
      </tbody></table>
    <figcaption style="font-size:11.5px;color:#64748B;margin-top:6px"${rtl}>${
      esc(T('The drawing as supplied, with the title block masked. Nothing is drawn over the harness; the cut lengths are in the table above.'))}</figcaption>
  </figure>`;
}

// ── Generated diagrams ────────────────────────────────────────────────────────
// Drawn FROM the spec, not from a fixed template: every connector on the drawing
// gets a body, every cable run gets a line scaled to its real length, and sleeves
// and markers land at their real distances. That way the picture and the numbers
// cannot disagree — which is the whole reason for drawing it rather than just
// tabulating it.

export const _CS_SVG={ x0:200, x1:772, w:1000 };   // right margin leaves room for the CUT callout
// Everything drawn into an SVG goes through here. AI output can contain < & "
// and an unescaped one silently breaks the whole figure.
export function _csSvgTxt(s){ return esc(String(s||'')); }

export function _csConnBox(x, y, ref, pn, side, kind){
  // Open wires are not a connector body — drawing one would tell the operator to
  // fit something that does not exist.
  if(kind==='open_wires'){
    let w='';
    for(let i=0;i<5;i++){ const wy=y-16+i*8;
      w+=`<line x1="${x-46}" y1="${wy}" x2="${x}" y2="${y}" stroke="#94A3B8" stroke-width="2"/>`; }
    return w+`<text x="${x-52}" y="${y-24}" text-anchor="end" font-size="12.5" font-weight="800" fill="#1E293B">${_csSvgTxt(ref)}</text>`;
  }
  return _csConnBoxPlain(x,y,ref,pn,side);
}
export function _csConnBoxPlain(x, y, ref, pn, side){
  // side: 'left' = cable leaves to the right, 'right' = cable arrives from the left
  const bw=46, bh=34, sh=12;
  const bx = (side==='left') ? x-bw : (side==='right2' ? x-bw : x);
  const g = `<g stroke="#1E293B" stroke-width="1.6" fill="#E2E8F0">
      <rect x="${bx}" y="${y-bh/2}" width="${bw}" height="${bh}"/>
      <rect x="${(side==='left')?bx-sh:(side==='right2'?bx-sh:bx+bw)}" y="${y-bh/2+6}" width="${sh}" height="${bh-12}" fill="#94A3B8"/>
    </g>
    <text x="${bx+bw/2}" y="${y-bh/2-8}" text-anchor="middle" font-size="14" font-weight="800" fill="#1E293B">${_csSvgTxt(ref)}</text>`;
  return g + (pn ? `<text x="${bx+bw/2}" y="${y+bh/2+15}" text-anchor="middle" font-size="10" font-family="monospace" fill="#64748B">${_csSvgTxt(pn)}</text>` : '');
}

// Each marker is placed on exactly one run: the one it names, else the first run
// that actually touches the end it is measured from, else the first run. Returns
// a map keyed by segment id so the renderer never has to guess twice.
export function _csMarkersBySeg(spec){
  const segs=_csSegments(spec), by={};
  segs.forEach(sg=>{ by[sg.id]=[]; });
  const eq=(a,b)=>String(a||'').toUpperCase()===String(b||'').toUpperCase();
  (spec.markers||[]).forEach(mk=>{
    let sg = mk.segment && segs.find(x=>x.id===mk.segment);
    if(!sg) sg = segs.find(x=>eq(x.from,mk.from_end)||eq(x.to,mk.from_end));
    if(!sg) sg = segs[0];
    if(sg) (by[sg.id]=by[sg.id]||[]).push(mk);
  });
  return by;
}

export function _csHarnessSVG(spec){
  const T=_csT, rtlAttr=_csRTL()?' direction="rtl"':'';
  const segs=_csSegments(spec), conns=_csConnectors(spec);
  const marksBySeg=_csMarkersBySeg(spec);
  const pnOf=ref=>(conns.find(c=>String(c.ref||'').toUpperCase()===String(ref||'').toUpperCase())||{}).part_number||'';
  const kindOf=ref=>(conns.find(c=>String(c.ref||'').toUpperCase()===String(ref||'').toUpperCase())||{}).kind||'connector';
  if(!segs.length) return `<svg viewBox="0 0 1000 60" xmlns="http://www.w3.org/2000/svg"><text x="500" y="35" text-anchor="middle" font-size="13" fill="#64748B">—</text></svg>`;

  // The layout follows the drawing rather than an abstract graph: whatever the
  // branches fan out from sits in the middle, the longest run off it goes right
  // as the trunk, and the rest stack on the left. On a breakout harness that
  // reproduces the shape an operator already recognises — connectors on one
  // side, one long trunk to the far connector on the other.
  const brk=_csBreakouts(spec).map(b=>String(b.id));
  const touch={};
  segs.forEach(sg=>{ [sg.from,sg.to].filter(Boolean).forEach(r=>{ touch[r]=(touch[r]||0)+1; }); });
  const hub = brk.find(id=>touch[id]) || Object.keys(touch).sort((a,b)=>touch[b]-touch[a])[0];
  const hubIsBreakout=_csIsBreakout(spec, hub);

  const attached=segs.filter(sg=>String(sg.from)===hub||String(sg.to)===hub);
  const rest    =segs.filter(sg=>!attached.includes(sg));
  const row=sg=>{ const far=String(sg.from)===hub?sg.to:sg.from;
                  return {seg:sg, far, len:_csCutLength(sg, spec).total, fin:_csNum(sg.finished_length_mm)}; };
  let rows=attached.map(row);
  // Stack the branches in the order the DRAWING lists them, not by length. The
  // connector list is read off the assembly view top to bottom, so following it
  // puts P2/P3/P4 where the operator expects them; sorting by length reshuffled
  // them to P2/P4/P3 and stopped the figure matching the drawing it came from.
  const ordOf=ref=>{
    const i=conns.findIndex(c=>String(c.ref||'').toUpperCase()===String(ref||'').toUpperCase());
    return i<0 ? 999 : i;
  };
  rows.sort((a,b)=>ordOf(a.far)-ordOf(b.far));
  // The trunk is the longest run off a breakout; it is drawn to the right alone.
  const trunk = (hubIsBreakout && rows.length>1)
    ? rows.splice(rows.reduce((bi,r,i,arr)=>(_csNum(r.len)||0)>(_csNum(arr[bi].len)||0)?i:bi,0),1)[0]
    : null;
  const branches=rows.concat(rest.map(sg=>({seg:sg, far:sg.to, len:_csCutLength(sg, spec).total, fin:_csNum(sg.finished_length_mm), _loose:true})));

  const bundled = !hubIsBreakout && branches.length>1;
  const bundleMarks = bundled
    ? (spec.markers||[]).filter(m=>
        String(m.from_end||'').toUpperCase()===String(hub||'').toUpperCase() && _csNum(m.distance_mm)==null)
    : [];
  // Drawn once, on the bundle — so they must not also be drawn on a run.
  Object.keys(marksBySeg).forEach(k=>{
    marksBySeg[k]=marksBySeg[k].filter(m=>!bundleMarks.includes(m));
  });

  const maxLen=Math.max(...segs.map(sg=>_csNum(_csCutLength(sg, spec).total)||0), 1);
  const TOP=76, HUBX=560, LEFT=150;
  // A run carrying five label dimensions needs more vertical room than one
  // carrying none. A fixed row height was letting the lower annotations of one
  // run land on top of the next run's cable — which is how a 200 mm dimension
  // ended up looking like it belonged to the 180 mm branch below it.
  const rowH=r=>{
    const marks=(marksBySeg[r.seg.id]||[]).length;
    const cut=_csCutLength(r.seg, spec);
    // Room for: the length dimension (y+46), the annotation stack starting at
    // y+70, one line per label, and clearance for the NEXT run's own caption,
    // which is drawn 16px above its cable. Too small and the last note lands on
    // the next run's title — which is what "F" was doing to "S2 · MR3010E".
    return 96 + marks*20 + ((cut.hasBreakdown&&cut.added!==0)?32:0);
  };
  const heights=branches.map(rowH);
  const rowY=[]; let acc=TOP+16;
  heights.forEach(h=>{ rowY.push(acc); acc+=h; });
  const bodyH=Math.max(acc-TOP-16, 100);
  const H = TOP + bodyH + (trunk?90:46) + 56 + (segs.length===1?26:0);
  const hubY = branches.length ? (rowY[0]+rowY[rowY.length-1])/2 : TOP+16;

  const W=1180, RIGHT=W-120;
  let g='';

  // Where two or more runs arrive at the same connector and the drawing says
  // they are laced together, the common stretch is ONE bundle. Draw it as one.
  const MERGEX = HUBX-150;
  if(bundled){
    g+=`<line x1="${MERGEX}" y1="${hubY}" x2="${HUBX-18}" y2="${hubY}" stroke="#334155" stroke-width="15" stroke-linecap="round"/>
        <line x1="${MERGEX}" y1="${hubY}" x2="${HUBX-18}" y2="${hubY}" stroke="#94A3B8" stroke-width="9" stroke-linecap="round"/>`;
    const bn=spec.bundle||{};
    const meth=[_csP(bn.method||''), bn.part_number||''].filter(Boolean).join(' · ');
    // Clear of the connector's own ref, which _csConnBoxPlain sets at y-bh/2-8.
    g+=`<text x="${(MERGEX+HUBX)/2}" y="${hubY-44}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155"${rtlAttr}>${
      _csSvgTxt(T('Laced into one bundle'))}${meth?` — ${_csSvgTxt(meth)}`:''}</text>`;
    if(_csNum(bn.length_mm)!=null)
      // Under the caption, not under the cable: the connector's part number is
      // already printed below the bundle line.
      g+=`<text x="${(MERGEX+HUBX)/2}" y="${hubY-28}" text-anchor="middle" font-size="10.5" font-family="monospace" fill="#64748B">${
        _csNum(bn.length_mm)} mm</text>`;
  }

  // hub itself
  if(hubIsBreakout){
    g+=`<ellipse cx="${HUBX}" cy="${hubY}" rx="15" ry="26" fill="#E2E8F0" stroke="#1E293B" stroke-width="1.6"/>
        <text x="${HUBX}" y="${hubY-34}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#334155"${rtlAttr}>${_csSvgTxt(T('Breakout'))}</text>
        <text x="${HUBX}" y="${hubY+45}" text-anchor="middle" font-size="10.5" font-family="monospace" fill="#64748B">${_csSvgTxt(hub)}</text>`;
  } else {
    g+=_csConnBox(HUBX, hubY, hub, pnOf(hub), 'left', kindOf(hub));
  }

  // branches fan out to the LEFT of the hub, stacked
  branches.forEach((r,i)=>{
    const y=rowY[i];
    const x0=LEFT;
    const sx = bundled ? MERGEX : HUBX-18;
    const path=`M ${sx} ${hubY} Q ${sx-40} ${hubY} ${sx-60} ${(hubY+y)/2} Q ${sx-80} ${y} ${sx-110} ${y} L ${x0+52} ${y}`;
    g+=`<path d="${path}" fill="none" stroke="#475569" stroke-width="6" stroke-linecap="round"/>
        <path d="${path}" fill="none" stroke="#CBD5E1" stroke-width="3.4" stroke-linecap="round"/>`;
    g+=_csConnBox(x0+52, y, r.far, pnOf(r.far), 'right2', kindOf(r.far));
    g+=_csRunAnnot(spec, r, x0+52, sx-110, y, rtlAttr, T, false, segs.length===1, marksBySeg[r.seg.id]);
  });

  // trunk runs right
  if(trunk){
    const y=hubY;
    g+=`<line x1="${HUBX+18}" y1="${y}" x2="${RIGHT}" y2="${y}" stroke="#475569" stroke-width="9" stroke-linecap="round"/>
        <line x1="${HUBX+18}" y1="${y}" x2="${RIGHT}" y2="${y}" stroke="#CBD5E1" stroke-width="5" stroke-linecap="round"/>`;
    g+=_csConnBox(RIGHT, y, trunk.far, pnOf(trunk.far), 'right', kindOf(trunk.far));
    g+=_csRunAnnot(spec, trunk, HUBX+18, RIGHT, y, rtlAttr, T, true, segs.length===1, marksBySeg[trunk.seg.id]);
  }

  // Labels measured from the shared connector belong on the bundle, not hanging
  // off one arbitrary branch — that is where the drawing prints them.
  if(bundled){
    bundleMarks.forEach((mk,k)=>{
      const x=HUBX-95-k*34;      // clear of the connector body at HUBX
      if(x<=MERGEX+8) return;
      g+=`<rect x="${(x-8).toFixed(1)}" y="${hubY-14}" width="16" height="28" fill="#fff" stroke="#1E293B" stroke-width="1.2"/>
          <text x="${x.toFixed(1)}" y="${hubY+5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0F172A">${_csSvgTxt(mk.label||'')}</text>`;
      if(mk.position)
        g+=`<line x1="${x.toFixed(1)}" y1="${hubY+15}" x2="${x.toFixed(1)}" y2="${hubY+34+k*17}" stroke="#B45309" stroke-width="1" stroke-dasharray="2,2"/>
            <text x="${x.toFixed(1)}" y="${hubY+46+k*17}" text-anchor="middle" font-size="10" font-weight="700" fill="#B45309"${rtlAttr}>${
              _csSvgTxt(_csP(mk.position))}</text>`;
    });
  }

  // The overall length, spanning the picture the way the drawing dimensions it.
  const ov=_csOverall(spec);
  if(ov.value!=null){
    const oy=H-58;
    g+=`<line x1="60" y1="${oy}" x2="${W-60}" y2="${oy}" stroke="#0F172A" stroke-width="1.4" marker-start="url(#csArL)" marker-end="url(#csAr)"/>
        <rect x="${W/2-150}" y="${oy-13}" width="300" height="22" fill="#fff"/>
        <text x="${W/2}" y="${oy-19}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#64748B"${rtlAttr}>${
          _csSvgTxt(T('Overall length'))}</text>
        <text x="${W/2}" y="${oy+5}" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0F172A" font-family="monospace">${ov.value} mm${
          ov.span?`  (${_csSvgTxt(ov.span)})`:''}</text>`;
  }
  // A label the model could not place on any run still has to reach the operator.
  const segIds=segs.map(x=>x.id);
  const unplaced=(spec.markers||[]).filter(m=>m.segment && !segIds.includes(m.segment));
  if(unplaced.length){
    g+=`<text x="30" y="${H-28}" font-size="10.5" font-weight="700" fill="#B45309"${rtlAttr}>${
      _csSvgTxt(T('Labels not placed on the figure'))}: ${_csSvgTxt(unplaced.map(m=>m.label||'?').join(', '))}</text>`;
  }

  const anyTBC=(spec.markers||[]).some(m=>m.confirmed===false);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Heebo, Public Sans, Arial, sans-serif" direction="ltr">
    <defs>
      <marker id="csAr" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#0F172A"/></marker>
      <marker id="csArL" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto"><path d="M9,0 L0,4.5 L9,9 z" fill="#0F172A"/></marker>
      <pattern id="csHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#334155" stroke-width="2.4"/></pattern>
    </defs>
    ${g}
    <text x="30" y="${H-12}" font-size="10.5" fill="#64748B"${rtlAttr}>${_csSvgTxt(T('All dimensions in millimetres. Not to scale.'))}</text>
    ${anyTBC?`<text x="${W/2}" y="${H-12}" text-anchor="middle" font-size="11" font-weight="700" fill="#DC2626"${rtlAttr}>* ${_csSvgTxt(T('TO BE CONFIRMED'))}</text>`:''}
    <text x="${W-20}" y="${H-12}" text-anchor="end" font-size="10.5" font-weight="700" fill="#64748B">${_csSvgTxt(spec.drawing_number||'')} · FIG. 1</text>
  </svg>`;
}

// Everything drawn along one run: its id and cable, the sleeves and markers
// that sit on it, the dimensioned length, and the cut length when they differ.
export function _csRunAnnot(spec, r, xFarEnd, xHubEnd, y, rtlAttr, T, isTrunk, showFormula, marks){
  const seg=r.seg, cut=_csCutLength(seg, spec);
  const len=_csNum(r.len)||0;
  const xa=Math.min(xFarEnd,xHubEnd), xb=Math.max(xFarEnd,xHubEnd);
  const scale=len>0 ? (xb-xa)/len : 0;
  // A distance is measured from a NAMED end, so it has to be laid off from that
  // end's own x — not from whichever end happens to be on the left of the page.
  const dir=xHubEnd>xFarEnd ? 1 : -1;   // +1 when the hub is to the right
  const at=(fromEnd, mm)=>{
    const d=(_csNum(mm)||0)*scale;
    return String(fromEnd||'').toUpperCase()===String(r.far).toUpperCase()
      ? xFarEnd + dir*d          // measured from the far connector, inwards
      : xHubEnd - dir*d;         // measured from the shared end, inwards
  };
  const anchorOf=fromEnd=>String(fromEnd||'').toUpperCase()===String(r.far).toUpperCase() ? xFarEnd : xHubEnd;
  let g=`<text x="${(xa+xb)/2}" y="${y-16}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155">${
    _csSvgTxt(seg.id||'')}${seg.cable_part_number?` · ${_csSvgTxt(seg.cable_part_number)}`:''}</text>`;

  (spec.sleeves||[]).filter(sl=>!sl.segment||sl.segment===seg.id).forEach(sl=>{
    // (sleeves stay per-segment: unlike labels they are always dimensioned)
    const w=Math.max(6,(_csNum(sl.length_mm)||0)*scale);
    // The sleeve starts at its distance and occupies w INWARDS from that end.
    const x0s=at(sl.from_end, sl.distance_mm);
    const inward=(anchorOf(sl.from_end)===xFarEnd) ? dir : -dir;
    const x=inward>0 ? x0s : x0s-w;
    g+=`<rect x="${x.toFixed(1)}" y="${y-11}" width="${w.toFixed(1)}" height="22" fill="url(#csHatch)" stroke="#1E293B" stroke-width="1"/>`;
  });

  const ly=y+46;   // clears the connector part number, which sits at y+30
  g+=`<line x1="${xa}" y1="${ly}" x2="${xb}" y2="${ly}" stroke="#0F172A" stroke-width="1.2" marker-start="url(#csArL)" marker-end="url(#csAr)"/>
      <rect x="${((xa+xb)/2-54)}" y="${ly-12}" width="108" height="19" fill="#fff"/>
      <text x="${((xa+xb)/2).toFixed(1)}" y="${ly+4}" text-anchor="middle" font-size="13" font-weight="800" fill="#0F172A">${
        cut.hasBreakdown&&cut.added!==0 ? cut.finished+' mm' : (_csNum(r.len)!=null?r.len+' mm':'? mm')}</text>`;
  let dimY=ly+24;
  if(cut.hasBreakdown && cut.added!==0){
    g+=`<rect x="${((xa+xb)/2-92)}" y="${dimY-13}" width="184" height="20" fill="#FEF3C7" stroke="#B45309" stroke-width="1"/>
        <text x="${((xa+xb)/2).toFixed(1)}" y="${dimY+1}" text-anchor="middle" font-size="11" font-weight="700" fill="#7C2D12"${rtlAttr}>${
          _csSvgTxt(T('CUT'))} ${cut.total} mm</text>`;
    dimY+=24;
    // The full sum is printed on the figure only when there is one run to print
    // it for. On a breakout harness four formulas would bury the drawing, and
    // each run's cut-length table carries its own arithmetic anyway.
    if(showFormula){
      g+=`<text x="${((xa+xb)/2).toFixed(1)}" y="${dimY}" text-anchor="middle" font-size="11.5" font-family="monospace" fill="#7C2D12">${_csSvgTxt(_csCutFormula(seg, spec))}</text>`;
      dimY+=22;
    }
  }
  const undim=(marks||[]).filter(m=>_csNum(m.distance_mm)==null);
  (marks||[]).forEach((mk,mi)=>{
    const anchor=anchorOf(mk.from_end), bad=mk.confirmed===false, col=bad?'#DC2626':'#334155';
    let x;
    if(_csNum(mk.distance_mm)==null){
      // No dimension: park it a readable step in from its end, clear of the
      // connector body, and step each further one along so they do not stack.
      const k=undim.indexOf(mk);
      x = anchor + ((anchor===xFarEnd) ? dir : -dir) * (46 + k*30);
    } else {
      x = at(mk.from_end, mk.distance_mm);
    }
    g+=`<rect x="${(x-7).toFixed(1)}" y="${y-13}" width="14" height="26" fill="#fff" stroke="#1E293B" stroke-width="1.2"/>
        <text x="${x.toFixed(1)}" y="${y+4}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0F172A">${_csSvgTxt(mk.label||'')}</text>`;
    if(_csNum(mk.distance_mm)==null){
      // No dimension on the drawing — a tick to the cable plus the placement
      // note in words, so the operator still knows where the label goes.
      g+=`<line x1="${x.toFixed(1)}" y1="${y+13}" x2="${x.toFixed(1)}" y2="${(dimY-9).toFixed(1)}" stroke="#B45309" stroke-width="1" stroke-dasharray="2,2"/>`;
      if(mk.position)
        g+=`<text x="${x.toFixed(1)}" y="${dimY+3}" text-anchor="middle" font-size="10" font-weight="700" fill="#B45309"${rtlAttr}>${
          _csSvgTxt(_csP(mk.position))}</text>`;
      dimY+=20; return;
    }
    g+=`<line x1="${Math.min(anchor,x).toFixed(1)}" y1="${dimY}" x2="${Math.max(anchor,x).toFixed(1)}" y2="${dimY}" stroke="${col}" stroke-width="1" marker-start="url(#csArL)" marker-end="url(#csAr)"/>
        <rect x="${((anchor+x)/2-22).toFixed(1)}" y="${dimY-10}" width="44" height="17" fill="#fff"/>
        <text x="${((anchor+x)/2).toFixed(1)}" y="${dimY+3}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${col}">${_csNum(mk.distance_mm)??'?'}${bad?' *':''}</text>`;
    dimY+=20;
  });
  return g;
}

// ── One figure per end ───────────────────────────────────────────────────────
// There used to be two: a pale layer diagram and a black-jacket wire-prep
// drawing. Two pictures of the same end is one picture too many — the operator
// has to work out which one governs, and the day they disagree somebody cuts to
// the wrong one. This is both of them: the shop's black-jacket drawing, showing
// every layer the strip actually exposes, with every dimension the end needs.
//
// The geometry is read straight off the cuts. Sorted from the smallest, they
// divide the exposed end into bands measured from the cable end:
//   0 → W   bare conductor strands
//   W → B   conductor insulation
//   B → A   whatever the jacket was hiding (shield, braid, inner sheath)
//   A → …   the jacket itself
// A single-insulation wire has only A, and comes out as the plain drawing the
// bench already knows.
//
// Millimetres only. The inch conversion was there because contact datasheets
// are written in inches, but nobody at the bench measures in them, and two
// numbers on one dimension line is an invitation to read the wrong one.
export const _CS_FIG_STRANDS=7;
export function _csStripSVG(seg, end, spec){
  const T=_csT;
  let cuts=(end?.strip||[]).filter(s=>!s.derived && _csNum(s.value_mm)>0)
    .map(s=>({code:String(s.code||''), mm:_csNum(s.value_mm), confirmed:s.confirmed!==false,
              label:String(s.label||'')}))
    .sort((a,b)=>a.mm-b.mm);
  const cs=_csNum(seg?.conductor_strip_mm);
  if(cs!=null && cs>0)
    cuts.unshift({code:'W', mm:cs, confirmed:seg?.conductor_strip_confirmed!==false,
                  label:T('each conductor'), conductor:true});
  cuts.sort((a,b)=>a.mm-b.mm);
  // An end with no strip dimension still gets its drawing. The operator has to
  // prepare that end whatever the analysis managed to read, and a figure with a
  // blank dimension marked TBC is a usable instruction — an absent figure is
  // just a hole in the sheet where an end used to be.
  const unknown=!cuts.length;
  if(unknown) cuts=[{code:'A', mm:null, confirmed:false,
                     label:T('no strip dimension on the drawing — fill it in')}];

  const X_END=90, X_JACKET=470, X_TIP=1010;
  const A=unknown ? null : cuts[cuts.length-1].mm;   // the outermost cut sets the scale
  const S=(A!=null && A>0) ? (X_JACKET-X_END)/A : 1;
  const CY=210, JH=64;
  // With nothing to scale to, the bands are laid out evenly: the picture is
  // schematic, and the numbers beside it say so.
  const at=mm=>{
    if(A==null || mm==null) return X_JACKET;
    return X_END+mm*S;
  };

  // Everything the jacket was covering, drawn band by band from the end.
  // Each cut removes one layer and exposes the next one down, so the band a cut
  // opens up is named by the layer BELOW the one it took off — the outermost cut
  // takes the jacket and shows layer 2, the next takes layer 2 and shows layer 3.
  const layers=(seg?.layers||[]).filter(l=>l && (l.name||_csNum(l.od_mm)!=null));
  const _isBraid=n=>/shield|braid|drain|מסך|צמה/i.test(String(n||''));
  let g='';
  // band between each pair of cuts, outermost first so the jacket is drawn last
  for(let i=cuts.length-1;i>=1;i--){
    const xL=at(cuts[i-1].mm), xR=at(cuts[i].mm);
    const depth=(cuts.length-1)-i;                 // 0 = the band the jacket cut opens
    const h=JH*(0.80-0.16*depth);
    const layer=layers[depth+1];
    const nm=layer ? _csP(layer.name||'') : '';
    const braid=_isBraid(layer&&layer.name);
    g+=`<rect x="${xL.toFixed(1)}" y="${(CY-h/2).toFixed(1)}" width="${(xR-xL).toFixed(1)}"
          height="${h.toFixed(1)}" fill="${braid?'#9AA4B2':'#CBD5E1'}" stroke="#475569" stroke-width="1.2"/>`;
    if(braid){
      // a braid reads as a braid, not as a grey box
      for(let x=xL+8;x<xR-4;x+=11)
        g+=`<path d="M${x.toFixed(1)},${(CY-h/2).toFixed(1)} l8,${h.toFixed(1)}" stroke="#6B7280" stroke-width="1" fill="none"/>`;
    }
    if(nm) g+=`<text x="${((xL+xR)/2).toFixed(1)}" y="${(CY-h/2-9).toFixed(1)}" text-anchor="middle"
        font-size="12" font-weight="700" fill="#334155">${_csSvgTxt(nm)}</text>`;
  }
  // bare strands, from the cable end to the innermost cut
  const xBare=at(cuts[0].mm);
  for(let i=0;i<_CS_FIG_STRANDS;i++){
    const off=(i-(_CS_FIG_STRANDS-1)/2)*8.5;
    const y0=CY+off*0.72, y1=CY-off*0.5, y2=CY+off*0.62, y3=CY+off*0.3;
    g+=`<path d="M${X_END},${y0.toFixed(1)} C${X_END+60},${y1.toFixed(1)} ${xBare-70},${y2.toFixed(1)} ${xBare.toFixed(1)},${y3.toFixed(1)}"
      fill="none" stroke="#C2703A" stroke-width="2.1" stroke-linecap="round"/>`;
  }
  // the jacket
  g+=`<rect x="${X_JACKET}" y="${CY-JH/2}" width="${X_TIP-X_JACKET}" height="${JH}" rx="${JH/2}" fill="#1A1A22"/>
      <rect x="${X_JACKET}" y="${CY-JH/2}" width="34" height="${JH}" fill="#1A1A22"/>
      <line x1="${X_JACKET+28}" y1="${CY-10}" x2="${X_TIP-24}" y2="${CY-10}" stroke="#6B7280" stroke-width="2.4"/>`;
  // every cut face, square to the axis
  cuts.forEach(c=>{ const x=at(c.mm);
    g+=`<line x1="${x.toFixed(1)}" y1="${CY-JH/2-8}" x2="${x.toFixed(1)}" y2="${CY+JH/2+8}" stroke="#DC2626" stroke-width="2.6"/>`; });

  // dimensions, largest at the bottom so the lines never cross
  let y=CY+JH/2+46;
  cuts.slice().reverse().forEach(c=>{
    const x=at(c.mm), col=c.confirmed?'#0F172A':'#DC2626';
    g+=`<line x1="${X_END}" y1="${y}" x2="${x.toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="1.5"
          marker-start="url(#csFigL)" marker-end="url(#csFigR)"/>
        <line x1="${x.toFixed(1)}" y1="${CY+JH/2+8}" x2="${x.toFixed(1)}" y2="${(y+7).toFixed(1)}" stroke="${col}" stroke-width=".9" stroke-dasharray="3 3"/>
        <text x="${X_END}" y="${y-9}" font-size="17" font-weight="800" fill="${col}">${
          _csSvgTxt(c.code?`${c.code} = `:'')}${c.mm==null?'?':c.mm} mm${c.confirmed?'':' *'}</text>
        <text x="${(x+14).toFixed(1)}" y="${y+5}" font-size="11.5" fill="#64748B">${_csSvgTxt(_csP(c.label||''))}</text>`;
    y+=42;
  });
  g+=`<line x1="${X_END}" y1="${CY-JH/2-8}" x2="${X_END}" y2="${(y-30).toFixed(1)}" stroke="#94A3B8" stroke-width=".9" stroke-dasharray="3 3"/>`;

  // what this end costs the cut length — the same two numbers the cut table
  // prints, read from the same fields, so they cannot drift apart
  const ec=(_csCutLength(seg, spec).endCosts||[])
    .find(e=>String(e.ref||'').toUpperCase()===String(end?.ref||'').toUpperCase());
  if(ec){
    // Under the over-the-connectors convention this end costs the cut nothing:
    // the strip is taken OUT of the drawn length. Printing "5 + 0 = 0 mm"
    // there was arithmetic nobody could follow, so the box says what is
    // actually true of that end instead of forcing it into the same sum.
    const adds = _csNum(ec.mm)!==0 || _csNum(ec.conn)>0;
    const head = adds ? T('This end adds to the cut length')
                      : T('This end adds nothing — the strip comes out of the drawn length');
    const sum  = adds ? `${ec.strip} + ${ec.margin}${ec.conn?` − ${ec.conn}`:''} = ${ec.mm} mm`
                      : `${_csT('strip')} ${ec.strip} mm ⊂ ${_csMM(_csCutLength(seg, spec).total)}`;
    g+=`<rect x="330" y="${y-4}" width="440" height="44" fill="#FEF3C7" stroke="#B45309" stroke-width="1"/>
        <text x="550" y="${y+14}" text-anchor="middle" font-size="12" font-weight="700" fill="#7C2D12">${
          _csSvgTxt(head)}</text>
        <text x="550" y="${y+33}" text-anchor="middle" font-size="15" font-weight="800" fill="#7C2D12" font-family="monospace">${
          _csSvgTxt(sum)}</text>`;
    y+=54;
  }

  const conn=(_csConnectors(spec)||[]).find(c=>String(c.ref||'').toUpperCase()===String(end?.ref||'').toUpperCase());
  const sub=[seg?.cable_part_number, conn&&conn.part_number, conn&&conn.contact_pn]
    .map(x=>String(x||'').trim()).filter(Boolean).join('   |   ');
  const term=String(conn&&conn.termination||'').toLowerCase();
  const termLine = /solder/.test(term) ? T('SOLDER TERMINATION')
                 : /crimp/.test(term)  ? T('CRIMP TERMINATION — DO NOT TIN')
                 : T('DO NOT TIN STRANDS BEFORE TERMINATION');
  const H=y+78;
  const anyTBC=cuts.some(c=>!c.confirmed);
  return `<svg viewBox="0 0 1100 ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Heebo, Public Sans, Arial, sans-serif" direction="ltr">
    <defs>
      <marker id="csFigR" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#0F172A"/></marker>
      <marker id="csFigL" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto"><path d="M9,0 L0,4.5 L9,9 z" fill="#0F172A"/></marker>
    </defs>
    <rect x="6" y="6" width="1088" height="${H-12}" fill="#fff" stroke="#0F172A" stroke-width="1.6"/>
    <text x="24" y="30" font-size="12" fill="#94A3B8">${_csSvgTxt(`${seg?.id||''} · ${end?.ref||''}`)}</text>
    <text x="550" y="58" text-anchor="middle" font-size="26" font-weight="800" fill="#0F172A" letter-spacing="1">${
      _csSvgTxt(T('WIRE END PREPARATION'))}</text>
    ${sub?`<text x="550" y="88" text-anchor="middle" font-size="15" fill="#334155">${_csSvgTxt(sub)}</text>`:''}
    ${g}
    <text x="550" y="${H-46}" text-anchor="middle" font-size="15" font-weight="800" fill="#0F172A">${
      _csSvgTxt(T('STRIP INSULATION ONLY — DO NOT CUT OR NICK CONDUCTOR STRANDS'))}</text>
    <text x="550" y="${H-25}" text-anchor="middle" font-size="13" fill="#475569">${_csSvgTxt(termLine)}</text>
    ${anyTBC?`<text x="550" y="${H-8}" text-anchor="middle" font-size="12" font-weight="700" fill="#DC2626">* ${
      _csSvgTxt(T('TO BE CONFIRMED'))}</text>`:''}
  </svg>`;
}
