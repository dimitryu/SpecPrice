import { S } from '../core/state.js';
import { logSystemAudit } from '../core/audit.js';
import { closeModal, esc, showModal, toast } from '../core/ui.js';
import { mergePartDoc, updatePartFields } from '../data/parts.js';
import { lookupPartPrices } from '../data/pricing.js';
import { _priceTargetQty, _sdLineCost, _sdRecalcTotal } from '../domain/pricing.js';
import { renderPartStock } from './database.js';
import { _sdApplyUnits, _sdDwgKey, _sdDwgUnits, renderSalesDesk, sdItems } from './salesDesk/salesDesk.js';

// mode: 'parts' → save to Firestore allParts; 'sd' → update sdItems in memory
//
// Runs lookups CONCURRENTLY. The old sequential loop with a 400ms pause between
// parts existed to avoid hammering a site we were scraping without permission;
// against the vendors' own APIs that caution is pointless, and it made a 13-part
// check take the better part of a minute. The pool below is deliberately small
// so we stay well inside Mouser's per-minute rate limit — going wider risks
// HTTP 429s that would make the whole run slower, not faster.
export const PRICE_CHECK_CONCURRENCY = 5;

// Asked every time Check Price runs, pre-filled with the quantity used last, so
// the number is a deliberate answer rather than a setting someone has to
// remember to revisit. One field per drawing: each drawing is a different
// cable, and an order rarely wants the same count of each.
export function _sdAskUnitsThenCheck(targets){
  const dwgs=[]; const seen=new Set();
  for(const r of targets){
    const k=_sdDwgKey(r);
    if(!seen.has(k)){ seen.add(k); dwgs.push(k); }
  }
  showModal(`<div class="modal modal-sm">
    <div class="modal-head"><h3>How many cables are we quoting?</h3>
      <button class="close-modal" id="su-x">✕</button></div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--muted);margin-bottom:6px">
        Every row's QTY is multiplied by this, so distributor prices are looked up for
        the quantity actually being bought, and labor is costed for building that many.</p>
      ${dwgs.map((d,i)=>`
        <div class="form-field" style="margin-top:10px">
          <label for="su-${i}">${esc(d)}</label>
          <input type="number" class="form-input su-units" id="su-${i}" data-dwg="${esc(d)}"
                 min="1" step="1" value="${_sdDwgUnits(d)}">
        </div>`).join('')}
      <div id="su-err" role="alert" aria-live="polite"
           style="color:#E53E3E;font-size:12px;margin-top:10px;min-height:16px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="su-cancel">Cancel</button>
      <button class="btn btn-green" id="su-go">Check Price →</button>
    </div>
  </div>`);
  document.getElementById('su-x').addEventListener('click',closeModal);
  document.getElementById('su-cancel').addEventListener('click',closeModal);
  const first=document.getElementById('su-0'); if(first){ first.focus(); first.select(); }
  document.querySelectorAll('.su-units').forEach(inp=>inp.addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('su-go').click();
  }));
  document.getElementById('su-go').addEventListener('click',()=>{
    const err=document.getElementById('su-err');
    const picks=[];
    for(const inp of document.querySelectorAll('.su-units')){
      const v=parseFloat(inp.value);
      if(!isFinite(v)||v<=0){ err.textContent='Enter a quantity of 1 or more for every drawing.'; inp.focus(); return; }
      picks.push([inp.dataset.dwg, v]);
    }
    picks.forEach(([d,v])=>_sdApplyUnits(d,v));
    const items=targets.filter(r=>r.part_number).map(r=>({
      part_number:r.part_number, qty:parseFloat(r.qty)||1, unit:r.unit||'',
      description:r.description||'', _sdIdx:sdItems.indexOf(r)}));
    if(!items.length){ closeModal(); toast('No parts to check','error'); return; }
    runFCCheckModal(items,'sd');   // replaces this modal with its own
  });
}

