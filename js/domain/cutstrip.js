export function _csNum(v){ const n=parseFloat(v); return Number.isFinite(n)?n:null; }
export function _csMM(v){ const n=_csNum(v); return n==null ? '—' : (Math.round(n*100)/100)+' mm'; }
export function _csR(n){ return Math.round(n*1000)/1000; }

// ── Harness model ─────────────────────────────────────────────────────────────
// A harness is CONNECTORS joined by SEGMENTS. One segment is one continuous cable
// run between two connectors; a multi-conductor segment additionally carries the
// wire-by-wire table the operator terminates from.
//
// The first version of this modelled a harness as one cable with two ends, which
// silently lost most of a real drawing: a wing-servo harness with three
// connectors and two cable runs came back as a single run with one end. Anything
// the model cannot represent is something the operator never sees, so the shape
// has to match the work.
//
// Specs saved under the old shape are migrated on read rather than left behind.
export function _csSegments(spec){ return Array.isArray(spec?.segments) ? spec.segments : []; }
// A breakout is the point where a trunk fans out into branches. It is a NODE,
// not a connector: nothing is terminated there, so it gets no strip dimensions
// and no part number — but runs start and end at it, so it has to exist in the
// model or a breakout harness can only be described as a chain of connectors,
// which is a different harness from the one on the drawing.
export function _csBreakouts(spec){ return Array.isArray(spec?.breakouts) ? spec.breakouts : []; }
export function _csIsBreakout(spec, ref){
  const r=String(ref||'').toUpperCase();
  return _csBreakouts(spec).some(b=>String(b?.id||'').toUpperCase()===r);
}
export function _csConnectors(spec){ return Array.isArray(spec?.connectors) ? spec.connectors : []; }
export function _csSegLabel(seg){
  const f=String(seg?.from||'').trim(), t=String(seg?.to||'').trim();
  return (f&&t) ? `${f} → ${t}` : (seg?.id||'');
}
export function _csSegEnds(seg, spec){
  const listed=Array.isArray(seg?.ends)?seg.ends:[];
  const isBrk=ref=>spec ? _csIsBreakout(spec, ref) : false;
  // A segment always has two physical ends. If the model only described one,
  // synthesise the other from `to` rather than dropping half the work.
  const refs=[seg?.from, seg?.to].filter(Boolean).map(String);
  return refs.map(ref=>{
    const found=listed.find(e=>String(e?.ref||'').toUpperCase()===ref.toUpperCase());
    // The junction flag depends on the REF, not on whether the model happened to
    // list that end — otherwise a breakout the model did list would be treated
    // as a real termination and the sheet would ask for strip dimensions there.
    if(found) return isBrk(ref) ? {...found, _breakout:true} : found;
    return {ref, strip:[], _missing:!isBrk(ref), _breakout:isBrk(ref)};
  }).concat(listed.filter(e=>!refs.some(r=>r.toUpperCase()===String(e?.ref||'').toUpperCase())));
}

// Old shape → new shape. Runs on parse AND on load, so a spec saved months ago
// renders through exactly the same code path as one made today.
export function _csNormalize(spec){
  if(!spec || typeof spec!=='object') return spec;
  spec.connectors = Array.isArray(spec.connectors) ? spec.connectors : [];
  spec.segments   = Array.isArray(spec.segments)   ? spec.segments   : [];
  spec.breakouts  = Array.isArray(spec.breakouts)  ? spec.breakouts  : [];
  spec.route_dimensions = Array.isArray(spec.route_dimensions) ? spec.route_dimensions : [];
  // Specs saved before these fields existed load straight from Firestore without
  // passing through the parser, so the defaults have to live here as well.
  spec.engineering_notes = Array.isArray(spec.engineering_notes) ? spec.engineering_notes : [];
  spec.markers    = Array.isArray(spec.markers)  ? spec.markers  : [];
  if(spec.bundle && typeof spec.bundle!=='object') spec.bundle=null;

  if(!spec.segments.length && spec.cable){
    const c=spec.cable, legacyEnds=Array.isArray(spec.ends)?spec.ends:[];
    spec.segments=[{
      id:'S1',
      from: legacyEnds[0]?.ref || 'P1',
      to:   legacyEnds[1]?.ref || 'J1',
      cable_part_number:c.part_number||'', cable_description:c.description||'',
      type:c.type||'coax',
      finished_length_mm:c.finished_length_mm ?? null,
      length_basis:c.length_basis||'unclear',
      allowances:Array.isArray(c.allowances)?c.allowances:[],
      trim_allowance_mm:c.trim_allowance_mm ?? 0,
      trim_allowance_confirmed:c.trim_allowance_confirmed===true,
      cut_length_mm:c.cut_length_mm ?? null,
      cut_length_tolerance_mm:c.cut_length_tolerance_mm ?? null,
      cut_length_tolerance_confirmed:c.cut_length_tolerance_confirmed===true,
      layers:Array.isArray(c.layers)?c.layers:[],
      layers_confirmed:c.layers_confirmed!==false,
      ends:legacyEnds.map(e=>({ref:e.ref, strip:Array.isArray(e.strip)?e.strip:[],
                               strip_tolerance_mm:e.strip_tolerance_mm ?? null})),
      conductors:[], conductor_strip_mm:null, conductor_strip_confirmed:false,
      shield_treatment:'',
      _migrated:true,
    }];
    if(!spec.connectors.length)
      spec.connectors=legacyEnds.map(e=>({ref:e.ref, part_number:e.connector_pn||'',
        manufacturer:'', description:e.description||'', positions:null,
        termination:e.termination||'', contact_pn:'', datasheet_ref:e.datasheet_ref||''}));
  }

  // Connectors referenced by a segment but never described still need a row —
  // otherwise the operator sees a run going to a connector that isn't listed.
  const known=new Set(spec.connectors.map(c=>String(c?.ref||'').toUpperCase()));
  spec.segments.forEach(seg=>{
    seg.ends       = Array.isArray(seg.ends) ? seg.ends : [];
    seg.layers     = Array.isArray(seg.layers) ? seg.layers : [];
    seg.allowances = Array.isArray(seg.allowances) ? seg.allowances : [];
    seg.conductors = Array.isArray(seg.conductors) ? seg.conductors : [];
    seg.ends.forEach(e=>{ e.strip = Array.isArray(e.strip) ? e.strip : []; });
    [seg.from, seg.to].filter(Boolean).forEach(ref=>{
      if(_csIsBreakout(spec, ref)) return;      // a junction, not something to terminate
      if(!known.has(String(ref).toUpperCase())){
        known.add(String(ref).toUpperCase());
        spec.connectors.push({ref:String(ref), part_number:'', manufacturer:'',
          description:'', positions:null, termination:'', contact_pn:'', datasheet_ref:'',
          _inferred:true});
      }
    });
  });
  spec.segments.forEach((seg,i)=>{ if(!seg.id) seg.id='S'+(i+1); });
  return spec;
}

