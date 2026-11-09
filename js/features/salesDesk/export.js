import { S } from '../../core/state.js';
import { logSystemAudit } from '../../core/audit.js';
import { fmtDate, toast } from '../../core/ui.js';
import { APP_VER } from '../../core/version.js';
import { MM_PER_FOOT, MM_PER_METER } from '../../domain/pricing.js';
import { _sdComputeSummary, _sdDwgSet, _sdIsToolRow, _sdPriceSource, _sdPriceSourceText, _sdSearchUrls, sdItems } from './salesDesk.js';
import { _XL, _xlBoxed, loadExcelJS } from '../../io/excel.js';

// ── Part Stock → Excel export (client-side via SheetJS) ───────────────────────
// `rows` are the rows to actually write out (selected rows, or every filtered row
// across all pages if nothing was selected); `totalCount` is always the full
// filtered-row count, used only to report "exported X of Y" in the toast.
export function exportPartStockExcel(rows, totalCount, cols){
  if(!window.XLSX){ toast('Excel library not loaded — please reload the page','error'); return; }
  if(!rows.length){ toast('No rows to export','error'); return; }
  const exportCols=cols.filter(c=>c.k!=='_fc');
  const headers=exportCols.map(c=>c.l);
  const aoa=[headers];
  rows.forEach(p=>{
    aoa.push(exportCols.map(c=>{
      if(c.k==='updatedAt') return fmtDate(p.updatedAt);
      if(c.k==='priority_price') return parseFloat(p.priority_price)||'';
      if(c.k==='mouser_price') return parseFloat(p.mouser_price)||'';
      if(c.k==='digikey_price') return parseFloat(p.digikey_price)||'';
      if(c.k==='unit') return p.unit||p.units||'';
      if(c.k==='rfq_names') return (p.rfq_names||[]).join(', ');
      return p[c.k]||'';
    }));
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=exportCols.map(()=>({wch:16}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Database');
  const fname=`Database_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb,fname);
  toast(`Exported ${rows.length} of ${totalCount} rows`,'success');
}

// ── RFQ Detail (BOM) → Excel export (client-side via SheetJS) ─────────────────
export function exportBOMExcel(rows, totalCount, cols, projectName){
  if(!window.XLSX){ toast('Excel library not loaded — please reload the page','error'); return; }
  if(!rows.length){ toast('No rows to export','error'); return; }
  const headers=cols.map(c=>c.l);
  const aoa=[headers];
  rows.forEach(r=>{
    aoa.push(cols.map(c=>{
      let val=r[c.k]||'';
      if(c.k==='drawing_number'&&!val) val=r._dwgName||'';
      return val;
    }));
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=cols.map(()=>({wch:16}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'BOM');
  const safeName=(projectName||'RFQ').replace(/[^\w\-]+/g,'_');
  const fname=`${safeName}_BOM_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb,fname);
  toast(`Exported ${rows.length} of ${totalCount} rows`,'success');
}

// Every drawing represented in the quote — used for both the header block and
// the file name, since a quote routinely covers more than one drawing.
export function _sdDrawingNumbers(){
  return [...new Set(sdItems.map(r=>String(r.drawing_number||'').trim()).filter(Boolean))];
}
// Windows forbids \ / : * ? " < > | in file names; a drawing number can legally
// contain some of those, so scrub before using it.
export function _safeFileName(s){
  return String(s||'').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
}

export async function exportSalesDeskExcel(){
  if(!sdItems.length){ toast('No items to export','error'); return; }

  const btn=document.getElementById('btn-sd-export');
  const restore=btn?btn.innerHTML:'';
  if(btn){ btn.disabled=true; btn.textContent='Building…'; }

  try{
    const ExcelJS=await loadExcelJS();
    const {groups,partsTotal,laborCost,subtotal,final,toolsTotal,laborMinutes,missingToolRows}=_sdComputeSummary();
    const dwgs=_sdDrawingNumbers();

    const wb=new ExcelJS.Workbook();
    wb.creator='SpecPrice'; wb.created=new Date();
    const ws=wb.addWorksheet('Quotation',{
      views:[{showGridLines:false}],
      pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
                 margins:{left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.3,footer:0.3}},
    });

    const COLS=['Item','Drawing #','MNF P/N','Description','Manufacturer','QTY','Units',
                'Mouser Price','Mouser Stock','DigiKey Price','DigiKey Stock','Priority Price',
                'Part Cost','Labor Time (min)'];
    const LAST=COLS.length;                 // 14 columns, A..N
    ws.columns=[{width:6},{width:18},{width:24},{width:40},{width:22},{width:9},{width:8},
                {width:13},{width:12},{width:13},{width:12},{width:13},{width:12},{width:15}];

    const merge=(r,c1,c2)=>ws.mergeCells(r,c1,r,c2);
    const fill=(cell,argb)=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb}};};

    // ── Header band: logo + title ──────────────────────────────────────────
    // Rows 1-4 are the brand band. The logo is floated over it via addImage,
    // which sits above cells rather than inside one.
    for(let r=1;r<=4;r++){
      merge(r,1,LAST);
      for(let c=1;c<=LAST;c++) fill(ws.getCell(r,c),_XL.brand);
    }
    ws.getRow(1).height=10; ws.getRow(4).height=8;
    ws.getRow(2).height=26; ws.getRow(3).height=18;

    const title=ws.getCell(2,1);
    title.value='PRELIMINARY QUOTATION';
    title.font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};
    title.alignment={vertical:'middle',horizontal:'center'};

    const sub=ws.getCell(3,1);
    // The banner is one centred line. Listing 33 drawing numbers there ran the
    // text clear off the page and told the reader nothing the summary table
    // two rows below doesn't say better — so past a handful, name the count
    // and the range instead. The full list stays in the Drawing(s) meta cell.
    sub.value = !dwgs.length ? 'Cable assembly'
      : dwgs.length<=4 ? `Drawing ${dwgs.join(' · ')}`
      : `${dwgs.length} drawings · ${dwgs[0]} … ${dwgs[dwgs.length-1]}`;
    sub.font={name:'Calibri',size:11,color:{argb:'FFBFD4EA'}};
    sub.alignment={vertical:'middle',horizontal:'center'};

    // The same logo shown on the Home screen (companies/{id}.logo_b64).
    if(S.companyLogoB64){
      try{
        const m=/^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(S.companyLogoB64);
        if(m){
          const ext=m[1].toLowerCase().startsWith('jp')?'jpeg':m[1].toLowerCase();
          const id=wb.addImage({base64:m[2], extension:ext});
          // Anchored to the top-left of the band, sized to sit inside it.
          ws.addImage(id,{tl:{col:0.25,row:0.6},ext:{width:150,height:44}});
        }
      }catch(e){ console.warn('[Export] logo could not be embedded:',e.message); }
    }

    // ── Meta block ────────────────────────────────────────────────────────
    let row=6;
    // Thirty-odd drawing numbers on a single line run clean off the page.
    // Six per line, wrapped, with the row grown to fit.
    const _dwgLines=[];
    for(let i2=0;i2<dwgs.length;i2+=6) _dwgLines.push(dwgs.slice(i2,i2+6).join(', '));
    const meta=[
      ['Date', new Date().toLocaleDateString()],
      ['Prepared by', S.currentUserEmail||''],
      ['Drawing(s)', _dwgLines.join('\n')||'—', _dwgLines.length],
      ['Line items', String(sdItems.length)],
      ['Drawings', String(groups.length)],
      ['Cables quoted', groups.map(g=>`${g.dwg} × ${g.units}`).join(', ')],
    ];
    meta.forEach(([k,v,lines])=>{
      const kc=ws.getCell(row,1); kc.value=k;
      kc.font={bold:true,size:10,color:{argb:'FF334155'}};
      fill(kc,_XL.brandLight);
      merge(row,2,4);
      const vc=ws.getCell(row,2); vc.value=v;
      vc.font={size:10,color:{argb:'FF0F172A'}};
      if(lines>1){
        vc.alignment={wrapText:true,vertical:'top'};
        ws.getRow(row).height=Math.min(lines*13+4,170);
      }
      fill(vc,_XL.brandLight);
      for(let c=1;c<=4;c++) ws.getCell(row,c).border=_xlBoxed;
      row++;
    });
    row++;

    // ══ Per-drawing quotation ══════════════════════════════════════════════
    // A quote covering several drawings is several quotes. Each drawing gets
    // its own BOM block and its own price build-up; the grand total is the sum
    // of those blocks and is never computed separately, so the summary can't
    // disagree with the detail.
    const secTitle=(text,argb)=>{
      merge(row,1,LAST);
      const c=ws.getCell(row,1);
      c.value=text;
      c.font={bold:true,size:11,color:{argb:'FFFFFFFF'}};
      c.alignment={vertical:'middle',indent:1};
      for(let i2=1;i2<=LAST;i2++) fill(ws.getCell(row,i2),argb);
      ws.getRow(row).height=20;
      row++;
    };
    const money=(label,val,opts={})=>{
      merge(row,1,LAST-2);
      const l=ws.getCell(row,1);
      l.value=label;
      l.font={bold:!!opts.bold,size:opts.size||10,color:{argb:opts.fg||'FF334155'}};
      l.alignment={vertical:'middle',horizontal:'right',indent:1};
      const v=ws.getCell(row,LAST-1);
      v.value=val;
      v.numFmt=opts.fmt||'$#,##0.00';
      v.font={bold:opts.bold!==false,size:opts.size||10,color:{argb:opts.fg||'FF0F172A'}};
      v.alignment={vertical:'middle',horizontal:'right'};
      for(let c=1;c<=LAST;c++){
        const cell=ws.getCell(row,c);
        fill(cell,opts.bg||_XL.calc);
        cell.border=_xlBoxed;
      }
      if(opts.height) ws.getRow(row).height=opts.height;
      row++;
    };

    // ══ LIVE WORKBOOK ════════════════════════════════════════════════════
    // Every money figure below is an Excel FORMULA, not a number typed in.
    // Change a price, a QTY or one of the yellow cells (labor minutes, rate,
    // profit %) and Part Cost, the per-drawing price and the grand total all
    // recalculate — the file is a working quote, not a printout of one.
    //
    // The formulas restate the app's own rules (domain/pricing.js):
    //   • the three price columns are PER-UNIT prices; on a cable row (unit mm)
    //     Mouser/DigiKey are per FOOT and Priority per METRE, so the line cost
    //     is price × QTY/304.8 or price × QTY/1000 (_sdLineCost);
    //   • Part Cost = the cheapest of the priced sources (_sdRecalcTotal);
    //   • tools never enter the cable price (_sdComputeGroups).
    // Each formula also carries the app's result, so the file shows the right
    // numbers even in a viewer that does not calculate.
    const F=(formula,result)=>({formula, result:(isFinite(result)?+result:0)});
    const A=(r,c)=>ws.getCell(r,c).address;
    const XL_INPUT='FFFFF4C2';
    const markInput=(cell,note)=>{ fill(cell,XL_INPUT); if(note) cell.note=note; };
    const K_DIST=r=>`IF(LOWER(G${r})="mm",1/${MM_PER_FOOT},1)`;
    const K_PRI =r=>`IF(LOWER(G${r})="mm",1/${MM_PER_METER},1)`;
    const _num=v=>{ const n=parseFloat(v); return (isFinite(n)&&n>0)?n:null; };
    const _r6=v=>+(+v).toFixed(6);

    // One line telling the reader the file is live, under the meta block.
    merge(row,1,LAST);
    const _liveHint=ws.getCell(row,1);
    _liveHint.value='This quotation recalculates: edit a price or QTY in the parts table, or a yellow cell '
                  + '(labor minutes, rate, profit %), and Part Cost and every total update.';
    _liveHint.font={italic:true,size:9,color:{argb:'FF92400E'}};
    fill(_liveHint,XL_INPUT);
    row+=2;

    // ── Summary of drawings, first, so the reader sees the shape of the quote
    //    before wading through the parts. Only when there IS more than one.
    //    Its cells point at each drawing's block, written further down — so the
    //    rows are laid out now and their formulas filled in afterwards.
    const sumRows=[];
    let grandRow=0;
    if(groups.length>1){
      secTitle(`QUOTATION SUMMARY — ${groups.length} DRAWINGS`,'FF334155');
      const sh=['Drawing #','Rows','Units','Parts / Cable','Labor / Cable','Subtotal / Cable','Profit %',
                'UNIT PRICE','Order Total'];
      sh.forEach((h,k)=>{
        const c=ws.getCell(row,k+1);
        c.value=h; c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.bomHead); c.border=_xlBoxed;
        c.alignment={vertical:'middle',horizontal:k?'center':'left'};
      });
      row++;
      groups.forEach((g,k)=>{
        sumRows.push({row, g});
        for(let ci=1; ci<=9; ci++){
          const c=ws.getCell(row,ci);
          c.border=_xlBoxed; c.font={size:10};
          c.alignment={vertical:'middle',horizontal:ci>1?'right':'left'};
          if(k%2===1) fill(c,_XL.bomBand);
        }
        ws.getCell(row,1).value=g.dwg; ws.getCell(row,2).value=g.rows.length; ws.getCell(row,3).value=g.units;
        row++;
      });
      grandRow=row;
      for(let ci=1; ci<=9; ci++){
        const c=ws.getCell(row,ci);
        c.font={bold:true,size:11,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.final); c.border=_xlBoxed;
        c.alignment={vertical:'middle',horizontal:ci>1?'right':'left'};
      }
      ws.getCell(row,1).value='GRAND TOTAL (all orders)';
      ws.getCell(row,2).value=sdItems.length;
      ws.getCell(row,3).value=groups.reduce((a,g)=>a+g.units,0);
      ws.getRow(row).height=22;
      row++;
      merge(row,1,LAST);
      const _outlineHint=ws.getCell(row,1);
      _outlineHint.value='Each drawing\'s parts are grouped — click the 1 button above the left margin '
                       + 'to collapse them all to one line per drawing, 2 to expand again, '
                       + 'or the − beside a drawing\'s Parts Total row for just that one.';
      _outlineHint.font={italic:true,size:9,color:{argb:'FF64748B'}};
      _outlineHint.alignment={vertical:'middle',indent:1};
      row+=2;
    }

    let itemNo=0;
    const HEAD_NOTES={
      7:'Price per unit from Mouser. On a cable row (unit mm) it is per FOOT. Edit it and Part Cost and the totals update.',
      9:'Price per unit from DigiKey. On a cable row (unit mm) it is per FOOT. Edit it and Part Cost and the totals update.',
      11:'Price per unit from Priority. On a cable row (unit mm) it is per METRE. Edit it and Part Cost and the totals update.',
      12:'The cheapest of the three prices for this row\'s QTY (mm converted to ft for Mouser/DigiKey, to m for Priority).',
    };
    const bomHeaderRow=()=>{
      const hr=row;
      COLS.forEach((h,i2)=>{
        const c=ws.getCell(row,i2+1);
        c.value=h;
        c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.bomHead);
        c.alignment={vertical:'middle',horizontal:i2>=5?'center':'left',wrapText:true};
        c.border=_xlBoxed;
        if(HEAD_NOTES[i2]) c.note=HEAD_NOTES[i2];
      });
      ws.getRow(row).height=24;
      row++;
      return hr;
    };

    const blocks=[];
    let firstHeaderRow=0;
    groups.forEach(g=>{
      secTitle(`DRAWING ${g.dwg}   —   ${g.rows.length} row${g.rows.length===1?'':'s'}`
               + (g.units>1?`   —   ${g.units} cables   (QTY below is for all ${g.units})`:''),'FF334155');
      const hr=bomHeaderRow();
      if(!firstHeaderRow) firstHeaderRow=hr;
      const firstRow=row;
      const toolCells=[];

      g.rows.forEach((r,i)=>{
        const isTool=_sdIsToolRow(r);
        itemNo++;
        const n=row;
        const mm=String(r.unit||'').trim().toLowerCase()==='mm';
        const stockVal=v=>{ const x=r[v]; return (x===undefined||x===null||x==='') ? null : (parseInt(x,10)||0); };
        const qty=parseFloat(r.qty)||0;
        const mo=r.mouser_match==='noprice'?null:_num(r.mouser_price);
        const dk=r.digikey_match==='noprice'?null:_num(r.digikey_price);
        const pr=_num(r.priority_price);
        // Part Cost. Manual price in the app → kept as a per-unit price, so a
        // QTY change still moves it. No price anywhere → the estimate (tools).
        let cost;
        const manual = r.manual_total!=null && r.manual_total!=='';
        if(manual){
          const per=qty ? (parseFloat(r.manual_total)||0)/qty : 0;
          cost=F(`${_r6(per)}*F${n}`, r.total||0);
        } else {
          const a=`IF(N(H${n})>0,H${n}*F${n}*${K_DIST(n)},9E+99)`;
          const b=`IF(N(J${n})>0,J${n}*F${n}*${K_DIST(n)},9E+99)`;
          const c=`IF(N(L${n})>0,L${n}*F${n}*${K_PRI(n)},9E+99)`;
          const est=_num(r.est_price);
          const fb = est ? `${est}*F${n}*${K_DIST(n)}` : '0';
          cost=F(`IF(MIN(${a},${b},${c})<9E+98,MIN(${a},${b},${c}),${fb})`, r.total||0);
        }
        const vals=[itemNo, r.drawing_number||'', r.part_number||'', r.description||'',
                    r.manufacturer||'', qty, r.unit||'',
                    mo, stockVal('mouser_stock'), dk, stockVal('digikey_stock'), pr,
                    cost, +(r.labor_total||0)];
        vals.forEach((v,ci)=>{
          const c=ws.getCell(row,ci+1);
          c.value=v;
          c.font={size:10, color:{argb:isTool?'FF92400E':'FF0F172A'}, italic:isTool, bold:ci===12};
          c.border=_xlBoxed;
          if(ci===7||ci===9) c.numFmt = mm ? '$#,##0.0000" /ft"' : '$#,##0.0000';
          if(ci===11)        c.numFmt = mm ? '$#,##0.0000" /m"'  : '$#,##0.0000';
          if(ci===12) c.numFmt='$#,##0.00';
          if(ci===8||ci===10) c.numFmt='#,##0';
          if(ci===13) c.numFmt='0.0';
          if(ci===5)  c.numFmt='#,##0.###';
          let matchFlagged=false;
          if(ci===7||ci===9){
            const cfg = ci===7 ? {code:'mouser_match', mpn:'mouser_mpn', name:'Mouser'}
                               : {code:'digikey_match', mpn:'digikey_mpn', name:'DigiKey'};
            const code=r[cfg.code]||'';
            if(code==='approx'){
              c.font={...c.font, color:{argb:'FF92400E'}};
              matchFlagged=true;
              c.note=`Matched as "${r[cfg.mpn]||''}" on ${cfg.name} — different punctuation/zero-padding to "${r.part_number||''}". Verify before quoting.`;
            } else if(code==='noprice'){
              matchFlagged=true;
              c.note=`${cfg.name} lists this part but publishes no price (non-stocked / quote-only).`;
            }
          }
          if(ci===12 && manual) c.note='Manual price typed in Sales Desk — kept as a price per unit, so it follows QTY.';
          else if(ci===12 && isTool) c.note=_sdPriceSourceText(r);
          c.alignment={vertical:'middle',
                       horizontal: (ci===3||ci===4)?'left':(ci>=5?'right':'left'),
                       wrapText: ci===3};
          if(matchFlagged) fill(c,'FFFFFBEB');
          else if(isTool) fill(c,_XL.tool);
          else if(i%2===1) fill(c,_XL.bomBand);
        });
        if(isTool){
          toolCells.push({cell:A(n,13), r});
          ws.getCell(row,1).border={..._xlBoxed,left:{style:'medium',color:{argb:_XL.toolEdge}}};
          ws.getCell(row,4).value=`${r.description||''}   [TOOL — not from customer BOM]`;
        }
        row++;
      });
      const lastRow=row-1;

      // Fold this drawing's parts into a collapsible group, so the reader can
      // shrink the quote to one line per drawing plus its price build-up. The
      // price rows below stay OUTSIDE the group and are visible either way.
      //
      // Deliberately NOT shipped pre-collapsed. The price cells carry Excel
      // comments (the "matched under a different part number" warnings), and a
      // comment anchored to a HIDDEN row makes Excel declare the workbook
      // damaged and offer to repair it — which is exactly what happened when
      // this shipped collapsed. The outline's "1" button collapses everything
      // in one click, and the file opens.
      if(groups.length>1){
        for(let rr=hr; rr<row; rr++) ws.getRow(rr).outlineLevel=1;
      }

      // This drawing's own price build-up, immediately under its parts — as
      // formulas over the cells above, with its three settings as yellow inputs.
      const U=g.units;
      const partsSum = `SUM(M${firstRow}:M${lastRow})` + (toolCells.length ? `-(${toolCells.map(t=>t.cell).join('+')})` : '');
      const b={g};
      b.minutes=A(row,13);
      money('Labor time  (minutes per cable)', +(+g.laborMinutesPerUnit).toFixed(2), {fmt:'0.0', bold:false});
      markInput(ws.getCell(b.minutes), 'Editable — minutes to build one cable.');
      b.rate=A(row,13);
      money('Labor rate  ($ per minute)', +g.rate, {fmt:'$#,##0.00', bold:false});
      markInput(ws.getCell(b.rate), 'Editable — labor cost per minute.');
      b.pct=A(row,13);
      money('Profit %', (g.profitPct||0)/100, {fmt:'0.0%', bold:false});
      markInput(ws.getCell(b.pct), 'Editable — profit on the subtotal.');
      b.parts=A(row,13);
      money(`Parts  (per cable${U>1?` — parts table ÷ ${U}`:''})`, F(`(${partsSum})/${U}`, g.partsTotalPerUnit));
      b.labor=A(row,13);
      money('Labor  (minutes × rate, per cable)', F(`${b.minutes}*${b.rate}`, g.laborCostPerUnit));
      b.sub=A(row,13);
      money('Subtotal  (per cable)', F(`${b.parts}+${b.labor}`, g.subtotalPerUnit), {bold:true});
      b.profit=A(row,13);
      money('Profit  (per cable)', F(`${b.sub}*${b.pct}`, g.finalPerUnit-g.subtotalPerUnit));
      // Per cable is the number the customer compares and the one the sales
      // conversation is actually about, so it takes the highlighted band; the
      // order total follows in the quieter style underneath. With a single
      // cable the two are the same figure, so only one line is printed.
      b.unit=A(row,13);
      money(`Unit Price — ${g.dwg}`, F(`${b.sub}+${b.profit}`, g.finalPerUnit),
            {bold:true,size:13,bg:_XL.final,fg:'FFFFFFFF',height:24});
      b.order=b.unit;
      if(U>1){
        b.order=A(row,13);
        money(`Price per ${U} units`, F(`${b.unit}*${U}`, g.final),
              {bold:true,size:12,bg:'FF1F8B4C',fg:'FFFFFFFF',height:22});
      }
      b.orderExpr = U>1 ? b.order : b.unit;

      b.tools=null;
      if(g.missingToolRows.length){
        merge(row,1,LAST);
        const w=ws.getCell(row,1);
        w.value=`⚠  ${g.dwg}: final price does NOT include ${g.missingToolRows.length} manufacturing tool(s) — quoted separately below`;
        w.font={bold:true,size:12,color:{argb:'FF92400E'}};
        w.alignment={vertical:'middle',indent:1};
        for(let c=1;c<=LAST;c++){
          fill(ws.getCell(row,c),_XL.warn);
          ws.getCell(row,c).border={top:{style:'medium',color:{argb:_XL.warnEdge}},
                                    bottom:{style:'medium',color:{argb:_XL.warnEdge}}};
        }
        ws.getRow(row).height=22; row++;
        const toolRefs=[];
        // Column heads for the tool list: what the tool is, which connector it
        // is for, where its price came from, and a link to check it.
        [[2,'Tool'],[3,'Description'],[7,'For connector'],[9,'Price from'],[11,'Link'],[13,'Price']].forEach(([c,h])=>{
          const x=ws.getCell(row,c); x.value=h; x.font={bold:true,size:9,color:{argb:'FF92400E'}};
        });
        merge(row,3,6); merge(row,7,8); merge(row,9,10); merge(row,11,12);
        for(let c=1;c<=LAST;c++){ const cell=ws.getCell(row,c); fill(cell,_XL.tool); cell.border=_xlBoxed; }
        row++;
        g.missingToolRows.forEach(r=>{
          const src=_sdPriceSource(r);
          const q=_sdSearchUrls(r.part_number);
          ws.getCell(row,2).value=r.part_number||'';
          merge(row,3,6);  ws.getCell(row,3).value=r.description||'';
          merge(row,7,8);  ws.getCell(row,7).value=r.tool_for||'—';
          merge(row,9,10); ws.getCell(row,9).value=src.label;
          ws.getCell(row,9).note=_sdPriceSourceText(r);
          merge(row,11,12);
          const href=src.url || (r.part_number ? q.mouser : '');
          if(href) ws.getCell(row,11).value={text: src.url ? `${src.label} page ↗` : 'Search Mouser ↗', hyperlink: href};
          const v=ws.getCell(row,LAST-1);
          const tc=toolCells.find(t=>t.r===r);
          v.value = tc ? F(tc.cell, r.total||0) : +(r.total||0);
          v.numFmt='$#,##0.00'; v.alignment={horizontal:'right'};
          toolRefs.push(A(row,LAST-1));
          for(let c=1;c<=LAST;c++){
            const cell=ws.getCell(row,c);
            fill(cell,_XL.tool); cell.border=_xlBoxed; cell.font={size:10,color:{argb:'FF92400E'}};
          }
          ws.getCell(row,9).font={size:10,bold:true,color:{argb:src.verified?'FF166534':'FFB45309'}};
          if(href) ws.getCell(row,11).font={size:10,underline:true,color:{argb:'FF1D4ED8'}};
          ws.getCell(row,3).alignment={wrapText:true,vertical:'middle'};
          row++;
        });
        // A tools figure typed in Sales Desk wins over the sum, as it does there.
        const st=_sdDwgSet(g.dwg);
        const typed = st.toolsTotal!=null && st.toolsTotal!=='';
        b.tools=A(row,13);
        money(`TOOLS TOTAL — ${g.dwg} (separate)`,
              typed ? +g.toolsTotal.toFixed(2) : F(`SUM(${toolRefs.join(',')})`, g.toolsTotal),
              {bold:true,size:11,bg:_XL.warn,fg:'FF92400E',height:20});
      }
      blocks.push(b);
      row++;   // breathing room before the next drawing
    });

    // Now that every block has its cells, the summary table points at them.
    const sumOf=f=>blocks.map(f).join('+');
    sumRows.forEach(({row:sr},k)=>{
      const b=blocks[k], U=b.g.units;
      const put=(c,formula,result,fmt)=>{ const x=ws.getCell(sr,c); x.value=F(formula,result); x.numFmt=fmt||'$#,##0.00'; };
      put(4,b.parts,b.g.partsTotalPerUnit);
      put(5,b.labor,b.g.laborCostPerUnit);
      put(6,b.sub,b.g.subtotalPerUnit);
      put(7,b.pct,b.g.profitPct/100,'0%');
      put(8,b.unit,b.g.finalPerUnit);
      put(9,b.orderExpr,b.g.final);
    });
    if(grandRow){
      const put=(c,formula,result)=>{ const x=ws.getCell(grandRow,c); x.value=F(formula,result); x.numFmt='$#,##0.00'; };
      put(4, sumOf(b=>`${b.parts}*${b.g.units}`), partsTotal);
      put(5, sumOf(b=>`${b.labor}*${b.g.units}`), laborCost);
      put(6, sumOf(b=>`${b.sub}*${b.g.units}`), subtotal);
      put(9, sumOf(b=>b.orderExpr), final);
    }

    // ── Grand total, restated at the end ──
    if(groups.length>1){
      secTitle('GRAND TOTAL — ALL DRAWINGS','FF334155');
      money('Parts Total (all drawings)', F(sumOf(b=>`${b.parts}*${b.g.units}`), partsTotal));
      money('Labor Cost (all drawings)',  F(sumOf(b=>`${b.labor}*${b.g.units}`), laborCost));
      money('Subtotal (all drawings)',    F(sumOf(b=>`${b.sub}*${b.g.units}`), subtotal),{bold:true});
      money('TOTAL FINAL PRICE',          F(sumOf(b=>b.orderExpr), final),
            {bold:true,size:15,bg:_XL.final,fg:'FFFFFFFF',height:28});
      const withTools=blocks.filter(b=>b.tools);
      if(withTools.length){
        money(`TOOLS TOTAL — all drawings (NOT in the price)`, F(withTools.map(b=>b.tools).join('+'), toolsTotal),
              {bold:true,size:12,bg:_XL.warn,fg:'FF92400E',height:22});
      }
      row++;
    }
    // Excel recalculates every formula when the file opens, so nothing shown
    // can lag behind a value edited in another program first.
    wb.calcProperties={fullCalcOnLoad:true};

    // Freezing the first drawing's column-header row keeps the headers in view
    // while scrolling a single-drawing quote. With 33 drawings that row is ~50
    // rows down, and freezing there fills the entire window — the sheet stops
    // scrolling at all, which reads as a broken file. Every drawing carries its
    // own header row anyway, so a multi-drawing quote freezes only the banner.
    const _freezeAt = (groups.length===1 && firstHeaderRow && firstHeaderRow<=15)
      ? firstHeaderRow : 4;
    ws.views=[{state:'frozen',ySplit:_freezeAt,showGridLines:false}];
    if(groups.length>1){
      // outlineLevelRow only affects sheetFormatPr, which is safe.
      //
      // What is NOT safe, and cost two broken releases to find: setting
      // outlineProperties here. ExcelJS then writes
      //   <sheetPr><pageSetUpPr/><outlinePr/></sheetPr>
      // but the OOXML schema fixes the order of CT_SheetPr's children as
      // tabColor → outlinePr → pageSetUpPr. Excel validates that sequence
      // strictly and declares the whole workbook damaged — the "we found a
      // problem with some content" dialog — with no hint as to why. This
      // export sets pageSetup (fitToPage) for printing, so the two collide.
      // Leaving outlineProperties unset keeps sheetPr byte-identical to the
      // exports that have always opened cleanly; the only cost is that the
      // outline's +/- button sits on the row BELOW each group (Parts Total)
      // instead of on the DRAWING title above it. A button in a slightly
      // different place beats a file that won't open.
      ws.properties.outlineLevelRow=1;
    }


    // ── Footer ────────────────────────────────────────────────────────────
    merge(row,1,LAST);
    const foot=ws.getCell(row,1);
    foot.value='Preliminary quotation — prices are indicative and subject to confirmation. '
              +`Generated by SpecPrice v${APP_VER} on ${new Date().toLocaleString()}.`;
    foot.font={size:9,italic:true,color:{argb:'FF64748B'}};
    foot.alignment={vertical:'middle',indent:1};

    // ── Save ──────────────────────────────────────────────────────────────
    // Name carries the drawing number(s) and says plainly that it's preliminary,
    // so the file is identifiable once it's sitting in someone's Downloads.
    const dwgPart = dwgs.length ? _safeFileName(dwgs.slice(0,3).join(' ')) + ' ' : '';
    const fname=`Preliminary Quotation ${dwgPart}${new Date().toISOString().slice(0,10)}.xlsx`
                .replace(/\s+/g,' ');
    const buf=await wb.xlsx.writeBuffer();
    const url=URL.createObjectURL(new Blob([buf],
      {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a=document.createElement('a');
    a.href=url; a.download=fname; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),4000);

    toast('Quotation downloaded','success');
    logSystemAudit('sales_desk_export',{rows:sdItems.length,drawings:dwgs.join(', '),file:fname},true);
  }catch(e){
    console.error('[Export]',e);
    toast('Export failed: '+e.message,'error');
    logSystemAudit('sales_desk_export',e.message,false);
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=restore; }
  }
}
