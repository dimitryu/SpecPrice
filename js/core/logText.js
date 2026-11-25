// ── Log entries in plain words (v1.83.7) ──────────────────────────────────────
// What Admin › Logs shows for each entry. The stored entry stays as it was
// written (an action code and a details object, times in milliseconds — the
// Statistics screen averages them and old entries must keep comparing), and
// this turns it into a title, a one-line summary and a list of labelled
// values a person can read: every time in seconds, every step by its name,
// yes/no instead of true/false, codes replaced by what they mean.
// Pure functions — no DOM, no database — so they are tested directly.

// The steps of a drawing analysis, by the key each screen logs them under.
export const LOG_STAGES={
  read:'Reading the parts list (BOM)', title:'Reading the title block', process:'Analysing the manufacturing process (labor time)',
  notes:'Reading the notes', tools:'Finding the crimp tools', desk:'Adding the rows to Sales Desk',
  'db':'Saving the parts to the Database', price:'Checking prices',
  prep:'Preparing the drawing', analyse:'Reading cut lengths and strip dimensions', bom:'Reading the part list',
  detail:'Reading the wiring table, labels and notes', figure:'Preparing the reference picture',
  sheets:'Looking up connector datasheets', save:'Saving the specification', translate:'Translating',
};

export const LOG_SCREENS={home:'Home','part-stock':'Database',rfq:'RFQ','sales-desk':'Sales Desk','cut-strip':'Cut & Strip',
  customers:'Customers',manufacturing:'Manufacturing Instructions',statistics:'Statistics',settings:'Settings',admin:'Admin',guide:'User Guide'};

// action code → title
export const LOG_ACTIONS={
  login:'Signed in', logout:'Signed out', screen_open:'Opened a screen',
  password_changed:'Changed own password', password_reset_requested:'Asked for a password reset link',
  user_password_reset_sent:'Sent a password reset link to a user',
  sales_desk_add_from_drawing:'Drawing analysed and added to Sales Desk',
  sales_desk_add_from_picker:'Parts added to Sales Desk from the Database',
  sales_desk_tools_for_picker:'Crimp tools found for parts added from the Database',
  sales_desk_save_to_db:'Sales Desk saved to the Database', sales_desk_leave_unsaved:'Left Sales Desk without saving',
  sales_desk_export:'Quotation exported to Excel',
  drawing_bom_pdf:'Parts list read from a PDF drawing', drawing_bom_search:'AI read the parts list',
  drawing_title_block:'AI read the title block', drawing_notes_search:'AI read the drawing notes',
  drawing_price_calculation:'AI analysed the manufacturing process (labor time)',
  labor_estimate_from_parts:'Labor time estimated from the parts', labor_breakdown_translate:'Labor breakdown translated',
  crimp_tool_search:'Crimp tools searched for', price_check:'Prices checked with the suppliers',
  cut_strip_generated:'Cut & Strip sheet created from a drawing', cut_strip_edited:'Cut & Strip sheet edited and saved',
  cut_strip_deleted:'Cut & Strip sheet deleted', cut_strip_datasheets:'Connector datasheets found',
  cut_strip_proposed_strips:'Strip lengths proposed', cut_strip_reply:'AI reply for a Cut & Strip analysis',
  mfg_saved:'Manufacturing instruction saved', mfg_deleted:'Manufacturing instruction deleted',
  mfg_steps_written:'Manufacturing steps drafted',
  database_delete_parts:'Parts moved to Deleted items', database_restore_parts:'Parts restored from Deleted items',
  database_purge_parts:'Parts deleted permanently', database_trash_days:'Deleted-items retention changed',
  priority_import:'Priority prices imported', tools_catalog_import:'Tools catalog imported',
  fc_fields_purged:'Old FindChips fields cleaned up',
  rfq_created:'RFQ created', rfq_deleted:'RFQ deleted', rfq_drawing_read:'Drawing read into an RFQ', rfq_bom_saved:'BOM saved to an RFQ',
  customer_created:'Customer created', customer_updated:'Customer updated', customer_deleted:'Customer deleted',
  role_saved:'Role saved', role_deleted:'Role deleted', roles_seeded:'Default roles created',
  ai_keys_updated:'AI key saved', ai_key_test:'AI key tested',
  distributor_api_keys_updated:'Supplier API keys saved', distributor_api_test:'Supplier API keys tested',
  supplier_api_error:'Supplier problem while checking prices',
  support_ticket_submitted:'Support request sent', ticket_replied:'Admin replied to a support request',
  ticket_user_replied:'User replied to a support request', ticket_status_changed:'Support request status changed',
  recycle_bin_restore:'Restored from the Recycle Bin', recycle_bin_purge:'Deleted permanently from the Recycle Bin',
  statistics_export:'Statistics exported to Excel',
  user_created:'User created', user_updated:'User changed', user_deleted:'User deleted',
};
export function logTitle(action){
  const a=String(action||'');
  if(LOG_ACTIONS[a]) return LOG_ACTIONS[a];
  const s=a.replace(/_/g,' ').trim();
  return s ? s[0].toUpperCase()+s.slice(1) : 'Event';
}