// ── Cut length, per segment ───────────────────────────────────────────────────
// The number on the drawing is almost never the number to cut. Cable is consumed
// by whatever sits inside each connector, by the jacket strip that lets the
// conductors fan out, and by squaring the end and re-doing a bad strip. Cutting
// to the dimensioned length produces a run that is short — which is scrap,
// because you cannot add cable back.
//
// The sum is computed HERE from its parts rather than taken from the model's own
// cut_length_mm. If the two disagree, the parts win: an operator can check
// 150 + 25 + 4 + 5, and cannot check a single number that arrived out of nowhere.
// Radion's convention, confirmed by Dima: the length dimensioned on a drawing runs
// to where the JACKET ends, not to the connector face. So every end costs the
// jacket strip plus a fixed handling margin, and a 180 mm run is cut at
//   180 + (8 + 1.5) + (8 + 1.5) = 199 mm.
//
// The strip term is READ FROM THE STRIP DIMENSIONS, never from "allowances". That
// is what makes the double count structurally impossible rather than merely
// forbidden: the analysis supplies the strip once, in the one place it belongs,
// and the app does the adding.
export const _CS_END_MARGIN_MM = 1.5;
export const _CS_BASIS_JACKET  = 'to_jacket_end';
export const _CS_CUT_MODEL     = 'jacket_end_v1';   // stamped on every new analysis

export function _csEndMargin(seg, spec){
  const v=_csNum(seg?.end_margin_mm);
  if(v!=null) return v;
  const g=_csNum(spec?.end_margin_mm);
  return g!=null ? g : _CS_END_MARGIN_MM;
}
// The jacket strip at one end: the outermost cut, which by the layer rule is the
// first non-derived entry. Derived values (C = A − B and friends) are consequences
// of the others and would double-count if included.
export function _csJacketStrip(end){
  const first=(end?.strip||[]).find(x=>!x.derived && _csNum(x.value_mm)!=null);
  return first ? {mm:_csNum(first.value_mm), code:first.code||'', confirmed:first.confirmed===true} : null;
}

// ── What the drawing's length actually measures ──────────────────────────────
// A cable drawn "4000" is not one number, it is three different cuts depending
// on where the dimension is taken from:
//
//   to_jacket_end    from where the jacket ends at one end to where it ends at
//                    the other. The cable inside each connector is extra, so it
//                    is ADDED. This is the shop's default.
//   cable_only       the dimension IS the piece of cable. Nothing is added for
//                    the ends at all.
//   over_connectors  the dimension spans the assembled harness, connector face
//                    to connector face. The connector bodies are part of that
//                    length, so the cable is SHORTER — their length comes OFF.
//
// Getting this wrong is not a rounding error: on a 4 m harness with two
// backshells it is tens of millimetres in the wrong direction, which is scrap.
// So the basis is named on the sheet, it drives the arithmetic, and when the
// drawing did not say, the sheet says that too instead of quietly assuming.
export const _CS_BASIS_CABLE   = 'cable_only';
export const _CS_BASIS_OVER    = 'over_connectors';
export const _CS_BASIS_LABEL={
  to_jacket_end:'to the jacket end at each end',
  cable_only:'the bare cable, connectors excluded',
  over_connectors:'over the connectors, face to face',
  unclear:'the drawing does not say',
};
// How far a connector extends beyond the point where the cable enters it. Only
// needed under over_connectors, and only then is its absence a problem.
export function _csEndConnLen(end, spec){
  const own=_csNum(end?.connector_length_mm);
  if(own!=null) return own;
  const c=(_csConnectors(spec)||[]).find(x=>String(x.ref||'').toUpperCase()===String(end?.ref||'').toUpperCase());
  const v=_csNum(c?.body_length_mm);
  return v!=null ? v : null;
}
// A harness whose overall dimension is taken between two terminated ends is
// dimensioned OVER those connectors: that arrow on the drawing runs from the
// face of one plug to the face of the other, and the finished article is that
// figure. It is how every harness drawing of this kind is made, and the shop
// rule that follows from it is absolute — the cut may never come out longer
// than the drawn length; the strip is taken out of it, never added to it.
// So when the analysis did not name the basis, that is what we assume, instead
// of the jacket-end convention, which would add millimetres at both ends and
// issue a cable too long to fit where it is going. The jacket-end default
// survives only where it is right: a run that does not end in connectors.
// The individually terminated conductors of a fan-out end, cleaned up.
export function _csEndLegs(end){
  return (Array.isArray(end?.legs)?end.legs:[]).filter(l=>l && (l.to||l.conductor||_csNum(l.length_mm)!=null));
}
export const _CS_FREE_END_RE=/\b(open|free|blunt|pigtail|flying|tinned|unterminated|bare|stripped|splice)\b/i;
export function _csRunIsBetweenConnectors(seg, spec){
  const ends=Array.isArray(seg?.ends) ? seg.ends : [];
  if(ends.length<2) return false;
  const conns=_csConnectors(spec)||[];
  // A free end is listed among the connectors too — as OPEN, a pigtail, a
  // blunt cut — so that the run has somewhere to finish. Those are not
  // connector bodies and a dimension does not span them, so they do not count.
  const bodied=c=>{
    const txt=`${c.kind||''} ${c.type||''} ${c.ref||''} ${c.part_number||''} ${c.description||''}`;
    return !_CS_FREE_END_RE.test(txt);
  };
  const named=r=>{
    const k=String(r||'').trim().toUpperCase();
    if(!k) return false;
    return conns.some(c=>String(c.ref||'').trim().toUpperCase()===k && bodied(c));
  };
  // An end that fans out into individually terminated conductors — ferrules,
  // lugs — is a finished end just as a connector is: the drawing's overall
  // length runs to the tips of those terminals, not to some point short of
  // them.
  const finished=e=>named(e.ref) || _csEndLegs(e).length>0;
  // Every end of the run has to be finished: one free end and the dimension
  // is measuring something else again.
  return ends.every(finished);
}
// Almost no drawing prints where its overall dimension is taken from, so the
// analysis's answer here is inference, not a reading — and on this family of
// drawings it guessed "to the jacket end" on a run that plainly goes connector
// face to connector face, which added 10 mm and turned four 3000 mm pieces out
// of a 12 m reel into three. The consequence of being wrong in that direction
// is a harness too long to fit and a reel short by a whole piece, so the
// geometry wins over the guess: two connector ends means the dimension spans
// them. A person who knows better says so in Edit and ticks Confirmed, and
// from then on their answer is the one that counts.
export function _csDatum(seg, spec){
  const declared=String(seg?.length_basis||'').trim();
  const known=[_CS_BASIS_JACKET,_CS_BASIS_CABLE,_CS_BASIS_OVER].includes(declared);
  const human=seg?.length_basis_confirmed===true;
  const between=_csRunIsBetweenConnectors(seg, spec);
  if(human && known)
    return {basis:declared, stated:true, assumed:'', overrode:'',
            label:_CS_BASIS_LABEL[declared], confirmed:true};
  // Only the jacket-end reading is overruled, and only because it is the one
  // that makes the piece LONGER than the drawing. "The bare cable" is a
  // different claim, not a guess about connector geometry, and it never
  // produces a cut past the dimension — so it is left alone.
  const unsafe = !known || declared===_CS_BASIS_JACKET;
  if(between && unsafe)
    return {basis:_CS_BASIS_OVER, stated:known, assumed:known?'':_CS_BASIS_OVER,
            // what the analysis had said, when we are not taking its word for it
            overrode:known ? declared : '',
            label:_CS_BASIS_LABEL[_CS_BASIS_OVER], confirmed:false};
  return {
    basis: known ? declared : _CS_BASIS_JACKET,
    stated: known,                                  // the drawing told us
    assumed: known ? '' : _CS_BASIS_JACKET,         // what we fell back to, and why it is on the sheet
    overrode: '',
    label: _CS_BASIS_LABEL[known?declared:'unclear'],
    confirmed: false,
  };
}

