import { _csToday } from './cutstrip.js';

// ══════════════════════════════════════════════════════════════════════════════
// MANUFACTURING INSTRUCTIONS — how the assembly is built
// ══════════════════════════════════════════════════════════════════════════════
// The Cut & Strip screen answers one question: what do I cut, and where do I
// strip it. Everything else the drawing analysis produces — the material list,
// the order of operations, the inspection checks, the tooling — is how the
// thing is BUILT, which is a different document read by a different person at
// a different bench. It used to be printed on the same eleven pages, and the
// two numbers that mattered were lost in it.
//
// So it lives here, as documents of its own. A document can be written from
// scratch, or seeded from a cut & strip specification with one click ("Send to
// Manufacturing Instructions"), after which the two are independent: editing
// the instruction never rewrites the cutting form, and re-analysing a drawing
// never overwrites instructions somebody has since corrected by hand.
//
// Storage note: these share the cut_strip_specs collection, marked kind:'mfg'
// and with an id prefixed mfg_. That is deliberate — it is the one collection
// whose security rule already grants exactly the access these need, so the
// screen works without a rules deployment. Every query on either side filters
// on `kind`.
export const MFG_PREFIX='mfg_';
export function _mfgIsDoc(d){ return !!d && d.kind==='mfg'; }
export function _mfgBlank(){
  return {kind:'mfg', title:'', doc_no:'', revision:'', customer:'', drawing_number:'',
          project:'', form_date:_csToday(), materials:[], steps:[], inspection:[], tools:[],
          notes:'', prepared_by:'', approved_by:''};
}
// Seeded from a cut & strip spec. Copies, never references: an instruction
// document that changed under the operator because an engineer re-ran the
// analysis is worse than no document.
export function _mfgFromSpec(spec){
  const d=_mfgBlank();
  d.title=spec.drawing_name||spec.title||spec.drawing_number||'';
  d.doc_no='MI-'+String(spec.drawing_number||'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-01';
  d.revision=spec.revision||'';
  d.customer=spec.customer||spec.project||'';
  d.drawing_number=spec.drawing_number||'';
  d.project=spec.project||'';
  d.materials=(spec.materials||[]).map(m=>({item:m.item??'', part_number:m.part_number||'',
    manufacturer:m.manufacturer||'', description:m.description||'', qty:m.qty??'', ref:m.ref||''}));
  d.steps=(spec.steps||[]).map((s,i)=>({n:s.n??(i+1), title:s.title||'', body:s.body||'', critical:s.critical||''}));
  d.inspection=(spec.inspection||[]).map(c=>String(c||''));
  d.tools=(spec.tools||[]).map(t=>({tool:t.tool||'', setting:t.setting||'', note:t.note||''}));
  d.source_spec=spec._id||'';
  d.standard=spec.standard||'';
  return d;
}

export function _mfgDocId(d){
  const stem=String(d.doc_no||d.drawing_number||d.title||'doc')
    .replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'doc';
  return MFG_PREFIX+stem.toUpperCase();
}
