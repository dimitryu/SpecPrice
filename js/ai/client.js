import { S } from '../core/state.js';
import { auth } from '../core/firebase.js';

// Anthropic is the only AI provider. A Gemini fallback used to sit behind every
// call; it was removed because keeping two providers meant every prompt change
// had to be verified twice, and the second path was rarely exercised — a
// fallback nobody tests is not a safety net. The trade-off is deliberate and
// worth stating: if this key stops working, every AI feature stops with it.
export const _AI_NO_KEY='No AI key configured — an admin can add the Anthropic key in Admin → AI API Keys';

// ── Where a Claude request goes ──────────────────────────────────────────────
// Through the aiProxy Cloud Function whenever the key is stored on the server:
// the browser sends the same request body with its Firebase sign-in token, and
// the function adds the key. The key is then never in any browser — not in
// localStorage, not in the company document, not in devtools.
//
// Straight to Anthropic with a browser key only while the server has none
// (before the function is deployed, or before an admin moves the key there),
// so nothing stops working during the switch.
export const AI_DIRECT_URL='https://api.anthropic.com/v1/messages';
export const AI_PROXY_URL='https://us-central1-specprice-236a2.cloudfunctions.net/aiProxy';

// Is there any way to reach the model right now? The checks that used to read
// "is there a key" ask this instead.
export function _aiReady(){ return !!(S.aiProxy || S.anthKey); }

// Remembered across reloads so the very first request after login already
// takes the right road, without waiting for the server to answer.
export function _aiSetProxy(on){
  S.aiProxy=!!on;
  try{
    if(on){
      localStorage.setItem('ai_proxy','1');
      // The server has the key, so the browser copy is only a liability.
      S.anthKey=''; localStorage.removeItem('anth_key');
    } else localStorage.removeItem('ai_proxy');
  }catch(e){}
}

