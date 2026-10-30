import { _aiFetch, _aiReady } from './client.js';
import { logSystemAudit } from '../core/audit.js';

// ── Sales Desk only: AI cable-manufacturing-process analysis ─────────────────
// Given the SAME drawing content already used for BOM extraction, ask the AI
// to work out the actual manufacturing steps needed to build this cable
// assembly (cut/strip, crimp, insert, heat-shrink, label, test, etc.) and the
// time each step takes — assuming SERIES/BATCH production (steady-state per-
// unit time, not one-off setup time). Each step is attributed to whichever
// extracted BOM row it belongs to (by index) so its time can be dropped
// straight into that row's Labor Time; steps that aren't tied to one specific
// part (general assembly/inspection) come back with row_idx:null. A separate,
// higher single_unit_minutes figure is also returned purely as a reference
// ("what would ONE stand-alone cable take, with no batch efficiency").
// hasDrawing=false is the "Add from Database" path: there is no drawing, only
// the chosen parts. It gets its OWN prompt rather than a reworded version of
// this one — see _partsOnlyProcessPrompt for why that matters.
export function _cableProcessPrompt(rowsList, hasDrawing=true){
  if(!hasDrawing) return _partsOnlyProcessPrompt(rowsList);
  return `You are a cable/wire-harness manufacturing process engineer. Look at this cable assembly drawing and work out the manufacturing steps required to build it, with the time (in minutes) each step takes.

IMPORTANT: Assume SERIES/BATCH production — this is one of many identical units in an ongoing production run, so use realistic steady-state per-unit time (do NOT include one-off first-article setup/changeover time in these step times).

The assembly's BOM rows are (index: description (qty unit)):
${rowsList}

For each manufacturing step (e.g. cut/strip the cable, crimp pins into a connector, insert contacts into a housing, heat-shrink a boot or tubing, apply a label, solder, twist/braid, final test/inspection, etc.), return:
- "operation": short description of the step
- "row_idx": the index (from the BOM list above) of the row this step's labor belongs to — or null if it's a general assembly/test step not tied to one specific part
- "unit_minutes": time in minutes for ONE SINGLE OCCURRENCE of this step (a plain number) — e.g. the time to crimp exactly ONE contact, strip exactly ONE wire, apply exactly ONE label. Always the time for one repetition, never a pre-multiplied total.
- "qty_in_drawing": how many times this exact operation must be repeated to build ONE complete assembly, READ DIRECTLY FROM THE DRAWING (e.g. count the actual pins/contacts/wires shown, not the BOM row's own quantity field, which may describe something else entirely — a connector housing row might have BOM qty=1 while its pins are crimped 20 times). Use 1 for a step that happens exactly once regardless of any part count (e.g. one cable is cut once even though its length is 230mm, one housing is assembled once, one final inspection). For row_idx:null (general) steps this is almost always 1.

CRITICAL: unit_minutes and qty_in_drawing must be reported SEPARATELY and never combined into one number — the app computes unit_minutes × qty_in_drawing itself.

Also return:
- "single_unit_minutes": a reference estimate (in total, already accounting for every repeat operation like crimping every contact) for building just ONE stand-alone cable with no batch efficiency (includes setup/changeover overhead a series run wouldn't need) — for comparison only.

Return ONLY valid JSON, no explanation, in exactly this shape:
{"steps":[{"operation":"Strip and cut main cable","unit_minutes":2,"qty_in_drawing":1,"row_idx":0},{"operation":"Crimp one contact","unit_minutes":0.15,"qty_in_drawing":20,"row_idx":1}],"single_unit_minutes":15}

If you can't confidently determine any steps from this drawing, return {"steps":[],"single_unit_minutes":0}`;
}
// Throws (rather than returning null) when the reply can't be read, so the
// caller can tell three very different situations apart:
//   • the model answered "no steps"          → proc.steps.length === 0
//   • the model's answer was unreadable      → throws, provider falls back
//   • the request itself failed              → throws with the HTTP error
// Returning null for all three is what made "no manufacturing steps" the
// catch-all message for problems that had nothing to do with the parts.
// Asking the drawing prompt to work without a drawing is what produced
// "the AI returned no manufacturing steps". That prompt opens with "look at
// this cable assembly drawing", tells the model to count pins off it, and ends
// with an explicit "if you can't tell, return an empty list". Given a parts
// list and no drawing — and a BOM that is an RF/PCB assembly rather than a
// classic wire harness — returning nothing was the model following instructions.
//
// This version never mentions a drawing, isn't limited to cable harnesses,
// states that every physical part carries assembly time, and makes an empty
// answer the wrong one rather than the safe one.
export function _partsOnlyProcessPrompt(rowsList){
  return `You are a manufacturing process engineer estimating assembly labor for an electro-mechanical build — a cable harness, wire assembly, connector/PCB assembly, or any mix of these.

You are given the BOM below. There is NO drawing. Estimate the manufacturing steps needed to build ONE complete assembly from these parts, and how long each step takes.

IMPORTANT: Assume SERIES/BATCH production — one of many identical units in an ongoing run — so use realistic steady-state per-unit times and exclude one-off first-article setup.

BOM rows (index: description (qty unit)):
${rowsList}

Every physical part in a BOM takes SOME labor to handle, position, join and verify. Typical steps: cut and strip wire or cable, crimp a contact, insert contacts into a housing, mate and lock connectors, solder a through-hole or SMT joint, place a PCB component, fit a boot or heat-shrink, apply a label or marker, dress and tie a bundle, torque a fastener, apply conformal coating, continuity or electrical test, final visual inspection.

For each step return:
- "operation": short description of the step
- "row_idx": index (from the list above) of the row this step's labor belongs to — or null for a general assembly/test/inspection step not tied to one part
- "unit_minutes": minutes for ONE SINGLE OCCURRENCE (e.g. crimping exactly ONE contact, soldering exactly ONE joint). Never a pre-multiplied total.
- "qty_in_drawing": how many times that operation repeats to build ONE assembly. With no drawing, base this on the row's own quantity and on what the description states — "SOCKET RECTANG 26 F" implies 26 contacts, "RECEPT RECT 40 C" implies 40 positions. If the description gives no count, use the row's quantity, or 1. Do not invent counts the BOM does not support.

CRITICAL: unit_minutes and qty_in_drawing must be SEPARATE numbers — the app multiplies them itself. Never combine them into one figure.

Also return:
- "single_unit_minutes": total reference time to build ONE stand-alone unit including the setup overhead a batch run would not pay per unit — for comparison only.

Return ONLY valid JSON, no explanation, in exactly this shape:
{"steps":[{"operation":"Solder one SMT receptacle to PCB","unit_minutes":0.4,"qty_in_drawing":40,"row_idx":0},{"operation":"Cut and dress flat cable","unit_minutes":2,"qty_in_drawing":1,"row_idx":1},{"operation":"Final visual inspection","unit_minutes":3,"qty_in_drawing":1,"row_idx":null}],"single_unit_minutes":25}

An empty "steps" list is almost never correct: a BOM of real parts always requires assembly labor, and a rough estimate is far more useful than none. Return an empty list ONLY if the BOM contains no physical parts at all (documents or specifications only).`;
}

