import { _aiFetch } from './client.js';

export async function _csTranslateChunk(todo, lang, bucket){
  const langName = lang==='ru' ? 'Russian' : (lang==='he' ? 'Hebrew' : 'English');
  const prompt=`Translate each of these cable-harness shop-floor work instruction strings into ${langName}.\n`
    +'Rules:\n'
    +'- Keep part numbers, standards (IPC/WHMA-A-620, MIL-DTL-17), reference designators (P1, J1), dimension codes (A, B, C) and all units EXACTLY as they are.\n'
    +'- Keep numbers and their units unchanged (e.g. "320 mm" stays "320 mm").\n'
    +'- Technical terms a technician normally says in English (crimp, PTFE, VSWR, PCB) may stay in English.\n'
    +'- These are safety-relevant instructions. Translate precisely; do not soften, shorten or embellish.\n'
    +'- Return ONLY a JSON array of the translated strings, same order, same length. No commentary.\n\n'
    +JSON.stringify(todo, null, 0);

  const resp=await _aiFetch({
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:16000,temperature:0,
                         messages:[{role:'user',content:prompt}]})
  });
  if(!resp.ok){ let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json(); m=e.error?.message||m;}catch{} throw new Error(m); }
  const raw=(await resp.json()).content[0].text;
  const m=String(raw).match(/\[[\s\S]*\]/);
  if(!m) throw new Error('Translation came back in an unexpected format');
  const arr=JSON.parse(m[0]);
  // A length mismatch means the lines no longer line up with their originals.
  // Caching by position would then attach the wrong translation to the wrong
  // instruction — on a work instruction that is a safety problem, not a
  // cosmetic one, so refuse the whole batch.
  if(!Array.isArray(arr) || arr.length!==todo.length)
    throw new Error(`Translation returned ${Array.isArray(arr)?arr.length:'?'} lines for ${todo.length} strings`);
  todo.forEach((t,i)=>{ const v=String(arr[i]||'').trim(); if(v) bucket[t]=v; });
  return true;
}

// Manufacturing-operation sentences (the labor breakdown) into Hebrew or
// Russian. Returns the translated strings in the same order; the caller
// checks the count and caches them.
export async function aiTranslateOperations(todo, lang){
  const langName = lang==='ru' ? 'Russian' : 'Hebrew';
  const prompt=`Translate each of these manufacturing operation descriptions from English to ${langName}.\n`
    +'These are cable/harness assembly steps. Rules:\n'
    +'- Keep part numbers, standards and units exactly as they are (do NOT translate or transliterate them).\n'
    +'- Technical terms engineers normally say in English (e.g. SMT, PCB, IDC, crimp) may stay in English.\n'
    +'- Return ONLY a JSON array of the translated strings, same order, same length. No commentary.\n\n'
    +JSON.stringify(todo, null, 0);

  const resp=await _aiFetch({
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:2048,
                         messages:[{role:'user',content:prompt}]})
  });
  if(!resp.ok){ let m=`Anthropic error ${resp.status}`;
    try{const e=await resp.json(); m=e.error?.message||m;}catch{} throw new Error(m); }
  const raw=(await resp.json()).content[0].text;
  const m=String(raw).match(/\[[\s\S]*\]/);
  if(!m) throw new Error('Translation came back in an unexpected format');
  const arr=JSON.parse(m[0]);
  return arr;
}