// Asks the function whether the key is configured there. Run once after login,
// without blocking it. When the function cannot be reached (not deployed yet,
// offline) the last known answer stands.
export async function aiProbeProxy(){
  try{
    if(!auth.currentUser) return S.aiProxy;
    const token=await auth.currentUser.getIdToken();
    const resp=await fetch(AI_PROXY_URL,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(!resp.ok) return S.aiProxy;
    const j=await resp.json();
    _aiSetProxy(!!(j && j.configured));
  }catch(e){ /* keep the last known road */ }
  return S.aiProxy;
}

// One Claude Messages request. `opts.body` is the JSON string; the answer is a
// normal fetch Response either way — same status codes, same JSON, same error
// shape — so the code reading it does not know or care which road it took.
export async function _aiFetch(opts, timeoutMs){
  if(S.aiProxy && auth.currentUser){
    const token=await auth.currentUser.getIdToken();
    return _fetchWithRetry(AI_PROXY_URL,{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
      body:opts.body
    }, timeoutMs);
  }
  return _fetchWithRetry(AI_DIRECT_URL,{
    method:'POST',
    headers:{'x-api-key':S.anthKey,'anthropic-version':'2023-06-01',
             'anthropic-dangerous-direct-browser-access':'true','content-type':'application/json'},
    body:opts.body
  }, timeoutMs);
}

export let _dbgLastAI='';
export function _parseAIJson(raw){
  _dbgLastAI=raw;
  const m=raw.match(/\[[\s\S]*\]/);
  if(!m){console.warn('[AI] no JSON array. Raw:',raw.slice(0,300));return[];}
  try{return JSON.parse(m[0]);}
  catch(e){console.warn('[AI] parse error:',e.message,'at:',m[0].slice(0,200));return[];}
}

// Retries a fetch() once after a short delay if it fails at the network
// level (a TypeError — connection refused, CORS block, DNS failure, offline)
// rather than coming back with a normal HTTP response. That kind of failure
// surfaces to the user as an unhelpful generic "Failed to fetch" with no
// status code at all, and is often just a transient blip — a single retry
// resolves most of them. Deliberately does NOT retry on a real HTTP error
// response (4xx/5xx): those are genuine API errors (bad key, rate limit,
// oversized request) that a retry wouldn't fix.
export async function _fetchWithRetry(url, opts, timeoutMs){
  // A timeout turns an indefinite hang (e.g. a large image upload stalling on a
  // slow connection) into a clear, bounded failure instead of the tab just
  // spinning forever — and it's a DIFFERENT error class (AbortError) from the
  // network-level TypeError this function otherwise retries, so the two failure
  // modes stay distinguishable in the message shown to the user.
  //
  // The budget is per-call because the calls are not comparable. Extracting a
  // BOM is a short request; asking for a full cut & strip specification means
  // reading a whole drawing AND generating several thousand tokens of
  // structured JSON, which legitimately takes longer than a minute on a big
  // sheet. A single shared 60s ceiling failed that work as if it had hung,
  // when it was simply still going.
  const ms = timeoutMs || 60000;
  const secs = Math.round(ms/1000);
  const withTimeout = (o)=>({...o, signal:o.signal||AbortSignal.timeout(ms)});
  const timedOut = ()=> new Error(
    `The AI provider did not finish within ${secs}s. The drawing may be very dense, or the connection slow — try again, or use a sharper/simpler drawing file.`);
  try{ return await fetch(url, withTimeout(opts)); }
  catch(e){
    if(e && e.name==='TimeoutError') throw timedOut();
    if(!(e instanceof TypeError)) throw e;
    await new Promise(res=>setTimeout(res,1200));
    try{ return await fetch(url, withTimeout(opts)); }
    catch(e2){
      if(e2 && e2.name==='TimeoutError') throw timedOut();
      throw new Error(`Network error reaching the AI provider — check your internet connection and try again. (${e2.message})`);
    }
  }
}

// Provider errors are quoted verbatim, but a few of them have a specific fix
// the user would otherwise have to go and look up.
export function _csProviderHint(provider, msg){
  const m=String(msg||'');
  if(/service account is deleted or disabled|API key not valid|API_KEY_INVALID/i.test(m))
    return `${provider} rejected the key: ${m} → the key needs to be re-issued in Admin → AI API Keys.`;
  if(/quota|rate limit|429|insufficient|credit balance/i.test(m))
    return `${provider} is out of quota or credit: ${m} → check the account's billing, or use the other provider.`;
  return m;
}
export function _csTryParse(t){
  try{ const o=JSON.parse(t); return (o && typeof o==='object') ? o : null; }
  catch(e){ return null; }
}
// Raw control characters inside a string, and commas before a closing bracket,
// are the two things a model gets wrong in JSON that a reader would not even
// notice. Neither changes the meaning, so both are simply corrected.
// Hebrew writes abbreviations with a double quote INSIDE the word — מק"ט,
// מ"מ, ס"מ. A model writing Hebrew into JSON reaches for that character
// naturally and breaks the string it is in, which is why Hebrew analyses
// failed where the same drawing in English did not. A quote with a Hebrew
// letter on both sides is a gershayim, never a delimiter, so it is replaced
// with the real one (U+05F4) — the text reads identically and the JSON parses.
export const _CS_GERSHAYIM=/([\u0590-\u05FF])"([\u0590-\u05FF])/g;
export function _csFixHebrewQuotes(t){
  let out=String(t||''), prev;
  // twice: "מק"ט" style words can chain, and one pass consumes the neighbours
  do{ prev=out; out=out.replace(_CS_GERSHAYIM,'$1\u05F4$2'); }while(out!==prev);
  return out;
}
export function _csSanitizeJson(t){
  let out='', inStr=false, esc=false;
  for(const ch of _csFixHebrewQuotes(t)){
    if(esc){ out+=ch; esc=false; continue; }
    if(ch==='\\'){ out+=ch; esc=true; continue; }
    if(ch==='"'){ inStr=!inStr; out+=ch; continue; }
    if(inStr){
      if(ch==='\n'){ out+='\\n'; continue; }
      if(ch==='\r'){ out+='\\r'; continue; }
      if(ch==='\t'){ out+='\\t'; continue; }
      if(ch.charCodeAt(0)<0x20){ out+=' '; continue; }
    }
    out+=ch;
  }
  return out.replace(/,(\s*[}\]])/g,'$1');
}
// The general case of the same problem: a quote inside a value that the model
// did not escape — a quoted phrase in a note, a Hebrew abbreviation the
// gershayim rule did not catch, an inch mark. A quote only ENDS a string when
// the next thing after it is one of the characters that can legally follow a
// string: a comma, a colon, or a closing bracket. Any other quote is content,
// and is escaped rather than obeyed.
//
// This is the aggressive repair, so it runs only after the gentle ones have
// failed, and its result still has to parse before it is used.
export function _csEscapeStrayQuotes(t){
  const src=String(t||'');
  let out='', inStr=false, esc=false;
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(esc){ out+=ch; esc=false; continue; }
    if(ch==='\\'){ out+=ch; esc=true; continue; }
    if(ch!=='"'){ out+=ch; continue; }
    if(!inStr){ inStr=true; out+=ch; continue; }
    let k=i+1;
    while(k<src.length && /\s/.test(src[k])) k++;
    const next=src[k];
    let closes = k>=src.length || next===':' || next==='}' || next===']';
    if(!closes && next===','){
      // A comma only ends a string when what follows it could START the next
      // value or key. `"he said "hi", then left"` fails that test — "then" is
      // not a JSON token — so the quote before it is content, which is exactly
      // how a person reads it.
      let j=k+1;
      while(j<src.length && /\s/.test(src[j])) j++;
      closes = /["{[\-0-9]/.test(src[j]||'') || /^(true|false|null)\b/.test(src.slice(j,j+5));
    }
    if(closes){ inStr=false; out+=ch; }
    else out+='\\"';                      // content, not a delimiter
  }
  return out;
}
// Closes whatever is still open, after tidying the cut edge: a trailing comma
// closes nothing, and a key whose value never arrived cannot be closed either.
export function _csCloseJson(head){
  let t=String(head||'')
    .replace(/,\s*$/,'')
    .replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/,'')
    .replace(/,\s*$/,'');
  const need=[];
  let inStr=false, esc=false;
  for(const ch of t){
    if(esc){ esc=false; continue; }
    if(ch==='\\'){ esc=true; continue; }
    if(inStr){ if(ch==='"') inStr=false; continue; }
    if(ch==='"'){ inStr=true; continue; }
    if(ch==='{') need.push('}');
    else if(ch==='[') need.push(']');
    else if(ch==='}'||ch===']') need.pop();
  }
  if(inStr) t+='"';
  return t+need.reverse().join('');
}
export function _csRepairJson(raw){
  const t=String(raw||'');
  const start=t.indexOf('{');
  return start<0 ? '' : _csCloseJson(t.slice(start));
}
// Everything above, in the order that loses the least: parse it, correct the
// harmless mistakes, and only then start cutting the tail off — closing bracket
// by closing bracket, newest first, until what is left parses.
export const _CS_SALVAGE_TRIES=300;
export function _csSalvageJson(raw){
  const whole=String(raw||'');
  const start=whole.indexOf('{');
  if(start<0) return null;
  const t=whole.slice(start);

  let obj=_csTryParse(t);
  if(obj) return {obj, partial:false};

  obj=_csTryParse(_csFixHebrewQuotes(t));
  if(obj) return {obj, partial:false};

  const clean=_csSanitizeJson(t);
  obj=_csTryParse(clean);
  if(obj) return {obj, partial:false};

  obj=_csTryParse(_csCloseJson(clean));
  if(obj) return {obj, partial:true};

  const escaped=_csEscapeStrayQuotes(clean);
  obj=_csTryParse(escaped) || _csTryParse(_csCloseJson(escaped));
  if(obj) return {obj, partial:escaped!==clean};

  // Bracket positions outside strings, so a "}" inside a note is never a cut.
  const base=escaped;
  const stops=[];
  let inStr=false, esc=false;
  for(let i=0;i<base.length;i++){
    const ch=base[i];
    if(esc){ esc=false; continue; }
    if(ch==='\\'){ esc=true; continue; }
    if(inStr){ if(ch==='"') inStr=false; continue; }
    if(ch==='"'){ inStr=true; continue; }
    if(ch==='}'||ch===']') stops.push(i);
  }
  for(let k=stops.length-1, n=0; k>=0 && n<_CS_SALVAGE_TRIES; k--, n++){
    obj=_csTryParse(_csCloseJson(base.slice(0, stops[k]+1)));
    if(obj) return {obj, partial:true};
  }
  return null;
}

