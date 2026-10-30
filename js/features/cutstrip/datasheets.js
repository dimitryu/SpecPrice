import { S } from '../../core/state.js';
import { logAudit } from '../../core/audit.js';
import { esc } from '../../core/ui.js';
import { lookupPartPrices } from '../../data/pricing.js';
import { writeSpecDoc } from '../../data/specs.js';
import { _csConnectors } from '../../domain/cutstrip.js';
import { _csT } from './i18n.js';
import { renderCutStripSheet } from './sheet.js';

// ── The connector's datasheet ────────────────────────────────────────────────
// A part number on a form is a dead end: the person holding it still has to go
// and find the sheet that says how deep the contact seats and how far back to
// strip. So the analysis looks the datasheet up while it is already working,
// and the form carries the link.
//
// Only a REAL datasheet URL, returned by the distributor's own API for that
// exact part, is ever stored. Nothing is built from a URL pattern and nothing
// is asked of the AI: a fabricated link that 404s costs more time at the bench
// than no link at all. A part with no datasheet on file simply has no link.
export function _csSafeUrl(u){
  const s=String(u||'').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}
export function _csDatasheetLink(url, vendor){
  const u=_csSafeUrl(url);
  if(!u) return '';
  return `<a class="cs-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer"
     title="${esc(_csT('Datasheet'))}${vendor?` — ${esc(vendor)}`:''}">\uD83D\uDCC4 ${esc(_csT('Datasheet'))}</a>`;
}
// When no distributor holds a datasheet for the part, the operator still needs
// the manufacturer's document — and on this shop's drawings that is the usual
// case, because military circular connectors are not catalogue stock at Mouser
// or DigiKey. What is offered then is a SEARCH at the manufacturer, never a
// guessed document URL: a search always resolves, says plainly that it is a
// search, and puts the engineer one click from the real specification instead
// of one click from a 404.
export const _CS_MFR_SEARCH=[
  [/amphenol|\bTV0\d|\bD38999\b/i, 'Amphenol',    'https://www.amphenol.com/search?q='],
  [/\bTE\b|te connectivity|raychem|deutsch/i, 'TE Connectivity', 'https://www.te.com/en/search.html?q='],
  [/molex/i,    'Molex',    'https://www.molex.com/en-us/search/products?query='],
  [/glenair/i,  'Glenair',  'https://www.glenair.com/search/?q='],
  [/souriau|sunbank/i, 'Souriau', 'https://www.souriau.com/en/search?search_api_fulltext='],
  [/itt cannon|\bcannon\b/i, 'ITT Cannon', 'https://www.ittcannon.com/search?q='],
  [/hirose/i,   'Hirose',   'https://www.hirose.com/en/search/?q='],
  [/\bJAE\b/i,  'JAE',      'https://www.jae.com/en/search/?q='],
  [/harting/i,  'HARTING',  'https://www.harting.com/en/search?q='],
  [/smiths|hypertac/i, 'Smiths Interconnect', 'https://www.smithsinterconnect.com/search/?q='],
  [/lemo/i,     'LEMO',     'https://www.lemo.com/en/search?q='],
];
export function _csMfrSearch(pn, manufacturer){
  const key=String(pn||'').trim();
  if(!key) return null;
  const hay=`${manufacturer||''} ${key}`;
  const hit=_CS_MFR_SEARCH.find(r=>r[0].test(hay));
  if(hit) return {name:hit[1], url:hit[2]+encodeURIComponent(key)};
  // No manufacturer we have a site for: a plain web search for the part number
  // and the word datasheet is still the fastest honest route to the document.
  return {name:String(manufacturer||'').trim(),
          url:'https://duckduckgo.com/?q='+encodeURIComponent(`"${key}" ${manufacturer||''} datasheet`.trim())};
}
export function _csPartDocLink(url, vendor, pn, manufacturer){
  const real=_csDatasheetLink(url, vendor);
  if(real) return real;
  const s=_csMfrSearch(pn, manufacturer);
  if(!s) return '';
  const label=s.name ? `${_csT('Search at')} ${s.name}` : _csT('Search for the datasheet');
  return `<a class="cs-link cs-link-s" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"
     title="${esc(_csT('No distributor holds a datasheet for this part — this is a search, not the document'))}"
     >\uD83D\uDD0D ${esc(label)}</a>`;
}
// A specification made before this existed — or one whose parts the
// distributors had nothing on that day — has no links. Opening it fills them
// in, once, in the background: no button to remember, and no repeat of a
// lookup that already came back empty.
export let _csDsBusy=false;
export async function _csBackfillDatasheets(spec){
  if(!spec || _csDsBusy || spec.datasheets_checked) return;
  const conns=_csConnectors(spec);
  if(!conns.some(c=>String(c.part_number||'').trim() || String(c.contact_pn||'').trim())) return;
  if(conns.some(c=>_csSafeUrl(c.datasheet_url) || _csSafeUrl(c.contact_datasheet_url))) return;
  _csDsBusy=true;
  spec.datasheets_checked=true;          // in memory at once, so a re-render cannot start a second run
  try{
    const found=await _csAttachDatasheets(spec);
    const {_id, ...body}=spec;
    if(_id) await writeSpecDoc(_id, body);
    S.csSpecs=[];
    logAudit('cut_strip_datasheets',{drawing:spec.drawing_number, found, backfill:true},true);
    if(found && S.csCurrent===spec) renderCutStripSheet();
  }catch(e){ console.warn('[CutStrip] datasheet backfill', e.message); }
  _csDsBusy=false;
}

// Best-effort, and deliberately silent: a drawing analysis must not fail, or
// even slow down noticeably, because a distributor API was having a bad minute.
export async function _csAttachDatasheets(spec, onProgress){
  const conns=Array.isArray(spec?.connectors) ? spec.connectors : [];
  const jobs=[];
  conns.forEach((c,i)=>{
    if(String(c.part_number||'').trim()) jobs.push({i, field:'datasheet_url', pn:c.part_number, desc:c.description||''});
    if(String(c.contact_pn||'').trim()) jobs.push({i, field:'contact_datasheet_url', pn:c.contact_pn, desc:'contact'});
  });
  if(!jobs.length) return 0;
  let found=0, done=0;
  for(const j of jobs){
    try{
      const r=await lookupPartPrices(j.pn, 1, j.desc);
      const hit=(r.listed||[]).find(v=>_csSafeUrl(v.datasheet));
      if(hit){
        conns[j.i][j.field]=hit.datasheet;
        conns[j.i][j.field+'_vendor']=hit.name||'';
        if(!conns[j.i].manufacturer && hit.manufacturer) conns[j.i].manufacturer=hit.manufacturer;
        found++;
      }
    }catch(e){ console.warn('[CutStrip] datasheet lookup', j.pn, e.message); }
    done++;
    if(onProgress) onProgress(done, jobs.length);
  }
  return found;
}
