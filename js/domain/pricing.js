// Detect a 3-letter currency code (or symbol) from a raw price string; defaults to USD
export function _detectCurrency(raw){
  const s=String(raw||'').trim();
  if(/₪|\bILS\b|\bNIS\b|שקל|^ש"?ח?$/i.test(s)) return 'ILS';
  if(/€|\bEUR\b/i.test(s)) return 'EUR';
  if(/£|\bGBP\b/i.test(s)) return 'GBP';
  if(/¥|\bJPY\b/i.test(s)) return 'JPY';
  if(/\bCHF\b/i.test(s)) return 'CHF';
  return 'USD';
}
// Maps a short currency-column value (e.g. Priority ERP's "מטבע שורה" column, which uses
// values like "ש" for shekel, or plain "EUR"/"GBP"/"USD") to our 3-letter codes.
export function _normalizeCurrencyCode(raw){
  const s=String(raw||'').trim();
  if(!s) return '';
  if(/^ש"?ח?$/.test(s) || /^(ILS|NIS)$/i.test(s)) return 'ILS';
  if(/^EUR$/i.test(s)) return 'EUR';
  if(/^GBP$/i.test(s)) return 'GBP';
  if(/^JPY$/i.test(s)) return 'JPY';
  if(/^CHF$/i.test(s)) return 'CHF';
  if(/^USD$/i.test(s)) return 'USD';
  return _detectCurrency(s);
}

export function _fcParsePriceBreaks(texts){
  const breaks=[];
  // Strategy A: "N+ $X.XX" pairs inline
  for(const t of texts){
    const re=/([\d,]+)\s*\+?\s*\$\s*([\d,]+\.\d+)/g; let m;
    while((m=re.exec(t))!==null){
      const qty=parseInt(m[1].replace(/,/g,''));
      const price=parseFloat(m[2].replace(/,/g,''));
      if(qty>0&&price>0) breaks.push([qty,price]);
    }
  }
  // Strategy B: adjacent qty/price cells
  if(!breaks.length){
    for(let i=0;i<texts.length-1;i++){
      const qm=texts[i].trim().match(/^([\d,]+)$/);
      if(qm){
        const nxt=texts[i+1];
        const pm=nxt.match(/\$\s*([\d,]+\.\d+)/)||nxt.trim().match(/^(\d+\.\d{2,4})$/);
        if(pm){
          const qty=parseInt(qm[1].replace(/,/g,''));
          const price=parseFloat(pm[1].replace(/,/g,''));
          if(qty>0&&price>0){breaks.push([qty,price]);i++;}
        }
      }
    }
  }
  // Strategy C: first dollar amount = unit price
  if(!breaks.length){
    for(const t of texts){
      const m=t.match(/\$\s*([\d,]+\.\d+)/);
      if(m){breaks.push([1,parseFloat(m[1].replace(/,/g,''))]);break;}
      const m2=t.trim().match(/^(\d+\.\d{2,4})$/);
      if(m2){breaks.push([1,parseFloat(m2[1])]);break;}
    }
  }
  breaks.sort((a,b)=>a[0]-b[0]);
  const seen=new Set(),result=[];
  for(const [qty,price] of breaks){if(!seen.has(qty)){seen.add(qty);result.push([qty,price]);}}
  return result;
}

// FindChips lists length-based parts (cables, wire, etc.) in FEET, but our BOMs
// store length quantities in mm (the system's sole canonical length unit —
// see _normalizeUnitQty). Before searching FindChips for a length-unit part,
// convert the local qty to feet so the nearest price-break match is against
// the right scale — otherwise e.g. a 2500mm cable would be searched as "2500"
// and match a price break meant for 2500 feet, not 2500mm (~8.2 ft).
// gr (grams) is treated the same as mm here per business rule — it's a bulk-
// material quantity, not a per-piece count, so it gets the same non-"pc"
// lookup treatment. "pc" (and anything unrecognized) passes through unchanged.
export function _priceTargetQty(qty, unit, packMl){
  const u=String(unit||'').trim().toLowerCase();
  const n=parseFloat(qty)||0;
  if(u==='mm'||u==='gr') return Math.max(1, Math.round(n*0.00328084));
  // Adhesive is bought by the bottle: the quantity asked for is bottles.
  if(u==='ml') return _sdBottlesFor(n, packMl);
  return Math.max(1, Math.round(n)||1);
}

export function _fcNearestBreakPrice(breaks,targetQty){
  if(!breaks.length) return '';
  let [bestQty,bestPrice]=breaks[0];
  let bestDist=Math.abs(targetQty-bestQty);
  for(const [qty,price] of breaks.slice(1)){
    const dist=Math.abs(targetQty-qty);
    if(dist<bestDist||(dist===bestDist&&qty<bestQty)){bestDist=dist;bestQty=qty;bestPrice=price;}
  }
  return '$'+bestPrice.toFixed(4).replace(/\.?0+$/,'');
}
// Length constants for "mm"-unit (length) rows — Priority lists cable/wire
// pricing per METER, while Mouser and DigiKey quote it per FOOT (see
// _priceTargetQty, which already converts mm→feet when looking those prices up).
// A flat qty×price would overshoot by ~1000x for Priority and ~305x for the
// distributors if the row's mm quantity were multiplied straight against either
// price without first converting it into the unit that price is quoted in.
export const MM_PER_METER=1000, MM_PER_FOOT=304.8;
// ── Adhesives in ml ───────────────────────────────────────────────────────────
// A glue, sealant or threadlocker is listed in ml on the drawing but bought by
// the bottle (tube, syringe, can). The supplier's price is for one bottle; the
// line costs as many bottles as cover the ml needed — the required ml of all
// the cables, divided by the bottle size and rounded up.
export function _sdIsAdhesiveRow(r){
  if(String(r&&r.unit||'').trim().toLowerCase()==='ml') return true;
  return /\b(ADHESIVES?|GLUE|EPOXY|LOCTITE|SEALANTS?|RTV|CYANOACRYLATE|THREAD[\s-]?LOCK(?:ER|ING)?|SUPER[\s-]?GLUE|POTTING|CONFORMAL\s+COAT(?:ING)?)\b|דבק/i.test(String(r&&r.description||''));
}
// A bottle size in ml read out of a description or part number: "50ML",
// "250 ml", "1 L", "0.5 LITER", "10 cc", "1.69 FL OZ". 0 when none is stated.
export function _parsePackMl(text){
  const s=String(text||'');
  let m=/(\d+(?:[.,]\d+)?)\s*(?:ML|MILLILIT(?:ER|RE)S?|CC)\b/i.exec(s);
  if(m) return +parseFloat(m[1].replace(',','.')).toFixed(3);
  m=/(\d+(?:[.,]\d+)?)\s*(?:L|LT|LTR|LIT(?:ER|RE)S?)\b/i.exec(s);
  if(m) return +(parseFloat(m[1].replace(',','.'))*1000).toFixed(3);
  m=/(\d+(?:[.,]\d+)?)\s*FL\.?\s*OZ\b/i.exec(s);
  if(m) return +(parseFloat(m[1].replace(',','.'))*29.5735).toFixed(1);
  return 0;
}
// Bottles for `ml` ml with bottles of `packMl` ml — at least one; one when the
// bottle size is not known yet.
export function _sdBottlesFor(ml, packMl){
  const n=parseFloat(ml)||0, p=parseFloat(packMl)||0;
  if(!(p>0)) return 1;
  return Math.max(1, Math.ceil(n/p - 1e-9));
}
export function _sdBottles(r){ return _sdBottlesFor(r.qty, r.pack_ml); }
// "2 × 50 ml bottle (need 75 ml)" — what to buy, for the screens and the quote.
export function _sdBottlesText(r){
  if(String(r&&r.unit||'').trim().toLowerCase()!=='ml') return '';
  const p=parseFloat(r.pack_ml)||0, need=+(parseFloat(r.qty)||0).toFixed(2);
  if(!(p>0)) return `bottle size unknown — need ${need} ml (type it in Pack ml)`;
  const b=_sdBottles(r);
  return `${b} × ${+p.toFixed(2)} ml bottle${b>1?'s':''} (need ${need} ml)`;
}
// Every price source the app can quote from. Order matters only for tie-breaks.
export const _SD_PRICE_SOURCES=['priority_price','mouser_price','digikey_price','onlinecomp_price'];
// The distributors whose APIs Check Price asks, in screen order. Each one's
// fields on a row are <k>_price, <k>_stock, <k>_url, <k>_brk, <k>_match, <k>_mpn.
export const SD_DISTRIBUTORS=[{k:'mouser',label:'Mouser'},{k:'digikey',label:'DigiKey'},{k:'onlinecomp',label:'Online Comp.'}];
// Actual dollar cost of this row if priced from `priceField` — for "pc" (and any
// other non-length) rows the price is already per-piece, so qty multiplies
// directly; for "mm" rows the qty is first converted into whatever unit that
// particular source quotes in.
export function _sdLineCost(r, priceField){
  const price=parseFloat(r[priceField])||0;
  if(!price) return 0;
  const qty=parseFloat(r.qty)||1;
  const unit=String(r.unit||'').trim().toLowerCase();
  // ml: the price is per bottle.
  if(unit==='ml') return price*_sdBottles(r);
  if(unit==='mm'){
    if(priceField==='priority_price') return price*(qty/MM_PER_METER);
    // Online Components states its unit per part: by the metre or by the foot.
    if(priceField==='onlinecomp_price' && /^(M|MTR|METER|METRE)$/i.test(String(r.onlinecomp_uom||'').trim())) return price*(qty/MM_PER_METER);
    // Mouser and DigiKey both sell bulk wire by the foot.
    return price*(qty/MM_PER_FOOT);
  }
  return price*qty;
}
// Part Cost is directly editable in the table (see _sdCellHTML 'total' case) —
// r.manual_total, when set, is a straight user-typed override of the whole
// line's cost (not a per-unit price), useful when there's no FC/Priority price
// at all or when the user has a better number (e.g. a vendor quote). Clearing
// the field goes back to the normal auto-calculation below.
// Part Cost uses whichever available source produces the LOWEST actual dollar
// cost for this row (mirrors the Windows app's _update_row_total). Compared on
// real cost, never on the sources' raw per-unit numbers: those aren't on the
// same unit basis for mm rows, so a naive min() would pick per-foot over
// per-metre and understate the line by ~3x.
// r._costSource records which one won, so the UI can say where a number came
// from instead of leaving the user to reverse-engineer it.
// Labels and markers. Many are sold by Mouser/DigiKey (marker sleeves, printable
// labels), so they are looked up like any part; only when no source has a price
// does the agreed nominal price apply — per piece, or one label for a row that
// is not counted in pieces.
export const SD_NOMINAL_LABEL_PRICE=0.2;
export function _sdIsLabelRow(r){ return /\b(labels?|markers?)\b/i.test(String(r && r.description || '')); }
export function _sdNominalCost(r){
  if(!_sdIsLabelRow(r)) return 0;
  const unit=String(r.unit||'').trim().toLowerCase();
  const qty=parseFloat(r.qty)||1;
  return (unit==='mm'||unit==='gr') ? SD_NOMINAL_LABEL_PRICE : SD_NOMINAL_LABEL_PRICE*qty;
}
export function _sdRecalcTotal(r){
  // Material the customer supplies is not bought, so it costs nothing in every
  // calculation — whatever prices the suppliers have for it.
  if(r.customer_supplied){
    r.total=0;
    r._costSource='customer';
    return 0;
  }
  if(r.manual_total!=null && r.manual_total!==''){
    r.total=parseFloat(r.manual_total)||0;
    r._costSource='manual';
    return r.total;
  }
  let best=0, bestField='';
  for(const f of _SD_PRICE_SOURCES){
    const c=_sdLineCost(r,f);
    if(c>0 && (best===0 || c<best)){ best=c; bestField=f; }
  }
  // Only if no real source quoted this part: fall back to the AI's crimp-tool
  // estimate. Deliberately last — a real quote always beats a guess, however
  // close the guess looks.
  // No real price: a label or marker takes the nominal label price.
  if(!best){
    const nom=_sdNominalCost(r);
    if(nom>0){ best=nom; bestField='nominal'; }
  }
  if(!best){
    const est=_sdLineCost(r,'est_price');
    if(est>0){ best=est; bestField='est_price'; }
  }
  r.total=best;
  r._costSource=bestField;
  return r.total;
}
// Labor Total = labor_time(min) × qty_for_labor, for "pc"-counted rows only —
// mm/gr rows take the flat-1-minute path below instead, so this only ever
// runs for a per-piece count.
export function _sdLaborQtyMultiplier(r){
  const qtyNum=parseFloat(r.qty)||0;
  return qtyNum>0 ? qtyNum : 1;
}