// Which model reads the drawing. This is the one task in the app where the
// model's eye matters more than its price: a drawing is a picture of a cable
// with a dimension chain, labels, a pinout and a part list, and the small
// model kept reading the chain as separate cables and the labels as
// connectors. The larger model reads it as one cable, which is what it is.
// If the account cannot use it, the small one takes over for the session.
export const _CS_MODEL='claude-sonnet-5', _CS_MODEL_FALLBACK='claude-haiku-4-5-20251001';
export function _csModel(){ return S._csModelDown ? _CS_MODEL_FALLBACK : _CS_MODEL; }
export function _csModelRejected(status, msg){
  if(S._csModelDown) return false;
  if(!(status===400 || status===403 || status===404)) return false;
  return /model|not[_ ]found|not available|does not have access|permission|temperature/i.test(String(msg||''));
}
// A model writing a long structured answer at temperature 0 can fall into a
// repetition loop — the same row, over and over, until the reply fills up.
// Continuing such a reply just buys another window of the same thing, so the
// loop is spotted and the answer is taken as it stands.
export const _CS_LOOP_TAIL=240, _CS_LOOP_HITS=3;
export function _csLoopy(text){
  const t=String(text||'');
  if(t.length<_CS_LOOP_TAIL*_CS_LOOP_HITS) return false;
  const tail=t.slice(-_CS_LOOP_TAIL);
  let n=0, i=0;
  while((i=t.indexOf(tail,i))!==-1){ n++; i+=_CS_LOOP_TAIL; if(n>=_CS_LOOP_HITS) return true; }
  // The exact-tail test above only catches a stutter that repeats on a clean
  // boundary. A model going round the same table with one field changing each
  // time slips past it, and that is the shape that was eating whole windows —
  // so the end of the answer is also checked for a short phrase that keeps
  // coming back within it.
  const tl=t.slice(-_CS_LOOP_WINDOW);
  if(tl.length>=_CS_LOOP_WINDOW){
    const probe=tl.slice(-_CS_LOOP_PROBE);
    let m=0, j=0;
    while((j=tl.indexOf(probe,j))!==-1){ m++; j+=_CS_LOOP_PROBE; if(m>=_CS_LOOP_PROBE_HITS) return true; }
  }
  return false;
}
export const _CS_LOOP_WINDOW=4000, _CS_LOOP_PROBE=90, _CS_LOOP_PROBE_HITS=5;
// Roughly the largest sensible reading of a harness drawing, in characters.
// Past this the model is padding, not describing: the answer is taken as it
// stands and the salvage closes it, which is a complete sheet minus the tail
// rather than four more minutes ending in the same place.
export const _CS_MAX_REPLY_CHARS=120000;
// Whether the answer has actually finished — every bracket it opened is
// closed, outside of strings. The API says "max_tokens" whenever it hits the
// ceiling, including on the very token after the final brace, so this is what
// distinguishes a finished answer from a truncated one.
export function _csComplete(text){
  const t=String(text||'');
  const a=t.indexOf('{');
  if(a<0) return false;
  let depth=0, inStr=false, esc=false, closed=false;
  for(let i=a;i<t.length;i++){
    const c=t[i];
    if(esc){ esc=false; continue; }
    if(c==='\\'){ esc=true; continue; }
    if(c==='"'){ inStr=!inStr; continue; }
    if(inStr) continue;
    if(c==='{'||c==='[') depth++;
    else if(c==='}'||c===']'){ depth--; if(depth===0){ closed=true; break; } }
  }
  return closed;
}
// The API rejects a prefilled assistant turn that ends in whitespace, and a
// continuation must not repeat the character it stopped on.
export function _csTrimPrefill(t){ return String(t||'').replace(/\s+$/,''); }
export function _csStitch(a, b){ return _csTrimPrefill(a)+String(b||''); }
// A rejected KEY is not a transient failure — it will be rejected identically on
// every subsequent drawing. Retrying it each time just spends a round-trip
// before the fallback, on a screen where the total wait already matters. So a
// credential-class failure parks that provider for the rest of the session;
// anything else (a timeout, a bad response) is treated as transient and retried
// normally. Cleared by a reload, which is also what happens after fixing the key.
export let _csDeadProviders={};
export function _csIsKeyError(msg){
  return /service account is deleted or disabled|API key not valid|API_KEY_INVALID|invalid x-api-key|authentication_error|401|403/i.test(String(msg||''));
}