// ── A strip dimension, even when the drawing has none ────────────────────────
// A harness drawing usually does NOT dimension the strip: it belongs to the
// contact, not to the cable, and the number lives in the contact's datasheet.
// The operator still has to strip the wire, so a sheet that says nothing at
// that end is a sheet they cannot work from — which is exactly what came back
// from this drawing: two ends, both blank.
//
// So when nothing was read, the app proposes the ordinary strip for that wire
// gauge and marks it unconfirmed, with its basis written on the row. A number
// an engineer checks in thirty seconds beats a blank that stops the bench, and
// nothing here is ever presented as if it came off the drawing.
//
// Lengths are the usual bared length for a crimp barrel of that size; every
// one of them is a starting point, not a specification.
export const _CS_AWG_STRIP={28:2.5, 26:3.0, 24:3.0, 22:3.5, 20:4.0, 18:4.5, 16:5.0, 14:5.5, 12:6.5, 10:8.0};
export function _csAwgOf(seg, spec){
  const fromWire=(seg?.conductors||[]).map(w=>_csNum(w&&w.awg)).find(v=>v!=null);
  if(fromWire!=null) return fromWire;
  const texts=[seg?.cable_description, seg?.cable_part_number]
    .concat((spec?.materials||[]).filter(_csIsWireMaterial).map(m=>m.description))
    .map(x=>String(x||''));
  for(const t of texts){
    const m=/(\d{1,2})\s*AWG/i.exec(t);
    if(m) return parseInt(m[1],10);
  }
  return null;
}
export function _csStripForAwg(awg){
  const n=_csNum(awg);
  if(n==null) return null;
  if(_CS_AWG_STRIP[n]!=null) return _CS_AWG_STRIP[n];
  // between two sizes in the table, or off the end of it
  const keys=Object.keys(_CS_AWG_STRIP).map(Number).sort((a,b)=>a-b);
  if(n<keys[0]) return _CS_AWG_STRIP[keys[0]];
  if(n>keys[keys.length-1]) return _CS_AWG_STRIP[keys[keys.length-1]];
  const above=keys.filter(k=>k>n)[0];
  return _CS_AWG_STRIP[above];
}
// Fills only what is missing, and only on an end that is actually terminated.
// Returns how many dimensions it had to propose, for the audit trail.
export function _csProposeStrips(spec){
  let n=0;
  const conns=_csConnectors(spec);
  _csSegments(spec).forEach(seg=>{
    const awg=_csAwgOf(seg, spec);
    const mm=_csStripForAwg(awg);
    if(mm==null) return;
    const basis=`Not dimensioned on the drawing. Typical bared length for a ${awg} AWG crimp contact — confirm against the contact datasheet before the first production lot.`;
    (seg.ends||[]).forEach(e=>{
      const c=conns.find(x=>String(x.ref||'').toUpperCase()===String(e.ref||'').toUpperCase());
      const kind=String(c&&c.kind||'').toLowerCase();
      if(kind==='breakout' || kind==='splice') return;     // nothing is terminated here
      const has=(e.strip||[]).some(x=>_csNum(x.value_mm)!=null);
      if(has) return;
      e.strip=(Array.isArray(e.strip)?e.strip:[]).concat([{
        code:'A', label:'Insulation removed from the wire end for its contact',
        value_mm:mm, derived:false, confirmed:false, proposed:true, basis}]);
      n++;
    });
    // On loose wires the conductor strip IS the strip, so the two must not be
    // two different numbers on one sheet.
    if(_csNum(seg.conductor_strip_mm)==null){
      seg.conductor_strip_mm=mm;
      seg.conductor_strip_confirmed=false;
      seg.conductor_strip_proposed=true;
      n++;
    }
  });
  if(n) (spec.open_items=Array.isArray(spec.open_items)?spec.open_items:[]).push({
    what:'Strip dimensions were not on the drawing',
    why:`The app proposed ${n} of them from the wire gauge. They are marked TBC on the sheet.`,
    action:'Check them against the contact datasheet and tick Confirmed.'});
  return n;
}

