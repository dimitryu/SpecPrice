import { auth } from '../core/firebase.js';
import { _detectCurrency, _normalizeCurrencyCode } from '../domain/pricing.js';

// ══════════════════════════════════════════════════════════════════════════════
// ── Part pricing — the vendors' own APIs ──────────────────────────────────────
// This used to scrape findchips.com through a chain of CORS proxies. That is
// gone: the site served a different page to datacenter IPs than to a browser,
// so lookups failed in a way no parser work could fix, and every public proxy
// we relied on died at once in Aug 2026. Prices now come from Mouser's and
// DigiKey's documented APIs via our own Cloud Function — no HTML parsing, no
// proxy chain, nothing to block. findchips.com survives in the UI only as a
// link, for eyeballing distributors the two APIs don't cover.
// coinmill.com publishes currency rates as a plain web page with no CORS
// header, so it still needs a server-side fetch. Our own Cloud Function does
// it; allorigins stays as a fallback for the case where the function isn't
// deployed. (This is all that's left of the old proxy chain.)
export const RATE_PROXY_URL = 'https://us-central1-specprice-236a2.cloudfunctions.net/priceProxy?url=';
export const RATE_PROXY_FALLBACK = 'https://api.allorigins.win/raw?url=';
// Official Mouser/DigiKey APIs via our Cloud Function (see functions/index.js).
// Unlike the FindChips scrape this is a documented, structured, permitted data
// source — no HTML parsing and nothing to block — so it's the primary source
// for the Mouser/DigiKey columns and keeps working when scraping doesn't.
export const PRICE_API_URL = 'https://us-central1-specprice-236a2.cloudfunctions.net/priceLookup';
export async function _apiPriceLookup(pn, qty, desc){
  if(!pn || !auth.currentUser) return null;
  const token=await auth.currentUser.getIdToken();
  // The description is sent as a TIE-BREAKER only. Spec numbers like
  // M81824/1-2 are made by several qualified manufacturers, all "exact"
  // matches on the part number and wildly different in price — the BOM's own
  // wording is what says which one is meant.
  const q=`pn=${encodeURIComponent(pn)}&qty=${encodeURIComponent(qty||1)}`
        + (desc?`&desc=${encodeURIComponent(String(desc).slice(0,300))}`:'');
  const resp=await fetch(`${PRICE_API_URL}?${q}`,
    {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(45000)});
  if(!resp.ok){
    let msg=`HTTP ${resp.status}`;
    try{ const j=await resp.json(); if(j&&j.error) msg=j.error; }catch{}
    throw new Error(msg);
  }
  return resp.json();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Currency conversion → USD (via coinmill.com, same CORS proxy as FindChips) ─
export const _COINMILL_URLS = {
  CHF: 'https://iw.coinmill.com/CHF_USD.html',
  JPY: 'https://iw.coinmill.com/JPY_USD.html',
  EUR: 'https://iw.coinmill.com/EUR_USD.html',
  ILS: 'https://iw.coinmill.com/ILS_USD.html',
  GBP: 'https://iw.coinmill.com/GBP_USD.html',
};
export const _currencyRateCache = {};

// Tries our own function first (authenticated), then the public fallback.
// Throws only if both fail, so a rate lookup degrades rather than dying.
export async function _fetchRatePage(url){
  const attempts=[];
  if(auth.currentUser){
    try{
      const token=await auth.currentUser.getIdToken();
      attempts.push(()=>fetch(RATE_PROXY_URL+encodeURIComponent(url),
        {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(30000)}));
    }catch(e){ console.warn('[Currency] no ID token:',e.message); }
  }
  attempts.push(()=>fetch(RATE_PROXY_FALLBACK+encodeURIComponent(url),
    {signal:AbortSignal.timeout(15000)}));
  let last='';
  for(const go of attempts){
    try{
      const resp=await go();
      if(!resp.ok){ last='HTTP '+resp.status; continue; }
      const html=await resp.text();
      if(html && html.length>200) return html;
      last='empty response';
    }catch(e){ last=e.name==='TimeoutError'?'timed out':(e.message||'failed'); }
  }
  throw new Error(last||'no rate source available');
}

export async function _fetchCurrencyRate(code){
  if(code==='USD') return 1;
  if(_currencyRateCache[code]) return _currencyRateCache[code];
  const url=_COINMILL_URLS[code];
  if(!url) return null;
  try{
    const html=await _fetchRatePage(url);
    // coinmill pages phrase the rate as "1 XXX = Y.YYYYY USD" somewhere in the text
    let m = html.match(new RegExp('1\\s*'+code+'\\s*=\\s*([\\d,]+\\.?\\d*)\\s*USD','i'));
    if(!m) m = html.match(/=\s*([\d,]+\.\d+)\s*USD/i);
    if(m){
      const rate=parseFloat(m[1].replace(/,/g,''));
      if(rate>0){ _currencyRateCache[code]=rate; return rate; }
    }
  }catch(e){ console.warn('[Currency] rate fetch error:',code,e.message); }
  return null;
}

// Parses a raw price (may include a currency symbol/code) and converts to a plain USD number.
// If currencyOverride is given (e.g. from a separate "Currency" column, common in Priority ERP
// exports where the amount itself is a bare number and the currency lives in its own column),
// that takes precedence over symbol-sniffing the price string.
// Returns null if the value can't be parsed at all. Falls back to the raw number (unconverted)
// if a live rate can't be fetched, so an import never blocks on network issues.
export async function _convertToUSD(raw, currencyOverride=''){
  const s=String(raw||'').trim();
  if(!s) return null;
  const num=parseFloat(s.replace(/[^\d.\-]/g,''));
  if(isNaN(num)) return null;
  const cur=currencyOverride ? (_normalizeCurrencyCode(currencyOverride)||_detectCurrency(s)) : _detectCurrency(s);
  if(cur==='USD') return num;
  const rate=await _fetchCurrencyRate(cur);
  if(!rate){ console.warn('[Currency] no rate for',cur,'- keeping original value'); return num; }
  return Math.round(num*rate*10000)/10000;
}

// Canonical distributor names, matched against the section "haystack" (visible
// name + class + id + data-* attributes). Ordered most-specific-first.
export const _FC_DISTRIBUTORS=[
  [/digi-?\s*key/, 'DigiKey'],
  [/mouser/,       'Mouser'],
  [/arrow/,        'Arrow'],
  [/avnet/,        'Avnet'],
  [/newark|farnell|element ?14/, 'Newark'],
  [/rs[-_ ]?(components|online|delivers)/, 'RS Components'],
  [/\btti\b/,      'TTI'],
  [/heilind/,      'Heilind'],
  [/future ?electronics/, 'Future Electronics'],
  [/verical/,      'Verical'],
  [/onlinecomponents/, 'OnlineComponents'],
  [/bisco/,        'Bisco'],
  [/allied/,       'Allied'],
];
export function _fcPrettyDistributor(haystack){
  for(const [re,name] of _FC_DISTRIBUTORS) if(re.test(haystack)) return name;
  // Last resort: pull a readable slug out of a class like "distributor-results-mouser"
  const m=String(haystack||'').match(/distributor[-_]results[-_]([a-z0-9]+)/);
  return m ? m[1].charAt(0).toUpperCase()+m[1].slice(1) : '';
}
// Looks up one part with the Mouser + DigiKey APIs and normalises the answer
// into the shape the rest of the app expects. Returns per-vendor entries plus
// `best` (the cheaper of the two) — never throws for "not found", which is a
// legitimate answer, only for an actual transport/credential failure.
export async function lookupPartPrices(partNumber, qty=0, desc=''){
  const data=await _apiPriceLookup(partNumber, qty||1, desc);
  if(!data) return {mouser:null, digikey:null, best:null, errors:[]};
  // Keep an entry whenever the vendor LISTS the part, even at price 0.
  // A non-stocked or quote-only part still answers the question "does this
  // exist and where?", and dropping it was reporting real parts as missing.
  const norm=v=>v ? {
    price:+v.price||0, stock:v.stock||'0', url:v.url||'', mpn:v.mpn||'',
    // The vendor's link to the manufacturer's datasheet. Absent on an older
    // deployment of the price function, which simply means no datasheet link.
    datasheet:v.datasheet||'',
    manufacturer:v.manufacturer||'',
    breakQty:v.breakQty||0, exact:v.exactMatch!==false, status:v.status||'',
    // How many products shared this part number, and how well the winner's
    // description matched ours. considered>1 means a choice was made.
    considered:v.considered||1, descScore:v.descScore||0, desc:v.desc||'',
    candidates:Array.isArray(v.candidates)?v.candidates:[],
    chosenBy:v.chosenBy||'',
  } : null;
  const mouser=norm(data.mouser), digikey=norm(data.digikey);
  const listed=[mouser&&{...mouser,name:'Mouser'}, digikey&&{...digikey,name:'DigiKey'}].filter(Boolean);
  // "best" = cheapest among those that actually quoted a price; if nobody did,
  // fall back to any listing so the caller still gets stock and a link.
  const priced=listed.filter(v=>v.price>0);
  const best = priced.length ? priced.reduce((a,b)=>b.price<a.price?b:a)
             : (listed[0]||null);
  return {mouser, digikey, best, listed, errors:data.errors||[]};
}