// Seconds, always. Past a minute the minutes are added in brackets.
export function logSec(ms){
  const n=Number(ms);
  if(!isFinite(n) || n<0) return '';
  const s=n/1000;
  const txt=(s<10 ? s.toFixed(1) : s<100 ? s.toFixed(1) : String(Math.round(s)))+' s';
  if(s<60) return txt;
  const m=Math.floor(s/60), r=Math.round(s-m*60);
  return `${txt} (${m} min ${String(r).padStart(2,'0')} s)`;
}

// field → label, used for every action unless the action names it itself
export const LOG_LABELS={
  drawing:'Drawing', drawing_number:'Drawing', drawings:'Drawings', file:'File', filename:'File', files:'Files',
  count:'Count', rows:'Rows', rowsFound:'Rows found', page:'Page', screen:'Screen', role:'Role', email:'Email', name:'Name',
  ms:'Total time', stage_ms:'Time of each step', error:'Error', note:'Note', diag:'What happened', message:'Message',
  checked:'Parts checked', found:'Found', failed:'Failed', stopped:'Stopped by the user',
  contacts:'Crimp contacts', web:'Web search used', webError:'Web search problem', deep:'Searched again in depth',
  searches:'Web searches', opened:'Pages opened', stepsFound:'Manufacturing steps found', notesFound:'Notes found',
  updated:'Updated', created:'New', unchanged:'Unchanged', fields:'Fields changed', errors:'Errors',
  added:'Added', parts:'Parts', minutes:'Labor minutes', steps:'Steps', unverified:'Values still to confirm (TBC)',
  priced:'Parts priced', mode:'Read from', how:'How it was read', text_header:'PDF text has a parts-list header',
  text_rows:'Numbered rows counted in the PDF text', items:'Items', days:'Days kept', keep_days:'Kept for (days)',
  reason:'Reason', to:'To', from:'From', blocks:'Report sections', views:'Screens', disabledViews:'Screens turned off',
  read_only:'Read-only', roles:'Roles', ticketId:'Request', status:'Status', chars:'Text length (characters)',
  id:'Document', project:'RFQ', disabled:'Blocked', displayName:'Name', backfill:'Found later, in the background', phase:'Pass', stop:'Why the reply ended',
  why:'Detail', rounds:'Continuations', partial:'Reply incomplete', kept:'Kept', on:'When',
};
// what an action calls its own fields
export const LOG_ACTION_LABELS={
  sales_desk_add_from_drawing:{count:'Parts added to the desk', files:'Drawings'},
  sales_desk_add_from_picker:{count:'Parts added'},
  sales_desk_tools_for_picker:{added:'Tools added', 'db':'From the Database', known:'From the standard tooling table', web:'From the web', ai:'From AI', owned:'Already in stock'},
  sales_desk_save_to_db:{updated:'Parts updated', created:'New parts', unchanged:'Parts unchanged', errors:'Parts not saved'},
  sales_desk_leave_unsaved:{parts:'Unsaved parts'},
  sales_desk_export:{rows:'Rows', file:'File name'},
  drawing_bom_pdf:{rows:'Rows read'}, drawing_bom_search:{rowsFound:'Rows read'},
  drawing_title_block:{found:'Drawing #, title or revision found'},
  crimp_tool_search:{found:'Tools found'},
  price_check:{found:'Found at a supplier', failed:'Lookups that failed'},
  supplier_api_error:{suppliers:'Supplier', error:'What the supplier answered', errors:'All the problems', checked:'Parts checked'},
  distributor_api_test:{pn:'Test part', mouser:'Mouser', digikey:'DigiKey', onlinecomp:'Online Components', farnell:'Farnell'},
  database_delete_parts:{count:'Parts', items:'Parts', to:'Moved to'}, database_restore_parts:{count:'Parts', items:'Parts'},
  database_purge_parts:{count:'Parts', items:'Parts'},
  priority_import:{updated:'Prices updated', created:'New parts'}, tools_catalog_import:{updated:'Parts updated', created:'New parts'},
  rfq_drawing_read:{rows:'Rows read'}, rfq_bom_saved:{rows:'Rows saved'},
  cut_strip_datasheets:{found:'Datasheets found'}, cut_strip_proposed_strips:{count:'Strip lengths proposed'},
  cut_strip_reply:{rows:'Parts', added:'Values added'},
  recycle_bin_restore:{count:'Restored', items:'Items'}, recycle_bin_purge:{count:'Deleted', items:'Items'},
  statistics_export:{from:'From', to:'To'}, support_ticket_submitted:{files:'Attached files'},
  ticket_replied:{files:'Attached files'}, ticket_user_replied:{files:'Attached files'},
  labor_estimate_from_parts:{rows:'Parts', steps:'Steps'}, mfg_saved:{steps:'Steps'}, mfg_steps_written:{steps:'Steps drafted'},
};
// fields that mean nothing to a reader
export const LOG_HIDDEN=['provider','storage','anthropic','part'];   // fields that mean nothing to a reader
export const LOG_VALUES={
  mode:{text:'the PDF text', vision:'the picture of the drawing', callouts:'the part labels on the drawing', excel:'the spreadsheet'},
  how:{text:'from the PDF text', region:'parts list found on the sheet and read', page:'whole sheet read',
       callouts:'part labels on the drawing (no parts list)', '':'nothing found'},
  to:{recycle_bin:'Deleted items'}, on:{leave:'on leaving the screen'},
  reason:{manual:'by hand'}, phase:{core:'cut lengths', 'core-retry':'cut lengths (second try)', bom:'part list', detail:'wiring and labels'},
};
function _labelOf(action, k){
  const own=(LOG_ACTION_LABELS[action]||{})[k];
  if(own) return own;
  if(LOG_LABELS[k]) return LOG_LABELS[k];
  const s=String(k).replace(/_ms$/,' time').replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
  return s[0].toUpperCase()+s.slice(1);
}
function _valueOf(action, k, v){
  if(v==null || v==='') return '';
  if(k==='ms' || /_ms$/.test(k)) return typeof v==='number' ? logSec(v) : String(v);
  if(typeof v==='boolean') return v ? 'Yes' : 'No';
  if(k==='screen') return LOG_SCREENS[v]||String(v);
  if(LOG_VALUES[k] && Object.prototype.hasOwnProperty.call(LOG_VALUES[k], v)) return LOG_VALUES[k][v];
  if(Array.isArray(v)){
    const xs=v.map(x=>x && typeof x==='object' ? (x.part_number||x.name||x.id||JSON.stringify(x)) : (k==='views'||k==='disabledViews') ? (LOG_SCREENS[x]||x) : x)
              .map(String).filter(Boolean);
    return xs.length>12 ? `${xs.slice(0,12).join(', ')} … (+${xs.length-12})` : xs.join(', ');
  }
  if(typeof v==='object'){
    if(typeof v.toDate==='function'){ try{ return v.toDate().toLocaleString(); }catch{ return ''; } }
    return Object.entries(v).map(([a,b])=>`${_labelOf(action,a)}: ${_valueOf(action,a,b)}`).join(' · ');
  }
  return String(v);
}