export function _parseCableProcessJson(raw){
  const text=String(raw||'').trim();
  if(!text) throw new Error('The AI returned an empty response');
  const m=text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('No JSON in the AI response: '+text.slice(0,140));
  let obj;
  try{ obj=JSON.parse(m[0]); }
  catch(e){ throw new Error('Malformed JSON from the AI: '+m[0].slice(0,140)); }
  if(!obj || !Array.isArray(obj.steps)){
    throw new Error('AI response had no "steps" array: '+m[0].slice(0,140));
  }
  return obj;
}
export async function _anthropicCableProcess(text, isImage, imgData, rowsList, hasDrawing=true){
  const prompt=_cableProcessPrompt(rowsList, hasDrawing);
  const messages = isImage ? [{role:'user',content:[
    {type:'image',source:{type:'base64',media_type:imgData.mimeType,data:imgData.b64}},
    {type:'text',text:prompt}
  ]}] : [{role:'user', content: prompt + (hasDrawing ? '\n\nDRAWING TEXT:\n'+String(text||'').slice(0,20000) : '')}];
  const resp = await _aiFetch({
    // temperature 0. Anthropic defaults to 1.0, i.e. maximum sampling
    // variability — which is why pressing Estimate Labor twice produced
    // materially different minutes for the same parts. Estimating assembly
    // time is not a creative task: the same BOM should give the same answer,
    // and a number that moves every time it's asked can't be trusted or
    // checked. It won't be bit-identical (no LLM guarantees that), but the
    // spread drops from "significantly different" to noise.
    body:JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:2048, temperature:0, messages})
  });
  if(!resp.ok){let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json();m=e.error?.message||m;}catch{}throw new Error(m);}
  const data=await resp.json();
  return _parseCableProcessJson(data.content[0].text.trim());
}
export async function aiAnalyzeCableProcess(text, isImage, imgData, rowsList, hasDrawing=true){
  if(!rowsList || !_aiReady()) return null;
  const _t0=Date.now();
  let proc;
  try { proc=await _anthropicCableProcess(text, isImage, imgData, rowsList, hasDrawing); }
  catch(e){
    console.warn('Cable-process analysis failed:', e.message);
    logSystemAudit('drawing_price_calculation',{error:e.message,ms:Date.now()-_t0},false);
    throw e;
  }
  if(!proc) return null;
  logSystemAudit('drawing_price_calculation',{provider:'anthropic',stepsFound:proc?.steps?.length||0,ms:Date.now()-_t0},true);
  return proc;
}