export async function runFCCheckModal(items, mode){
  if(!items.length){toast('No parts to check','error');return;}
  let stopped=false;
  const total=items.length;
  const _fcT0=Date.now();   // how long the whole run took — logged at the end

  const money=v=>v>0?('$'+(+v).toFixed(2)):'';
  // Unit prices need more places than line totals: a connector at $0.0032 and
  // one at $0.0089 are both "$0.00" at two decimals, which would make the QVL
  // comparison tooltip look like it picked at random.
  const moneyUnit=v=>v>0?('$'+(+v).toFixed(4).replace(/\.?0+$/,'')):'';
  // Every price column in this modal shows the TOTAL for the row's quantity,
  // not a per-unit figure. That's the number being decided on, and it's the
  // only basis on which the three sources are comparable at all: Priority
  // quotes cable per METRE while the distributors quote per FOOT, so ranking
  // per-unit numbers made Priority look ~3x dearer than it is.
  const _lineCost=(it,field,price)=>{
    const p=parseFloat(price)||0;
    if(!p) return 0;
    return _sdLineCost({qty:it.qty, unit:it.unit, [field]:p}, field);
  };

  showModal(`<div class="modal" style="width:min(96vw,900px)">
    <div class="modal-head"><h3>🔍 Check Price</h3><button class="close-modal" id="fc-close-x">✕</button></div>
    <div class="modal-body" id="fc-modal-body">
      <div class="ai-status" style="margin-bottom:8px"><div class="ring"></div><span id="fc-status">Starting…</span></div>
      <div class="progress-bar"><div class="progress-fill" id="fc-prog"></div></div>
      <div style="max-height:340px;overflow:auto;margin-top:12px">
        <table style="width:100%;font-size:12px" id="fc-res-table">
          <thead><tr style="position:sticky;top:0;background:#fff">
            <th>MNF P/N</th><th>Manufacturer</th><th>QTY</th>
            <th title="Total for the row's QTY, not a per-unit price">Mouser</th>
            <th title="Units Mouser has on hand">Mouser Stock</th>
            <th title="Total for the row's QTY, not a per-unit price">DigiKey</th>
            <th title="Units DigiKey has on hand">DigiKey Stock</th>
            <th title="Total for the row's QTY, not a per-unit price">Priority</th>
            <th>Status</th>
          </tr></thead>
          <tbody id="fc-res-tbody">
            ${items.map((it,i)=>`<tr id="fc-row-${i}">
              <td id="fc-pn-${i}">${esc(it.part_number)}${(it.alt_mpns||[]).length>1
                ? `<span style="margin-left:5px;padding:1px 5px;border-radius:8px;background:#EDE9FE;color:#5B21B6;font-size:9px;font-weight:700" title="${esc((it.alt_mpns||[]).map(a=>a.mpn).join('\n'))}">${(it.alt_mpns||[]).length} QVL</span>`
                : ''}</td>
              <td id="fc-mf-${i}" style="color:var(--muted)">${esc(it.manufacturer||'')||'—'}</td>
              <td>${it.qty||1}</td>
              <td id="fc-mo-${i}" style="color:var(--muted)">—</td>
              <td id="fc-ms-${i}" style="color:var(--muted)">—</td>
              <td id="fc-dk-${i}" style="color:var(--muted)">—</td>
              <td id="fc-ds-${i}" style="color:var(--muted)">—</td>
              <td id="fc-pr-${i}" style="color:var(--muted)">${money(_lineCost(it,'priority_price',parseFloat(it.priority_price)||0))||'—'}</td>
              <td id="fc-st-${i}"><span class="ring" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle"></span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <!-- Legend. The status glyphs and the price colours both carry meaning
           that isn't guessable, and this modal is exactly where a user meets
           them for the first time. Kept on one compact block so it explains
           without competing with the results above. -->
      <div style="margin-top:10px;padding:9px 11px;background:var(--bg,#F8FAFC);border:1px solid var(--border);border-radius:6px;font-size:11px;line-height:1.9;color:var(--muted)">
        <div style="display:flex;flex-wrap:wrap;gap:6px 18px">
          <span><strong style="color:var(--green)">✓</strong> found, with a price</span>
          <span><strong style="color:var(--green)">✓ ≈</strong> found under a differently formatted part number — hover to see which</span>
          <span><strong style="color:#B45309">◑</strong> in the catalogue, but no published price (non-stocked / quote-only)</span>
          <span><strong>Not found</strong> neither vendor lists this part number</span>
          <span><strong style="color:var(--red)">red text</strong> the lookup failed — hover for the reason</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:4px;border-top:1px dashed var(--border);padding-top:5px">
          <span><strong>Prices are the TOTAL for the row's QTY</strong>, not per unit — that's the only basis on which the three sources compare (Priority quotes per metre, the distributors per foot)</span>
          <span><strong style="color:var(--green)">green</strong> = cheapest of the three, <strong style="color:var(--red)">red</strong> = dearest</span>
          <span><strong>Stock 0</strong> = that vendor carries it but has none on hand; <strong>—</strong> = that vendor doesn't list it</span>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="btn-fc-stop">Stop</button>
      <span id="fc-summary" style="font-size:12px;color:var(--muted)"></span>
    </div>
  </div>`);

  const _fcRefresh=()=>{ if(mode==='parts'){S.allParts=[];renderPartStock();}else{renderSalesDesk();} };
  document.getElementById('btn-fc-stop').addEventListener('click',()=>{stopped=true;closeModal();_fcRefresh();});
  document.getElementById('fc-close-x').addEventListener('click',()=>{stopped=true;closeModal();_fcRefresh();});

  let done=0, found=0, failures=0, lastError='';
  // Distinct API-side problems (bad credentials, vendor outage), collected so
  // the run summary names each once instead of repeating it per part.
  const apiErrors=new Set();

  // Colour the three price cells against each other, same rule as the tables:
  // cheapest green, dearest red. Priority is included so the comparison the
  // user actually cares about — "is the distributor cheaper than our ERP?" —
  // is answerable without leaving this modal.
  const paintRow=(i, dk, mo, pr)=>{
    const vals=[dk,mo,pr].filter(v=>v>0);
    const lo=vals.length?Math.min(...vals):0, hi=vals.length?Math.max(...vals):0;
    const put=(id,v)=>{
      const el=document.getElementById(id); if(!el) return;
      if(!(v>0)){ el.textContent='—'; el.style.color='var(--muted)'; return; }
      el.textContent=money(v);
      el.style.color = vals.length<2 ? 'var(--text)'
                     : (v<=lo ? 'var(--green)' : (v>=hi ? 'var(--red)' : 'var(--text)'));
      el.style.fontWeight = (vals.length>1 && v<=lo) ? '700' : '400';
    };
    put(`fc-dk-${i}`,dk); put(`fc-mo-${i}`,mo); put(`fc-pr-${i}`,pr);
  };

  const setStatus=(i,txt,color='var(--muted)',title='')=>{
    const el=document.getElementById(`fc-st-${i}`);
    if(el) el.innerHTML=`<span style="color:${color};font-size:11px${title?';cursor:help':''}"${title?` title="${esc(title)}"`:''}>${txt}</span>`;
  };
  const tick=()=>{
    done++;
    const prog=document.getElementById('fc-prog');
    if(prog) prog.style.width=Math.round(100*done/total)+'%';
    const stEl=document.getElementById('fc-status');
    if(stEl) stEl.textContent=`Checked ${done}/${total}…`;
    const sumEl=document.getElementById('fc-summary');
    if(sumEl) sumEl.textContent=`${done}/${total} checked, ${found} prices found${failures?`, ${failures} failed`:''}`;
  };

  async function checkOne(it, i){
    if(stopped) return;
    setStatus(i,'⏳');
    const prPrice=parseFloat(it.priority_price)||0;
    try{
      // Labels/markers aren't catalogue parts — no distributor lists them, so
      // skip the network round-trip and use the agreed nominal price.
      if(/\b(label|marker)\b/i.test(it.description||'')){
        setStatus(i,'✓ nominal','var(--muted)','Labels/markers use a fixed $0.2 price');
        return;
      }
      const targetQty=_priceTargetQty(it.qty, it.unit);

      // ── Qualified Vendor List: price every approved alternative ──
      // A QVL names several manufacturer part numbers that the CUSTOMER has
      // already approved as interchangeable for one of their part numbers.
      // Since any of them may be bought, the correct quote is the cheapest —
      // pricing only the first (as this used to) could quote a part that costs
      // several times what an equally-approved alternative does.
      const alts=(it.alt_mpns||[]).filter(a=>a&&a.mpn);
      const candidates = alts.length>1 ? alts.map(a=>a.mpn) : [it.part_number];

      let pick=null;              // {res, pn, price, listed}
      const compared=[];          // for the tooltip: what was checked, and what it cost
      for(const cpn of candidates){
        if(stopped) return;
        let c=null;
        try{
          c=await lookupPartPrices(cpn, targetQty, it.description||'');
        }catch(e){
          compared.push({pn:cpn, error:e.message});
          // With one candidate there's nothing to fall back to, so the row
          // fails as before. With several, a single dead alternative must not
          // discard the others.
          if(candidates.length===1) throw e;
          continue;
        }
        for(const m of (c.errors||[])) apiErrors.add(m);
        const price = (c.best && c.best.price>0) ? c.best.price : 0;
        compared.push({pn:cpn, price, found:!!c.best});
        const cand={res:c, pn:cpn, price, listed:!!c.best};
        if(!pick) pick=cand;
        else if(cand.price>0 && (pick.price===0 || cand.price<pick.price)) pick=cand;   // cheaper wins
        else if(pick.price===0 && !pick.listed && cand.listed) pick=cand;               // listed beats missing
      }

      const r = pick ? pick.res : {mouser:null, digikey:null, best:null, listed:[], errors:[]};
      const chosenPn = pick ? pick.pn : it.part_number;
      const chosenMfr = (alts.find(a=>a.mpn===chosenPn)||{}).manufacturer || '';
      const priced=compared.filter(c=>c.price>0);
      const savedVs = priced.length>1 ? Math.max(...priced.map(c=>c.price)) : 0;

      // Show the winner in place of the provisional first pick.
      if(candidates.length>1){
        const pnEl=document.getElementById(`fc-pn-${i}`);
        if(pnEl){
          const lines=compared.map(c=>
            `${c.pn} — ${c.error?('error: '+c.error):(c.price>0?moneyUnit(c.price)+' /unit':(c.found?'listed, no price':'not found'))}`
          ).join('\n');
          pnEl.innerHTML=`${esc(chosenPn)}<span style="margin-left:5px;padding:1px 5px;border-radius:8px;background:#DCFCE7;color:#166534;font-size:9px;font-weight:700;cursor:help" title="${esc('Cheapest of '+candidates.length+' QVL-approved alternatives:\n\n'+lines)}">best of ${candidates.length}</span>`;
        }
      }

      const dkNum = r.digikey ? r.digikey.price : '';
      const moNum = r.mouser  ? r.mouser.price  : '';
      // Stored per-unit (that's what the columns elsewhere hold), displayed as
      // the line total for this row's quantity.
      paintRow(i,
        _lineCost(it,'digikey_price',dkNum),
        _lineCost(it,'mouser_price',moNum),
        _lineCost(it,'priority_price',prPrice));

      // Stock PER VENDOR. A single "Stock" column showed only whichever vendor
      // won on price, so you could not tell whether the other one had any —
      // which is the first thing you need when the cheapest source is empty.
      // 0 stays meaningful ("they carry it, none on hand"), distinct from blank
      // ("this vendor doesn't list it").
      const stockOf = v => v ? String(parseInt(v.stock,10)||0) : '';
      const mouserStock  = stockOf(r.mouser);
      const digikeyStock = stockOf(r.digikey);
      const paintStock=(id,val)=>{
        const el=document.getElementById(id); if(!el) return;
        if(val===''){ el.textContent='—'; el.style.color='var(--muted)'; el.title=''; return; }
        const n=parseInt(val,10)||0;
        el.textContent=n>0?n.toLocaleString():'0';
        el.style.color = n>0 ? 'var(--text)' : '#B45309';
        el.title = n>0 ? '' : 'Listed by this vendor, none currently in stock';
      };
      paintStock(`fc-ms-${i}`, mouserStock);
      paintStock(`fc-ds-${i}`, digikeyStock);

      if(!r.best){
        setStatus(i,'Not found','var(--muted)',
          'Neither Mouser nor DigiKey lists this part number.');
        return;
      }
      found++;
      // Three things worth telling apart in one glyph:
      //   ✓   priced, exact part-number match
      //   ✓ ≈ priced, matched under a differently formatted MPN
      //   ◑   listed but no price quoted (non-stocked / quote-only)
      const noPrice = !(r.best.price>0);
      const glyph = noPrice ? '◑' : (r.best.exact?'✓':'✓ ≈');
      let tip = noPrice
        ? `Listed by ${r.best.name} as "${r.best.mpn}"${r.best.status?` (${r.best.status})`:''} but no price is published — usually non-stocked or quote-only.`
        : (r.best.exact ? '' : `Matched ${r.best.name} part "${r.best.mpn}" — punctuation/zero-padding differs from "${it.part_number}"`);
      if(savedVs>pick.price){
        tip=(tip?tip+'\n\n':'')+`Cheapest QVL alternative: ${moneyUnit(pick.price)}/unit vs ${moneyUnit(savedVs)}/unit for the dearest approved option.`;
      }
      setStatus(i, glyph, noPrice?'#B45309':'var(--green)', tip);

      // The distributor knows the real manufacturer; our rows frequently don't
      // (a PDF BOM often omits it). Fill it in ONLY when we have nothing —
      // never overwrite a name that came from the customer's own QVL sheet,
      // which is the authoritative source when it exists.
      const vendorMfr=(r.best && r.best.manufacturer) || '';
      const newMfr = (!String(it.manufacturer||'').trim() && vendorMfr) ? vendorMfr : '';
      if(newMfr){
        it.manufacturer=newMfr;
        const mfEl=document.getElementById(`fc-mf-${i}`);
        if(mfEl){ mfEl.textContent=newMfr; mfEl.style.color='var(--text)'; }
      }

      // Match quality, per vendor, recorded on the row. Until now this lived
      // only in the Check Price modal's status column and vanished the moment
      // it was closed — so whoever later read the price had no way to tell a
      // quote for the EXACT part from one matched under a differently
      // formatted part number. On a quote that difference matters.
      //   'exact'   — priced, part number matched exactly
      //   'approx'  — priced, matched ignoring punctuation/zero-padding
      //   'noprice' — vendor lists the part but publishes no price
      //   ''        — vendor doesn't list it
      const matchCode=v=>!v ? '' : (!(v.price>0) ? 'noprice' : (v.exact ? 'exact' : 'approx'));
      const matchFields={
        mouser_match:  matchCode(r.mouser),
        mouser_mpn:    r.mouser  ? (r.mouser.mpn||'')  : '',
        mouser_mfr:    r.mouser  ? (r.mouser.manufacturer||'') : '',
        mouser_alts:   r.mouser  ? (r.mouser.considered||1) : 0,
        mouser_desc:   r.mouser  ? String(r.mouser.desc||'').slice(0,160) : '',
        // What was compared, so the tooltip can show the actual choice instead
        // of just asserting one was made. Capped for Firestore's document size.
        mouser_by:     r.mouser  ? (r.mouser.chosenBy||'') : '',
        mouser_cands:  r.mouser  ? (r.mouser.candidates||[]).slice(0,6).map(c=>({
                         pn:String(c.pn||'').slice(0,60), mfr:String(c.mfr||'').slice(0,40),
                         desc:String(c.desc||'').slice(0,90), score:c.score||0,
                         price:+c.price||0})) : [],
        digikey_match: matchCode(r.digikey),
        digikey_mpn:   r.digikey ? (r.digikey.mpn||'') : '',
        digikey_mfr:   r.digikey ? (r.digikey.manufacturer||'') : '',
        digikey_alts:  r.digikey ? (r.digikey.considered||1) : 0,
        digikey_desc:  r.digikey ? String(r.digikey.desc||'').slice(0,160) : '',
        digikey_by:    r.digikey ? (r.digikey.chosenBy||'') : '',
        digikey_cands: r.digikey ? (r.digikey.candidates||[]).slice(0,6).map(c=>({
                         pn:String(c.pn||'').slice(0,60), mfr:String(c.mfr||'').slice(0,40),
                         desc:String(c.desc||'').slice(0,90), score:c.score||0,
                         price:+c.price||0})) : [],
      };

      const stockFields={ mouser_stock:mouserStock, digikey_stock:digikeyStock };
      // Legacy single field kept in step with the winning vendor so older rows
      // and any code still reading `stock` don't suddenly go blank.
      const stock=String(r.best ? (parseInt(r.best.stock,10)||0) : 0);
      if(mode==='parts'){
        if(it._id){
          try{
            const patch={
              mouser_price:moNum, digikey_price:dkNum, ...matchFields, ...stockFields,
              stock, qty:1
            };
            if(newMfr) patch.manufacturer=newMfr;
            // The cheapest approved alternative becomes the part we quote.
            if(candidates.length>1 && chosenPn && chosenPn!==it.part_number){
              patch.part_number=chosenPn;
              if(chosenMfr) patch.manufacturer=chosenMfr;
            }
            await updatePartFields(it._id,patch);
            const ap=S.allParts.find(p=>p._id===it._id);
            if(ap){
              ap.mouser_price=moNum; ap.digikey_price=dkNum; ap.stock=stock;
              Object.assign(ap, matchFields, stockFields);
              if(newMfr) ap.manufacturer=newMfr;
              if(patch.part_number){ ap.part_number=patch.part_number; ap.manufacturer=chosenMfr||ap.manufacturer; }
            }
          }catch(e){ console.warn('price save error:',e.message); }
        }
      } else if(mode==='sd'){
        const sdIdx=it._sdIdx;
        if(sdIdx!==undefined&&sdItems[sdIdx]){
          sdItems[sdIdx].mouser_price=moNum;
          sdItems[sdIdx].digikey_price=dkNum;
          Object.assign(sdItems[sdIdx], matchFields, stockFields);
          if(newMfr) sdItems[sdIdx].manufacturer=newMfr;
          if(candidates.length>1 && chosenPn && chosenPn!==sdItems[sdIdx].part_number){
            sdItems[sdIdx].part_number=chosenPn;
            if(chosenMfr) sdItems[sdIdx].manufacturer=chosenMfr;
          }
          _sdRecalcTotal(sdItems[sdIdx]);
        }
        // Mirror into the Database so the next quote starts from a known price.
        try{
          const pn=(it.part_number||'').trim();
          if(pn){
            const existing=S.allParts.find(p=>String(p.part_number||'').toLowerCase()===pn.toLowerCase());
            if(existing){
              const sdPatch={
                mouser_price:moNum, digikey_price:dkNum, ...matchFields, ...stockFields,
                stock, qty:1
              };
              if(newMfr) sdPatch.manufacturer=newMfr;
              await updatePartFields(existing._id,sdPatch);
              existing.mouser_price=moNum; existing.digikey_price=dkNum; existing.stock=stock;
              Object.assign(existing, matchFields, stockFields);
              if(newMfr) existing.manufacturer=newMfr;
            } else {
              const key=pn.replace(/[\/\\#\[\]*?]/g,'_').slice(0,500);
              await mergePartDoc(key,{
                part_number:pn, description:'', drawing_number:'', manufacturer:newMfr||'',
                unit:'', atlantium_pn:'', qty:1, stock, ...matchFields, ...stockFields,
                mouser_price:moNum, digikey_price:dkNum,
                price_description:'', deleted:false
              });
              S.allParts.push({_id:key, part_number:pn, qty:1, stock, ...matchFields, ...stockFields,
                mouser_price:moNum, digikey_price:dkNum, manufacturer:newMfr||''});
            }
          }
        }catch(e){ console.warn('price->Database save error:',e.message); }
      }
    }catch(e){
      failures++;
      lastError=e.message||String(e);
      const short=lastError.length>50?lastError.slice(0,50)+'…':lastError;
      setStatus(i, esc(short), 'var(--red)', lastError);
      console.warn('price check error',it.part_number,lastError);
    }
  }

  // Fixed-size worker pool: each worker pulls the next index until they run out.
  // Simpler than batching and keeps every slot busy even when one part is slow.
  let next=0;
  const worker=async()=>{
    while(!stopped){
      const i=next++;
      if(i>=items.length) return;
      await checkOne(items[i], i);
      tick();
    }
  };
  await Promise.all(Array.from({length:Math.min(PRICE_CHECK_CONCURRENCY,total)}, worker));

  const prog=document.getElementById('fc-prog'); if(prog) prog.style.width='100%';
  const stEl=document.getElementById('fc-status');
  if(stEl){
    stEl.textContent=`Done — ${found}/${total} prices found${failures?`, ${failures} failed`:''}`;
    // If EVERY part failed it's an outage or a credential problem, not a data
    // problem — say so plainly instead of leaving the user guessing.
    if(failures===total && total>0){
      stEl.innerHTML=`<span style="color:var(--red)">Price check failed for all ${total} part(s) — ${esc(lastError)}</span>`;
    }
    // Deliberately NOT warned about: a vendor with no credentials at all.
    // Running with only one of the two is a supported setup, and nagging on
    // every check would train the user to ignore this line — including when it
    // says something that matters.
    for(const m of [...apiErrors]) if(/no (api key|credentials) configured/i.test(m)) apiErrors.delete(m);
    if(apiErrors.size){
      const note=document.createElement('div');
      note.style.cssText='margin-top:6px;font-size:11px;color:#92400e';
      note.textContent='Mouser/DigiKey API: '+[...apiErrors].slice(0,3).join(' · ');
      stEl.parentElement?.appendChild(note);
    }
  }
  const stopBtn=document.getElementById('btn-fc-stop');
  if(stopBtn){stopBtn.textContent='Close';stopBtn.className='btn btn-green';
    stopBtn.onclick=()=>{closeModal();_fcRefresh();};
  }
  const ringEl=document.querySelector('#fc-modal-body .ring');
  if(ringEl){ringEl.style.cssText='width:16px;height:16px;border-radius:50%;background:#1B6B3A;border:none;animation:none;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1';ringEl.textContent='✓';}
  // Audit trail for every price check — success AND failure, so a run that
  // found nothing is distinguishable from one that never reached the vendors.
  logSystemAudit('price_check',{
    screen: mode==='parts'?'Database':'Sales Desk',
    checked: done, found, failed: failures, stopped, ms: Date.now()-_fcT0,
    ...(failures?{error:lastError}:{})
  }, failures!==total || total===0);
}