export function _csCutLength(seg, spec){
  const finished=_csNum(seg?.finished_length_mm);
  const allowances=(Array.isArray(seg?.allowances)?seg.allowances:[])
    .map(a=>({ref:String(a?.ref||''), mm:_csNum(a?.mm)||0,
              reason:String(a?.reason||''), confirmed:a?.confirmed===true}))
    .filter(a=>a.mm!==0 || a.reason);
  const trim=_csNum(seg?.trim_allowance_mm)||0;

  // What the dimension measures decides the arithmetic, and _csDatum above is
  // the single place that decides it — from the drawing when it says, from the
  // run's own geometry when it does not, and from the engineer once they have
  // confirmed it. The per-end cost is then derived here rather than taken from
  // the analysis, so the sum on the sheet is always the sum that was used.
  const datum=_csDatum(seg, spec);
  const basis = datum.basis;
  if((basis===_CS_BASIS_JACKET || basis===_CS_BASIS_OVER) && finished!=null){
    const margin=_csEndMargin(seg, spec);
    const ends=[];
    let missingConn=0;
    (seg.ends||[]).forEach(e=>{
      const js=_csJacketStrip(e);
      if(!js) return;
      if(basis===_CS_BASIS_OVER){
        // The dimension already spans the whole assembled harness, connector
        // face to connector face. The cable inside each connector is therefore
        // INSIDE the figure, not extra — so nothing is added for this end, and
        // the connector body, which is not cable at all, comes off. A body
        // length nobody supplied is counted as zero and reported, never
        // guessed: an invented 30 mm is 30 mm of scrap wearing a confident face.
        const c=_csEndLegs(e).length ? 0 : _csEndConnLen(e, spec);
        let conn=0;
        if(c==null) missingConn++; else conn=c;
        ends.push({ref:e.ref||'', mm:_csR(-conn), strip:js.mm, margin:0, conn,
                   code:js.code, confirmed:js.confirmed});
        return;
      }
      ends.push({ref:e.ref||'', mm:_csR(js.mm+margin), strip:js.mm, margin, conn:0,
                 code:js.code, confirmed:js.confirmed});
    });
    // An end whose cost this convention already derives must not ALSO carry an
    // allowance: the analysis's 4 mm insertion depth and the 1.5 mm margin are two
    // accounts of the same millimetres, and adding both is the double count in a
    // new costume. The per-end ones are superseded and reported; anything left —
    // a service loop, an allowance at no particular end — is genuinely extra and
    // still counts.
    const costed=new Set(ends.map(e=>String(e.ref||'').toUpperCase()).filter(Boolean));
    const extra=allowances.filter(a=>!costed.has(String(a.ref||'').toUpperCase()));
    const superseded=allowances.filter(a=>costed.has(String(a.ref||'').toUpperCase()));
    let added=_csR(ends.reduce((s,e)=>s+e.mm,0) + extra.reduce((s,a)=>s+a.mm,0) + trim);
    // A harness dimensioned over its connectors cannot come out longer than the
    // dimension — that figure is the finished article. If allowances would push
    // it past, the piece is held at the drawing's length and the sheet says so,
    // rather than quietly issuing a cable that will not fit where it is going.
    let capped=false;
    if(basis===_CS_BASIS_OVER && added>0){ capped=true; added=0; }
    return {finished, allowances:extra, superseded, endCosts:ends, trim, added, basis,
            datum, missingConn, capped,
            total:_csR(finished+added), hasBreakdown:true,
            allConfirmed: ends.every(e=>e.confirmed) && extra.every(a=>a.confirmed)
                          && (!trim || seg.trim_allowance_confirmed===true)
                          && !missingConn};
  }

  if(finished==null){
    return {finished:null, allowances:[], superseded:[], endCosts:[], trim:0, basis,
            datum, missingConn:0,
            total:_csNum(seg?.cut_length_mm), hasBreakdown:false,
            allConfirmed:false, added:0};
  }
  const added=_csR(allowances.reduce((s,a)=>s+a.mm,0)+trim);
  return {
    finished, allowances, superseded:[], endCosts:[], trim, added, basis,
    datum, missingConn:0,
    total:_csR(finished+added),
    hasBreakdown:true,
    allConfirmed: allowances.every(a=>a.confirmed) && (!trim || seg.trim_allowance_confirmed===true),
  };
}
export function _csSyncCutLength(spec){
  _csSegments(spec).forEach(seg=>{
    const r=_csCutLength(seg, spec);
    if(r.hasBreakdown) seg.cut_length_mm=r.total;
  });
}
// Human-readable arithmetic, e.g. "150 + 25 (P1) + 4 (WSRV1) + 5 (trim) = 184 mm".
// Deliberately spelled out: a worker who can see the sum can spot a wrong term.
// ── Ready-made cable, or wires you make it from? ─────────────────────────────
// A BOM line for 12 000 mm of wire against a 4 000 mm run is not a 12 m cable.
// It is three wires of four metres: the assembly is BUILT from loose wire, and
// the operator has to be told how many pieces to cut and how long each one is,
// not handed a single length that does not exist on any reel in the building.
//
// The tell is the ratio. Anything close to one run length is the cable itself;
// a whole multiple of it, with a conductor list to match, is stock for the
// conductors. The conductor count decides it when the drawing gives one,
// because that is a fact rather than an inference from a rounded number.
export const _CS_WIRE_RE=/\b(wire|hook[- ]?up|lead|conductor)\b/i;
export const _CS_CABLE_RE=/\b(cable|jacket|sheath|multi-?conductor|coax)\b/i;
export const _CS_TERMINAL_RE=/\b(terminal|ferrule|lug|contact|pin|socket|splice|crimp|boot|backshell|label|tubing|shrink)\b/i;
// "3 Cond", "4C", "3x1.5", "2 core", "shielded pair": several conductors in one part.
export const _CS_MULTICORE_RE=/\b(\d+\s*(cond|conductors?|cores?|c)\b|\d+\s*[x×]\s*\d|(un)?shielded|twisted\s+pair|pairs?\b)/i;
// A length written anywhere the BOM puts it: its own field, the quantity column
// with a unit, or the description.
// How much wire one BOM line actually calls for, in millimetres.
//
// The trap this exists for: on these BOMs the QUANTITY column IS the length —
// "12" with unit "m" is twelve metres of wire, not twelve pieces. Reading it as
// a count and multiplying it by a length found elsewhere turns 12 m into 36 m
// and four pieces into twelve. So the unit column decides, and it decides
// FIRST, ahead of any length the analysis may have filled in.
export const _CS_LEN_UNITS={mm:1, millimeter:1, millimetre:1, 'מ"מ':1, 'מ״מ':1,
                     m:1000, meter:1000, metre:1000, meters:1000, metres:1000, "מ'":1000,
                     cm:10, in:25.4, inch:25.4, inches:25.4, ft:304.8, feet:304.8, foot:304.8};
