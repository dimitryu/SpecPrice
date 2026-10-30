import { S } from '../../core/state.js';
import { logSystemAudit } from '../../core/audit.js';
import { fmtDate, toast } from '../../core/ui.js';
import { APP_VER } from '../../core/version.js';
import { _sdLineCost } from '../../domain/pricing.js';
import { _sdComputeSummary, _sdIsToolRow, sdItems } from './salesDesk.js';
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
                'Mouser Cost','Mouser Stock','DigiKey Cost','DigiKey Stock','Priority Cost',
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

    // ── Summary of drawings, first, so the reader sees the shape of the quote
    //    before wading through the parts. Only when there IS more than one.
    if(groups.length>1){
      secTitle(`QUOTATION SUMMARY — ${groups.length} DRAWINGS`,'FF334155');
      // Units sits right after Rows: the reader needs to know the price covers
      // 10 cables before reading the price.
      // Per-cable columns first — the breakdown people read — then the order
      // total at the end, matching the panel in the app.
      const sh=['Drawing #','Rows','Units','Parts / Cable','Labor / Cable','Subtotal / Cable','Profit %',
                'UNIT PRICE','Order Total'];
      const MONEY_COLS=[3,4,5,7,8], PCT_COL=6;
      sh.forEach((h,k)=>{
        const c=ws.getCell(row,k+1);
        c.value=h; c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.bomHead); c.border=_xlBoxed;
        c.alignment={vertical:'middle',horizontal:k?'center':'left'};
      });
      row++;
      groups.forEach((g,k)=>{
        const vals=[g.dwg,g.rows.length,g.units,
                    +g.partsTotalPerUnit.toFixed(2),+g.laborCostPerUnit.toFixed(2),
                    +g.subtotalPerUnit.toFixed(2),g.profitPct/100,
                    +g.finalPerUnit.toFixed(2),+g.final.toFixed(2)];
        vals.forEach((v,ci)=>{
          const c=ws.getCell(row,ci+1);
          c.value=v; c.border=_xlBoxed; c.font={size:10};
          if(MONEY_COLS.includes(ci)) c.numFmt='$#,##0.00';
          if(ci===PCT_COL) c.numFmt='0%';
          c.alignment={vertical:'middle',horizontal:ci?'right':'left'};
          if(k%2===1) fill(c,_XL.bomBand);
        });
        row++;
      });
      // Grand total sits in the same table, so the columns line up under it.
      // Total cables across every drawing — the "how big is this order" number.
      const totalUnits=groups.reduce((a,g)=>a+g.units,0);
      // The grand total row is order-wide by definition, so its money columns
      // are the full figures, not per-cable ones — labelled in the header above.
      const gv=['GRAND TOTAL (all orders)',sdItems.length,totalUnits,
                +partsTotal.toFixed(2),+laborCost.toFixed(2),
                +subtotal.toFixed(2),null,null,+final.toFixed(2)];
      gv.forEach((v,ci)=>{
        const c=ws.getCell(row,ci+1);
        if(v!==null) c.value=v;
        c.font={bold:true,size:11,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.final); c.border=_xlBoxed;
        if(MONEY_COLS.includes(ci)) c.numFmt='$#,##0.00';
        c.alignment={vertical:'middle',horizontal:ci?'right':'left'};
      });
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
    const bomHeaderRow=()=>{
      const hr=row;
      COLS.forEach((h,i2)=>{
        const c=ws.getCell(row,i2+1);
        c.value=h;
        c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
        fill(c,_XL.bomHead);
        c.alignment={vertical:'middle',horizontal:i2>=5?'center':'left',wrapText:true};
        c.border=_xlBoxed;
      });
      ws.getRow(row).height=24;
      row++;
      return hr;
    };

    let firstHeaderRow=0;
    groups.forEach(g=>{
      secTitle(`DRAWING ${g.dwg}   —   ${g.rows.length} row${g.rows.length===1?'':'s'}`
               + (g.units>1?`   —   ${g.units} cables   (QTY below is for all ${g.units})`:''),'FF334155');
      const hr=bomHeaderRow();
      if(!firstHeaderRow) firstHeaderRow=hr;

      g.rows.forEach((r,i)=>{
        const isTool=_sdIsToolRow(r);
        itemNo++;
        const stockVal=v=>{ const x=r[v]; return (x===undefined||x===null||x==='') ? null : (parseInt(x,10)||0); };
        const vals=[itemNo, r.drawing_number||'', r.part_number||'', r.description||'',
                    r.manufacturer||'',
                    parseFloat(r.qty)||0, r.unit||'',
                    _sdLineCost(r,'mouser_price')||null,  stockVal('mouser_stock'),
                    _sdLineCost(r,'digikey_price')||null, stockVal('digikey_stock'),
                    _sdLineCost(r,'priority_price')||null,
                    +(r.total||0), +(r.labor_total||0)];
        vals.forEach((v,ci)=>{
          const c=ws.getCell(row,ci+1);
          c.value=v;
          c.font={size:10, color:{argb:isTool?'FF92400E':'FF0F172A'}, italic:isTool};
          c.border=_xlBoxed;
          if(ci===7||ci===9||ci===11) c.numFmt='$#,##0.00';
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
              c.value=null; matchFlagged=true;
              c.note=`${cfg.name} lists this part but publishes no price (non-stocked / quote-only).`;
            }
          }
          c.alignment={vertical:'middle',
                       horizontal: (ci===3||ci===4)?'left':(ci>=5?'right':'left'),
                       wrapText: ci===3};
          if(matchFlagged) fill(c,'FFFFFBEB');
          else if(isTool) fill(c,_XL.tool);
          else if(i%2===1) fill(c,_XL.bomBand);
        });
        if(isTool){
          ws.getCell(row,1).border={..._xlBoxed,left:{style:'medium',color:{argb:_XL.toolEdge}}};
          ws.getCell(row,4).value=`${r.description||''}   [TOOL — not from customer BOM]`;
        }
        row++;
      });

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

      // This drawing's own price build-up, immediately under its parts.
      money('Parts  (per cable)',+g.partsTotalPerUnit.toFixed(2));
      money(`Labor  (${(+g.laborMinutesPerUnit).toFixed(1)} min × $${g.rate}/min, per cable)`,
            +g.laborCostPerUnit.toFixed(2));
      money('Subtotal  (per cable)',+g.subtotalPerUnit.toFixed(2),{bold:true});
      money(`Profit (${g.profitPct}%)`,+(g.finalPerUnit-g.subtotalPerUnit).toFixed(2));
      // Per cable is the number the customer compares and the one the sales
      // conversation is actually about, so it takes the highlighted band; the
      // order total follows in the quieter style underneath. With a single
      // cable the two are the same figure, so only one line is printed.
      money(`Unit Price — ${g.dwg}`,+g.finalPerUnit.toFixed(2),
            {bold:true,size:13,bg:_XL.final,fg:'FFFFFFFF',height:24});
      if(g.units>1){
        // Its own green band rather than a footnote: the order total is the
        // second real answer on the page, not a remark about the first.
        money(`Price per ${g.units} units`,+g.final.toFixed(2),
              {bold:true,size:12,bg:'FF1F8B4C',fg:'FFFFFFFF',height:22});
      }

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
        g.missingToolRows.forEach(r=>{
          ws.getCell(row,2).value=r.part_number||'';
          merge(row,3,LAST-2);
          ws.getCell(row,3).value=r.description||'';
          const v=ws.getCell(row,LAST-1);
          v.value=+(r.total||0); v.numFmt='$#,##0.00'; v.alignment={horizontal:'right'};
          for(let c=1;c<=LAST;c++){
            const cell=ws.getCell(row,c);
            fill(cell,_XL.tool); cell.border=_xlBoxed; cell.font={size:10,color:{argb:'FF92400E'}};
          }
          row++;
        });
        money(`TOOLS TOTAL — ${g.dwg} (separate)`,+g.toolsTotal.toFixed(2),
              {bold:true,size:11,bg:_XL.warn,fg:'FF92400E',height:20});
      }
      row++;   // breathing room before the next drawing
    });

    // ── Grand total, restated at the end ──
    if(groups.length>1){
      secTitle('GRAND TOTAL — ALL DRAWINGS','FF334155');
      money('Parts Total (all drawings)',+partsTotal.toFixed(2));
      money('Labor Cost (all drawings)',+laborCost.toFixed(2));
      money('Subtotal (all drawings)',+subtotal.toFixed(2),{bold:true});
      money('TOTAL FINAL PRICE',+final.toFixed(2),
            {bold:true,size:15,bg:_XL.final,fg:'FFFFFFFF',height:28});
      if(missingToolRows.length){
        money(`TOOLS TOTAL — all drawings (NOT in the price)`,+toolsTotal.toFixed(2),
              {bold:true,size:12,bg:_XL.warn,fg:'FF92400E',height:22});
      }
      row++;
    }

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