// The whole entry, readable: {title, summary, items:[{label,value,kind}], steps:[{label,sec}]}.
export function logDescribe(entry){
  const e=entry||{};
  const action=String(e.action||'');
  const d=e.details;
  const out={title:logTitle(action), code:action, summary:'', items:[], steps:[], error:''};
  if(d==null || d===''){ out.summary=e.success===false?'Did not work':'—'; return out; }
  if(typeof d!=='object'){ out.summary=String(d); out.items.push({label:'Note', value:String(d)}); if(e.success===false) out.error=String(d); return out; }
  for(const [k,v] of Object.entries(d)){
    if(LOG_HIDDEN.includes(k) || v==null || v==='') continue;
    if(k==='stage_ms' && v && typeof v==='object'){
      for(const [sk,ms] of Object.entries(v)) out.steps.push({key:sk, label:LOG_STAGES[sk]||_labelOf(action,sk), sec:logSec(ms), ms:Number(ms)||0});
      continue;
    }
    if(k==='error'){ out.error=String(v); }
    out.items.push({key:k, label:_labelOf(action,k), value:_valueOf(action,k,v)});
  }
  out.summary=_summary(action, d, out);
  return out;
}
export const _logN=(v,one,many)=>`${v} ${Number(v)===1?one:many}`;
// One line for the collapsed row: the result first, the time last.
function _summary(action, d, o){
  const t=d.ms!=null && typeof d.ms==='number' ? logSec(d.ms) : '';
  const tail=t ? ` · ${t}` : '';
  if(action==='supplier_api_error') return `${d.error||((d.suppliers||'Supplier')+': error')}${Array.isArray(d.errors)&&d.errors.length>1?` (+${d.errors.length-1} more)`:''}`;
  if(o.error) return `Error: ${o.error}${tail}`;
  switch(action){
    case 'sales_desk_add_from_drawing':
      return `${_logN(d.count||0,'part','parts')} added from ${_logN(d.files||1,'drawing','drawings')}`
        + (d.priced!=null?` · ${d.priced} priced`:'') + tail;
    case 'rfq_drawing_read': return `${_logN(d.rows||0,'row','rows')} read from ${_logN(d.files||1,'drawing','drawings')}${tail}`;
    case 'drawing_bom_pdf': return `${_logN(d.rows||0,'row','rows')} read — ${_valueOf(action,'how',d.how??'')}${d.page?` (page ${d.page})`:''}`;
    case 'drawing_bom_search': return `${_logN(d.rowsFound||0,'row','rows')} read from ${_valueOf(action,'mode',d.mode)}${tail}`;
    case 'drawing_title_block': return `${d.found?'Drawing #, title or revision found':'Nothing found in the title block'}${tail}`;
    case 'drawing_notes_search': return _logN(d.notesFound||0,'note found','notes found');
    case 'drawing_price_calculation': return `${_logN(d.stepsFound||0,'manufacturing step','manufacturing steps')} found${tail}`;
    case 'price_check': return `${d.checked||0} parts checked${d.screen?` on ${d.screen}`:''} · ${d.found||0} found`
        + (d.failed?` · ${d.failed} failed`:'') + (d.stopped?' · stopped by the user':'') + tail;
    case 'crimp_tool_search': return `${_logN(d.found||0,'tool','tools')} found for ${_logN(d.contacts||0,'contact','contacts')}`
        + (d.web===false?' · without web search':'') + tail;
    case 'cut_strip_generated': return `${d.drawing||d.file||''}${d.unverified!=null?` · ${d.unverified} value(s) to confirm`:''}${tail}`;
    case 'sales_desk_save_to_db': return `${d.updated||0} updated · ${d.created||0} new · ${d.unchanged||0} unchanged`+(d.errors?` · ${d.errors} not saved`:'');
    case 'screen_open': return _valueOf(action,'screen',d.screen);
    case 'login': return d.role?`Role: ${d.role}`:'—';
    case 'database_delete_parts': case 'database_restore_parts': case 'database_purge_parts':
      return `${_logN(d.count||0,'part','parts')}${d.part?` (log part ${d.part})`:''}`;
  }
  const first=o.items.filter(x=>x.key!=='drawing').slice(0,3).map(x=>`${x.label}: ${x.value}`);
  return (first.join(' · ') || (d.drawing?`Drawing: ${d.drawing}`:'—')) + (t && !first.some(x=>/^Total time/.test(x)) ? tail : '');
}
// Everything a search over the log should find, in the words shown.
export function logSearchText(entry){
  const x=logDescribe(entry);
  return [x.title, x.code, x.summary, ...x.items.map(i=>`${i.label} ${i.value}`), ...x.steps.map(s=>`${s.label} ${s.sec}`)].join(' | ');
}
