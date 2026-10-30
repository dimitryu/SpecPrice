import { _AI_NO_KEY, _aiFetch, _aiReady, _csProviderHint, _csSalvageJson } from './client.js';
import { _CS_ANALYSIS_TIMEOUT } from './cutstrip.js';
import { _csConnectors, _csCutLength, _csMM, _csNum, _csSegLabel, _csSegments } from '../domain/cutstrip.js';
import { _CS_SOURCE_LANG } from '../features/cutstrip/i18n.js';

// ── The build sequence, written separately ──────────────────────────────────
// The drawing analysis used to be asked for the cut, the strip, the wiring
// table AND the whole assembly sequence in one reply. That is what kept
// running the answer out of room: the sequence is the longest part of it by
// far, and it was crowding out the dimensions the cutting form exists for —
// so the operator lost the two numbers that mattered in order to gain prose
// that belongs on a different sheet entirely.
//
// So it is written here instead, in its own small request, from the finished
// specification rather than from the drawing. The specification is a few
// hundred characters of structured fact, the answer is a short list, and
// neither end can overflow. It also means re-writing the sequence never risks
// the dimensions: they are already saved.
export function _mfgSpecDigest(spec){
  const seg=(_csSegments(spec)||[]).map(s=>{
    const cut=_csCutLength(s, spec);
    return `${s.id||'S'}: ${_csSegLabel(s)}, cut ${_csMM(cut.total)}`;
  });
  const con=(_csConnectors(spec)||[]).map(c=>
    `${c.ref||''} ${c.part_number||''} ${c.type||''} ${c.termination||''}`.trim());
  const strip=(_csSegments(spec)||[]).flatMap(s=>(s.ends||[]).flatMap(e=>
    (e.strip||[]).filter(x=>_csNum(x.value_mm)!=null)
      .map(x=>`${s.id||'S'}/${e.ref||''} ${x.code||''}=${x.value_mm} mm`)));
  const mat=(spec.materials||[]).map(m=>
    `${m.item??''} ${m.part_number||''} ${m.description||''} qty ${m.qty??''} ${m.unit||''}`.trim());
  const notes=(spec.engineering_notes||[]).map(n=>String(n.text||n||'')).filter(Boolean);
  return [
    `HARNESS ${spec.drawing_number||''} ${spec.drawing_name||''} rev ${spec.revision||''}`,
    spec.standard ? `STANDARD ${spec.standard}` : '',
    seg.length    ? 'RUNS\n'+seg.join('\n') : '',
    con.length    ? 'CONNECTORS\n'+con.join('\n') : '',
    strip.length  ? 'STRIP\n'+strip.join('\n') : '',
    mat.length    ? 'BOM\n'+mat.slice(0,40).join('\n') : '',
    notes.length  ? 'DRAWING NOTES\n'+notes.slice(0,12).join('\n') : '',
  ].filter(Boolean).join('\n\n').slice(0, 6000);
}
export const _MFG_STEPS_MAX_TOKENS=6000;
export async function _mfgWriteSteps(spec, lang){
  if(!_aiReady()) throw new Error(_AI_NO_KEY);
  const langName=({he:'Hebrew', ru:'Russian', en:'English'})[lang||spec.lang||_CS_SOURCE_LANG]||'Hebrew';
  const prompt=`You are a manufacturing engineer writing the assembly instruction for a wire harness that
has ALREADY been analysed. The cut lengths, strip dimensions and wiring are settled and are given to
you below — do not recalculate them, do not contradict them, and do not repeat the whole dimension
list back. Write only how the thing is BUILT.

Return ONE JSON object and nothing else. Minified: no indentation, no line breaks between fields.
{"steps":[{"n":1,"title":"short imperative title","body":"what to do, one or two sentences an operator can follow","critical":"the one thing that ruins the part if they get it wrong, or omit the key"}],
 "inspection":["one check per line, phrased so it can be ticked off"],
 "tools":[{"tool":"","setting":"","note":""}]}

Limits, and they are limits, not targets: at most 12 steps, at most 8 inspection lines, at most 8
tools, every string at most 160 characters. Omit a key rather than writing an empty string.

The first step is always the cut, and it states the cut length. Then strip, then terminate, then
assemble, then mark, then test. A drawing note that tells the operator to DO something becomes a step
at the point in the sequence where it happens; one that says what to CHECK becomes an inspection line.

Write every human-readable value in ${langName}. Part numbers, connector references, standards and
units stay in their Latin form. Never type a double quote inside a value: in Hebrew write the
gershayim \u05F4 instead.

SPECIFICATION:
${_mfgSpecDigest(spec)}`;
  const resp=await _aiFetch({
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:_MFG_STEPS_MAX_TOKENS,
                         temperature:0,messages:[{role:'user',content:prompt}]})
  }, _CS_ANALYSIS_TIMEOUT);
  if(!resp.ok){ let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json();m=e.error?.message||m;}catch{}
    throw new Error(_csProviderHint('Anthropic', m)); }
  const d=await resp.json();
  const raw=(d.content&&d.content[0]&&d.content[0].text)||'';
  const obj=_csSalvageJson(raw) || {};
  return {
    steps: (Array.isArray(obj.steps)?obj.steps:[]).map((x,i)=>({n:x.n??(i+1),
      title:String(x.title||''), body:String(x.body||''), critical:String(x.critical||'')})),
    inspection: (Array.isArray(obj.inspection)?obj.inspection:[]).map(x=>String(x||'')).filter(Boolean),
    tools: (Array.isArray(obj.tools)?obj.tools:[]).map(x=>({tool:String(x.tool||''),
      setting:String(x.setting||''), note:String(x.note||'')})).filter(t=>t.tool),
  };
}