// ── Sales Desk only: NOTES / MANUFACTURING INSTRUCTIONS extraction ───────────
// Given the same drawing content already used for BOM extraction, ask the AI
// whether the drawing has a separate NOTES / GENERAL NOTES / MANUFACTURING
// INSTRUCTIONS block (distinct from the BOM/parts-list table) and, if so,
// return each note/instruction line as its own array entry. Shown below the
// BOM table in Sales Desk (see _sdRenderNotesPanel) — lines that reference a
// document or standard (spec/dwg/MIL-/IPC/ASTM/etc., see _NOTE_DOC_STD_RE)
// are highlighted red there since those often carry hidden cost/compliance
// requirements the quote should account for.
export function _notesPrompt(){
  return `Look at this engineering/manufacturing drawing. Find any NOTES, GENERAL NOTES, or MANUFACTURING INSTRUCTIONS text or table on it — this is separate from the BOM / parts-list table.

Return each distinct note or instruction as its own entry, exactly as written on the drawing (keep its original numbering/lettering if present, e.g. "1. ...", "A. ..."). If the drawing has no such notes/instructions section, return an empty array.

Return ONLY valid JSON, no explanation, in exactly this shape: {"notes":["1. ALL DIMENSIONS IN MM UNLESS OTHERWISE SPECIFIED","2. CRIMP PER IPC/WHMA-A-620","3. MARK PART NUMBER PER MIL-STD-130"]}
If none found: {"notes":[]}`;
}
export function _parseNotesJson(raw){
  const m=String(raw||'').match(/\{[\s\S]*\}/);
  if(!m) return [];
  try{
    const obj=JSON.parse(m[0]);
    if(!obj||!Array.isArray(obj.notes)) return [];
    return obj.notes.map(n=>String(n||'').trim()).filter(Boolean);
  }catch{ return []; }
}
export async function _anthropicNotes(text, isImage, imgData){
  const prompt=_notesPrompt();
  const messages = isImage ? [{role:'user',content:[
    {type:'image',source:{type:'base64',media_type:imgData.mimeType,data:imgData.b64}},
    {type:'text',text:prompt}
  ]}] : [{role:'user', content: prompt+'\n\nDRAWING TEXT:\n'+String(text||'').slice(0,20000)}];
  const resp = await _aiFetch({
    body:JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:1536, messages})
  });
  if(!resp.ok){let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json();m=e.error?.message||m;}catch{}throw new Error(m);}
  const data=await resp.json();
  return _parseNotesJson(data.content[0].text.trim());
}
export async function aiExtractDrawingNotes(text, isImage, imgData){
  if(!_aiReady()) return [];
  let notes;
  try { notes=await _anthropicNotes(text, isImage, imgData); }
  catch(e){ console.warn('Notes extraction failed:', e.message); logSystemAudit('drawing_notes_search',{error:e.message},false); return []; }
  if(notes===undefined) return [];
  logSystemAudit('drawing_notes_search',{provider:'anthropic',notesFound:notes.length},true);
  return notes;
}
// Broad match for "this note references a document or standard" — spec/dwg/
// procedure keywords plus common standard-body prefixes (MIL-, IPC, ASTM,
// ANSI, ISO, NASM, AS9100-style, SAE, J-STD, QQ-, MS-part-number style).
export const _NOTE_DOC_STD_RE=/\b(spec(?:ification)?s?|standards?|std\.?|dwg\.?|drawing|document|doc\.?|procedures?|proc\.?|per\s+(?:mil|astm|ipc|ansi|iso|as|ms|nas|sae|j-?std|qq)|mil-[a-z]?-?\d|ipc[\/-]|astm|ansi|iso\s*\d|nasm\d|as\d{3,4}|j-?std|qq-|ms\d{4,5}|sae\s*[a-z]*\d)\b/i;