// {mm, qty} — mm is the whole line's length, qty is how many times it is
// counted (always 1 when the quantity was itself the length).
export function _csMatStock(m, runMm){
  if(!m) return {mm:null, qty:1};
  const unit=String(m.unit||'').trim().toLowerCase();
  const qtyNum=_csNum(m.qty);
  const f=_CS_LEN_UNITS[unit];
  // 1. the quantity column, when its unit says it is a length
  if(f!=null && qtyNum!=null && qtyNum>0) return {mm:_csR(qtyNum*f), qty:1};
  // 2. An explicit length field, counted as many times as the line is ordered.
  const direct=_csNum(m.length_mm);
  if(direct!=null && direct>0){
    // THE SAME LENGTH WRITTEN TWICE. A BOM row reading QTY 12, UNIT m is twelve
    // metres of wire; an analysis that also fills in length_mm = 12000 has said
    // the one thing in both columns, and multiplying them gives 144 metres of
    // wire for a 3 metre harness — forty-seven pieces instead of four. When the
    // quantity, read as metres (or as millimetres), IS the length, it is the
    // same figure restated and it is counted once.
    if(qtyNum!=null && qtyNum>0 &&
       (Math.abs(qtyNum*1000-direct)<=1 || Math.abs(qtyNum-direct)<=1))
      return {mm:direct, qty:1, restated:true};
    // …unless the "length" is just the harness length copied onto a wire line,
    // which is what turns 12 m of wire into "12 pieces of 3 m": 36 metres the
    // BOM never called for, and twelve cuts instead of four. Wire is bought by
    // the metre, never by the piece, so on a wire line whose length equals the
    // run it describes, the quantity is the length.
    const copiedRunLength = runMm!=null && Math.abs(direct-runMm)<=Math.max(1, runMm*0.02);
    if(copiedRunLength && qtyNum!=null && qtyNum>1 && qtyNum<=5000 && _csIsWireMaterial(m))
      return {mm:_csR(qtyNum*1000), qty:1, assumedMetres:true};
    return {mm:direct, qty:(qtyNum!=null && qtyNum>0 && qtyNum<1000 && !f) ? qtyNum : 1};
  }
  // 3. No length field at all on a wire line: the quantity is metres.
  if(!f && !unit && qtyNum!=null && qtyNum>0 && qtyNum<=5000 && _csIsWireMaterial(m))
    return {mm:_csR(qtyNum*1000), qty:1, assumedMetres:true};
  // 4. a length written into the quantity or the description
  const texts=[String(m.qty==null?'':m.qty), String(m.description||'')];
  for(const t of texts){
    const hit=/([\d.,]+)\s*(mm|cm|m|meters?|metres?|in|inch|inches|ft|feet|foot|מ"מ|מ״מ|מ')\b/i.exec(t);
    if(hit){
      const v=_csNum(String(hit[1]).replace(/,/g,''));
      const k=_CS_LEN_UNITS[String(hit[2]).toLowerCase()];
      if(v!=null && k!=null) return {mm:_csR(v*k), qty:1};
    }
  }
  return {mm:null, qty:1};
}
export function _csMatLenMm(m){ return _csMatStock(m).mm; }
export function _csIsWireMaterial(m){
  if(!m) return false;
  const d=String(m.description||'')+' '+String(m.part_number||'');
  // What the part IS outranks what the analysis called it. "Power Cable 14AWG,
  // 3 Cond" is a ready-made cable even when the reading filed it under wire —
  // and treating it as wire is what turned one 1 m cable into "4 pieces of
  // 20 mm". A single conductor is a wire; several under one jacket never are.
  if(_CS_CABLE_RE.test(d) || _CS_MULTICORE_RE.test(d)) return false;
  // A terminal "for wire 14 AWG" mentions wire; it is still a terminal.
  if(_CS_TERMINAL_RE.test(d)) return false;
  const k=String(m.kind||'').toLowerCase();
  if(k==='wire') return true;
  if(k && k!=='other') return false;      // contact, connector, label, sleeve …
  return _CS_WIRE_RE.test(d);
}
// How many pieces come off each BOM line, and what the bundle then contains.
//
// The instruction the bench needs is not "you need 12 m of wire". It is: this
// 12 m reel gives you FOUR pieces of 3 m, and the harness is those pieces laid
// together. Two 12 m lines on the BOM make eight. So every wire line is counted
// separately, its own division is shown, and the totals are the sum — which is
// also the only way the arithmetic stays checkable when the lines differ.
export function _csWireBuild(seg, spec){
  const perWire=_csNum(_csCutLength(seg, spec).total);
  if(perWire==null || perWire<=0) return null;

  const segPn=String(seg?.cable_part_number||'').trim().toUpperCase();
  // The run names its own cable and the part list says that part is a cable:
  // it is bought ready-made and cut to length, full stop. Nothing on the BOM
  // is then "stock to build it from".
  const own=(spec?.materials||[]).find(m=>segPn && String(m.part_number||'').trim().toUpperCase()===segPn);
  if(own){
    const od=`${own.description||''} ${own.part_number||''}`;
    if(_CS_CABLE_RE.test(od) || _CS_MULTICORE_RE.test(od) || String(seg?.type||'')==='multi_conductor'
       || String(seg?.type||'')==='coax') return null;
  }
  const all=(spec?.materials||[]).map(m=>({m, mm:_csMatLenMm(m)})).filter(x=>x.mm!=null && x.mm>0);
  if(!all.length) return null;

  // EVERY wire line is stock for this harness, not just the one the run happens
  // to name. A BOM with 12 m of black and 12 m of red builds a bundle of both;
  // picking one of them would quietly halve the job. The run's own part number
  // is included even when it does not read as wire, so a named reel is never
  // missed.
  const wires=all.filter(x=>_csIsWireMaterial(x.m));
  const named=all.filter(x=>segPn && String(x.m.part_number||'').trim().toUpperCase()===segPn
                            && !wires.includes(x) && !_CS_TERMINAL_RE.test(`${x.m.description||''}`));
  const chosen=wires.concat(named).sort((a,b)=>b.mm-a.mm);
  if(!chosen.length) return null;

  const lines=chosen.map(x=>{
    const st=_csMatStock(x.m, perWire);
    const qty=st.qty;
    const totalMm=_csR(st.mm*qty);
    const pieces=Math.floor(totalMm/perWire);
    return {pn:String(x.m.part_number||''), description:String(x.m.description||''),
            reelMm:st.mm, qty, totalMm, pieces, leftoverMm:_csR(totalMm-pieces*perWire)};
  }).filter(l=>l.pieces>0);
  if(!lines.length) return null;

  const pieces=lines.reduce((a,l)=>a+l.pieces,0);
  // Two reels of two DIFFERENT wires are four black and four red, not eight of
  // something unnamed. The bench cuts by part number, so the summary counts by
  // part number too.
  const byPn=[];
  lines.forEach(l=>{
    const key=String(l.pn||'').toUpperCase();
    const e=byPn.find(x=>String(x.pn||'').toUpperCase()===key);
    if(e){ e.pieces+=l.pieces; e.totalMm=_csR(e.totalMm+l.totalMm); }
    else byPn.push({pn:l.pn, description:l.description, pieces:l.pieces, totalMm:l.totalMm});
  });
  // One run's worth is the cable itself, not stock for several. Two or more is
  // what makes this a bundle you build rather than a cable you cut.
  if(pieces<2) return null;

  const conductors=(seg?.conductors||[]).length;
  return {
    lines, byPn, pieces, perWireMm:perWire, conductors,
    stockMm: _csR(lines.reduce((a,l)=>a+l.totalMm,0)),
    usedMm:  _csR(pieces*perWire),
    leftoverMm: _csR(lines.reduce((a,l)=>a+l.leftoverMm,0)),
    // The wiring table and the reels disagreeing is worth saying out loud: one
    // of the two is wrong, and the operator should not be the one to find out
    // with the reel already cut.
    conductorMismatch: conductors>0 && conductors!==pieces ? conductors : 0,
    // The single-line case reads better as "cut the 12 m into 4", which is what
    // the shop actually says.
    single: lines.length===1,
  };
}
// ── End-to-end routes ────────────────────────────────────────────────────────
// A drawing dimensions from connector to connector. When a harness genuinely has
// a breakout, the run the operator reads on the paper is trunk + branch, which
// is NOT any single segment. Computing it here lets the sheet show the same
// number the drawing shows, next to the per-run length that gets cut.
//
// It also catches the mistake this was written for: a "200 mm" that only reaches
// the breakout. If a route the drawing dimensions at 200 adds up to something
// else here, the two disagree in the open and somebody notices, instead of a
// wire being cut short.
export function _csRoutes(spec){
  const segs=_csSegments(spec);
  const isTerm=ref=>!!ref && !_csIsBreakout(spec, ref);
  const adj={};
  segs.forEach(sg=>{
    if(!sg.from||!sg.to||sg.from===sg.to) return;
    (adj[sg.from]=adj[sg.from]||[]).push({to:sg.to, seg:sg});
    (adj[sg.to]  =adj[sg.to]  ||[]).push({to:sg.from, seg:sg});
  });
  const terminals=[...new Set(segs.flatMap(sg=>[sg.from,sg.to]).filter(isTerm))];
  const out=[], seen=new Set();
  terminals.forEach(start=>{
    // Walk outward, passing THROUGH breakouts and stopping at the first terminal.
    const stack=[{node:start, mm:0, via:[]}];
    let guard=0;
    while(stack.length && guard++<5000){
      const cur=stack.pop();
      (adj[cur.node]||[]).forEach(edge=>{
        if(cur.via.includes(edge.seg.id)) return;      // never reuse a run
        const mm=cur.mm + (_csNum(edge.seg.finished_length_mm)||0);
        const via=[...cur.via, edge.seg.id];
        if(isTerm(edge.to)){
          if(edge.to===start) return;
          const key=[start,edge.to].sort().join('|')+'#'+via.slice().sort().join(',');
          if(!seen.has(key)){ seen.add(key); out.push({from:start,to:edge.to,mm:_csR(mm),via}); }
          return;
        }
        stack.push({node:edge.to, mm, via});
      });
    }
  });
  return out;
}
// A dimension the drawing gives that our own run lengths do not reproduce.
// Reported, never reconciled: the drawing is the authority, and quietly adjusting
// a length to match would hide which of the two is wrong.
export function _csRouteMismatches(spec){
  const dims=Array.isArray(spec?.route_dimensions)?spec.route_dimensions:[];
  if(!dims.length) return [];
  const routes=_csRoutes(spec);
  const key=(a,b)=>[String(a||'').toUpperCase(),String(b||'').toUpperCase()].sort().join('|');
  const best={};
  routes.forEach(r=>{ const k=key(r.from,r.to); if(best[k]==null||r.mm>best[k]) best[k]=r.mm; });
  return dims.map(d=>{
    const drawn=_csNum(d.mm), got=best[key(d.from,d.to)];
    if(drawn==null || got==null) return null;
    return Math.abs(drawn-got)>0.5 ? {from:d.from,to:d.to,drawn,got:_csR(got),what:d.what||''} : null;
  }).filter(Boolean);
}

// Total cable to draw off the reel, per cable part number — what stores issues.
// The failure this catches: an 8 mm jacket strip written into "allowances" as
// well as into "strip", so the same end is paid for twice and the cut length
// comes out 8 mm long per end. Reported, never silently corrected — which of the
// two numbers is wrong is a question about the drawing, not about arithmetic.
export function _csAllowanceDoubles(spec){
  const out=[];
  _csSegments(spec).forEach(seg=>{
    const ends={};
    (seg.ends||[]).forEach(e=>{
      ends[String(e.ref||'').toUpperCase()]=(e.strip||[])
        .filter(x=>!x.derived).map(x=>({code:x.code, mm:_csNum(x.value_mm)}))
        .filter(x=>x.mm!=null);
    });
    (seg.allowances||[]).forEach(a=>{
      const mm=_csNum(a.mm), ref=String(a.ref||'').toUpperCase();
      if(mm==null || !ends[ref]) return;
      const hit=ends[ref].find(x=>Math.abs(x.mm-mm)<0.01);
      if(hit) out.push({seg:seg.id, ref:a.ref, mm, code:hit.code, reason:a.reason||''});
    });
  });
  return out;
}

// Length is drawn from a reel, so this list may only contain cable. A run whose
// "cable_part_number" is in fact a connector's part number produced a stores line
// telling the storeman to fetch 570 mm of fan — so those are separated out and
// named rather than quietly totalled.
// "If a number appears in the prose it must be the same number in the sum and on
// the figure." The sum and the figures already read the same fields, so they
// cannot drift. The prose is written by the analysis and can. This finds every
// millimetre figure quoted in the step text and reports any that is not one of
// the sheet's own numbers — which is exactly how "add 4 mm" ended up beside a
// figure showing 8 mm.
export function _csKnownNumbers(spec){
  const n=new Set(); const add=v=>{ const x=_csNum(v); if(x!=null) n.add(_csR(x)); };
  add(spec?.overall_length_mm); add(spec?.end_margin_mm); n.add(_CS_END_MARGIN_MM);
  (spec?.route_dimensions||[]).forEach(d=>add(d.mm));
  (spec?.markers||[]).forEach(m=>add(m.distance_mm));
  (spec?.sleeves||[]).forEach(x=>{ add(x.length_mm); add(x.distance_mm); });
  if(spec?.bundle) add(spec.bundle.length_mm);
  _csSegments(spec).forEach(seg=>{
    const c=_csCutLength(seg, spec);
    add(seg.finished_length_mm); add(c.total); add(c.added); add(seg.cut_length_tolerance_mm);
    add(seg.trim_allowance_mm); add(seg.conductor_strip_mm);
    (c.endCosts||[]).forEach(e=>{ add(e.mm); add(e.strip); add(e.margin); });
    (c.allowances||[]).forEach(a=>add(a.mm));
    // Deliberately NOT the superseded ones. A superseded allowance is a number
    // the sheet decided not to act on, so prose quoting it is the exact error
    // this check exists to catch: "add 4 mm" printed beside a figure showing 8.
    (seg.layers||[]).forEach(l=>add(l.od_mm));
    (seg.ends||[]).forEach(e=>{ add(e.strip_tolerance_mm);
      (e.strip||[]).forEach(x=>add(x.value_mm)); });
  });
  return n;
}

export function _csCableTotals(spec){
  const conn=new Set(_csConnectors(spec).map(c=>String(c.part_number||'').trim().toUpperCase()).filter(Boolean));
  const by={};
  _csSegments(spec).forEach(seg=>{
    const k=seg.cable_part_number||seg.cable_description||'—';
    if(conn.has(String(k).trim().toUpperCase())) return;   // not a cable — see _csCableSuspects
    const mm=_csCutLength(seg, spec).total;
    if(mm==null) return;
    (by[k]=by[k]||{pn:k, mm:0, runs:0}); by[k].mm=_csR(by[k].mm+mm); by[k].runs++;
  });
  return Object.values(by);
}
export function _csCableSuspects(spec){
  const conn=new Map(_csConnectors(spec)
    .filter(c=>c.part_number)
    .map(c=>[String(c.part_number).trim().toUpperCase(), c]));
  const out=[];
  _csSegments(spec).forEach(seg=>{
    const k=String(seg.cable_part_number||'').trim().toUpperCase();
    if(k && conn.has(k)) out.push({seg:seg.id, pn:seg.cable_part_number, ref:conn.get(k).ref||''});
  });
  return out;
}

// The analysis states what it counted on the drawing; this compares that against
// what it actually produced. Same discipline as _csRouteMismatches: report the
// gap, never paper over it. A label the analysis dropped is invisible otherwise,
// and "invisible" is exactly how D and F went missing twice running.
// Connectors whose designator the sheet invented rather than read. An operator
// told to "cut from P1 to P4" on a drawing that says X7 and X9 will look for P1,
// not find it, and either stop or guess. Naming them is cheap; guessing is not.
export function _csAssignedRefs(spec){
  return _csConnectors(spec)
    .filter(c=>String(c.ref_source||'')==='assigned' || c._inferred)
    .map(c=>({ref:c.ref||'', seen:c.ref_seen_as||'', desc:c.description||''}));
}

export function _csCountMismatches(spec){
  const c=(spec&&spec.counts)||{}; const out=[];
  const cmp=(said, got, what)=>{
    const n=_csNum(said);
    if(n==null || n===got) return;
    out.push({what, said:n, got, missing:n-got});
  };
  cmp(c.marking_table_rows, (spec?.markers||[]).length, 'Labels in the marking table');
  // Count only the connectors the analysis actually DESCRIBED. _csNormalize
  // back-fills a row for any ref a segment mentions, which keeps the model sound
  // but would otherwise mask the thing this check exists to catch: P4 present as
  // an endpoint, absent from the connector list, with no part number behind it.
  cmp(c.connectors_on_drawing, _csConnectors(spec).filter(x=>!x._inferred).length,
      'Connectors on the drawing');
  cmp(c.cable_runs, _csSegments(spec).length, 'Cable runs');
  return out;
}

// The harness's own overall length — the single number a planner quotes and a
// stores clerk checks. Three candidates can disagree: what the drawing states,
// the longest end-to-end route through the model, and the longest single run.
// We report all three rather than picking one, for the same reason
// _csRouteMismatches reports instead of reconciling: which one is wrong is
// exactly the thing a human has to decide.
export function _csOverall(spec){
  const stated=_csNum(spec&&spec.overall_length_mm);
  let longest=null, span=null;
  _csRoutes(spec).forEach(r=>{ if(r.mm!=null && (longest==null||r.mm>longest)){ longest=r.mm; span=r.from+' → '+r.to; } });
  if(longest==null) _csSegments(spec).forEach(seg=>{
    const f=_csCutLength(seg, spec).finished ?? _csNum(seg.finished_length_mm);
    if(f!=null && (longest==null||f>longest)){ longest=f; span=_csSegLabel(seg); } });
  const value = stated ?? longest;
  const mismatch = (stated!=null && longest!=null && Math.abs(stated-longest)>0.5)
    ? {stated, longest, span} : null;

  // The drawing's overall length is a FINISHED length — note 2 on this very
  // drawing says so ("the specified cable length is without the connectors").
  // Nobody cuts that. The number the operator needs is the longest CUT length,
  // allowances included, so both are reported and the cut one is the headline.
  let cut=null, cutSpan=null, added=0;
  _csSegments(spec).forEach(seg=>{
    const cl=_csCutLength(seg, spec);
    if(cl.total!=null && (cut==null || cl.total>cut)){
      cut=cl.total; cutSpan=_csSegLabel(seg); added=cl.added||0;
    }
  });
  return {value, stated, longest, span, mismatch, cut, cutSpan, added};
}

// ── The form's own rows ───────────────────────────────────────────────────────
// The shop's paper form has one line per thing you cut, with the strip written
// beside it as "jacket/conductor" — 170/45 means strip 170 of jacket and bare
// 45 of each conductor. These two helpers produce exactly those lines from the
// same fields the diagrams read, so the form and the figures cannot disagree.
export function _csToday(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()}`;
}
// The pinout as the drawing gives it: which pin, which colour, where it goes.
export function _csPinout(spec){
  const rows=[];
  _csSegments(spec).forEach(seg=>{
    (Array.isArray(seg.conductors)?seg.conductors:[]).forEach(c=>{
      if(c && (c.from_pin||c.to_pin||c.color)) rows.push({from:c.from_pin||'', color:c.color||c.name||'', to:c.to_pin||''});
    });
    if(!rows.length) (_csSegEnds(seg, spec)||[]).forEach(e=>_csEndLegs(e).forEach(l=>
      rows.push({from:'', color:l.conductor||'', to:l.to||''})));
  });
  return rows;
}
// The strip column: the jacket dimensions of the run, then the conductor strip,
// in the order the operator works them — "170/45", never a number on its own
// with no way to tell which cut it belongs to.
export function _csStripSummary(seg, spec){
  const vals=[], tbc=[];
  (_csSegEnds(seg, spec)||[]).forEach(e=>{
    (e.strip||[]).filter(x=>!x.derived && _csNum(x.value_mm)!=null).forEach(x=>{
      const v=_csNum(x.value_mm);
      if(!vals.includes(v)){ vals.push(v); tbc.push(x.confirmed===false); }
    });
  });
  const cs=_csNum(seg.conductor_strip_mm);
  if(cs!=null){ vals.push(cs); tbc.push(seg.conductor_strip_confirmed===false); }
  return {text: vals.length?vals.join('/'):'', tbc: tbc.some(Boolean)};
}

export function _csGetPath(o,path){
  return path.split('.').reduce((a,k)=>(a==null?a:a[k]), o);
}
export function _csSetPath(o,path,val){
  const p=path.split('.');
  let cur=o;
  for(let i=0;i<p.length-1;i++){ cur=cur[p[i]]; if(cur==null) return false; }
  cur[p[p.length-1]]=val;
  return true;
}

// C = A − B and friends. Without this, editing A from 4.0 to 4.5 would leave a
// derived dimension that no longer adds up, and the sheet would quietly
// contradict its own arithmetic — exactly the kind of error a work instruction
// must never contain.
export function _csRecomputeDerived(end){
  const rows=end.strip||[];
  const real=rows.filter(r=>!r.derived && _csNum(r.value_mm)!=null)
                 .map(r=>_csNum(r.value_mm)).sort((a,b)=>b-a);
  if(real.length<2) return;
  rows.filter(r=>r.derived).forEach(r=>{
    r.value_mm = Math.round((real[0]-real[1])*1000)/1000;
    // A derived value is only as trustworthy as the values it came from.
    r.confirmed = rows.filter(x=>!x.derived).every(x=>x.confirmed===true);
  });
}
