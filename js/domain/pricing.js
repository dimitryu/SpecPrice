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
export function _priceTargetQty(qty, unit){
  const u=String(unit||'').trim().toLowerCase();
  const n=parseFloat(qty)||0;
  if(u==='mm'||u==='gr') return Math.max(1, Math.round(n*0.00328084));
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
// Every price source the app can quote from. Order matters only for tie-breaks.
export const _SD_PRICE_SOURCES=['priority_price','mouser_price','digikey_price'];
// Actual dollar cost of this row if priced from `priceField` — for "pc" (and any
// other non-length) rows the price is already per-piece, so qty multiplies
// directly; for "mm" rows the qty is first converted into whatever unit that
// particular source quotes in.
export function _sdLineCost(r, priceField){
  const price=parseFloat(r[priceField])||0;
  if(!price) return 0;
  const qty=parseFloat(r.qty)||1;
  const unit=String(r.unit||'').trim().toLowerCase();
  if(unit==='mm'){
    if(priceField==='priority_price') return price*(qty/MM_PER_METER);
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
export function _sdRecalcTotal(r){
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
