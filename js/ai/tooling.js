import { _aiFetch, _aiReady, _csModel, _parseAIJson } from './client.js';
import { logSystemAudit } from '../core/audit.js';
import { _bomBadToolPn } from '../domain/bom.js';

// ══════════════════════════════════════════════════════════════════════════════
// CRIMP TOOLS FOR CONTACTS (pins, sockets, terminals)
// ------------------------------------------------------------------------------
// The tool a cable needs is set by its CONTACTS, and the contact's maker states
// it — in the contact's datasheet or product page ("Application tooling",
// "Tooling", "Crimp tool"). The AI looks it up there with Anthropic's web search
// (one request for all contacts of a drawing), and falls back to what it knows
// when web search is not available. The prices are then looked up at Mouser /
// DigiKey like any part (features/salesDesk/tools.js).
// ══════════════════════════════════════════════════════════════════════════════
export const WEB_SEARCH_TOOL={type:'web_search_20250305', name:'web_search'};
// Opens a page or PDF found by the search — the maker's product page or the
// contact's datasheet, where the tool is actually written.
export const WEB_FETCH_TOOL={type:'web_fetch_20250910', name:'web_fetch', max_content_tokens:40000};
export function _crimpToolPrompt(contacts, web=true, deep=false){
  const list=contacts.map((c,i)=>`${i}: ${c.part_number||''} | ${c.manufacturer||''} | ${c.description||''}`).join('\n');
  return `You are a wire-harness tooling engineer. For each crimp contact below (pin, socket, terminal, ferrule, lug), find the HAND CRIMP TOOL its manufacturer specifies for that exact contact part number.

Contacts (index: manufacturer part number | manufacturer | description):
${list}

How to find it:
${web ? `1. Identify each contact first: the maker (work it out from the number and description when the field is empty), its product FAMILY / series (e.g. Molex 5556 = Mini-Fit Jr. female terminal), its WIRE RANGE (AWG or mm²), and the other ways the number is written (e.g. 39-00-0047 = 0039000047 = 39000047).
2. Search the web (web_search). Do not stop at the contact's own product page — it often has no tooling. Search for:
   a) the maker's APPLICATION TOOLING SPECIFICATION of the hand crimp tool for that family and wire range — e.g. "<maker> <family> <wire range> hand crimp tool application tooling specification";
   b) the contact number (each format) with "crimp tool" / "hand tool" / "application tooling";
   c) distributor pages for the contact (TME, Farnell, Mouser, DigiKey, Digi-Key "associated products", TME "related items") — leads to the tool number.
3. OPEN (web_fetch) the candidate TOOL's specification sheet or datasheet (PDF is fine) and CHECK that this contact's number (any format) appears in its terminal table, with a matching wire size. A tool of the same family for a different wire range is wrong (e.g. an 18-24 AWG tool for a 22-28 AWG contact).${deep ? `
   THIS IS A SECOND, DEEPER SEARCH: a first search found nothing for these contacts. Use more searches, try every number format and the family + wire-range route, and open the makers' tooling specification PDFs.` : ''}` :
`Use what you know of each manufacturer's application tooling documentation: the hand tool for the contact's family and wire range.`}
4. Return the HAND crimp tool (not a bench applicator). If that hand tool needs a separate die, locator or positioner, return it as a second entry. For MIL-spec contacts (M39029/…) return the M22520 crimp frame and its positioner.
5. "confidence": "confirmed" when a page states this tool for this contact — best, the tool's specification lists the contact's number (give that page as source_url); "likely" when no page says so but the maker's hand tool for that contact series and wire size is known to you — never a made-up number. The tool's part number is never the contact's own number, with or without a suffix. Nothing at all only when you have neither.

Reply with a short note if you like, then the result as a JSON array between <tools_json> and </tools_json>:
<tools_json>[{"for_idx":0,"part_number":"<tool P/N>","manufacturer":"<maker>","description":"HAND CRIMP TOOL for <contact series> <wire range>","kind":"crimp","confidence":"confirmed","source_url":"https://<page that names the tool>"}]</tools_json>
"description" must contain the word TOOL and say what it is for; "kind" is crimp, die, locator, positioner or insertion; "source_url" is the page that names the tool ("" if none). [] when nothing was found.`;
}
// The JSON array of a reply that may also hold text, search results and citations.
export function _parseToolsReply(text){
  const s=String(text||'');
  const m=s.match(/<tools_json>([\s\S]*?)<\/tools_json>/i);
  if(m){ try{ const v=JSON.parse(m[1].trim()); return Array.isArray(v)?v:[]; }catch{ return []; } }
  return _parseAIJson(s);
}
export function _cleanCrimpTools(list, contacts){
  const safeUrl=u=>/^https:\/\/[^\s"'<>]+$/i.test(String(u||'').trim()) ? String(u).trim().slice(0,400) : '';
  return (Array.isArray(list)?list:[]).map(t=>({
      for_idx:parseInt(t.for_idx,10), part_number:String(t.part_number||'').trim(),
      manufacturer:String(t.manufacturer||'').trim(), description:String(t.description||'').trim(),
      kind:String(t.kind||'crimp').trim().toLowerCase(), source_url:safeUrl(t.source_url),
      confidence:/^confirmed$/i.test(String(t.confidence||'').trim()) ? 'confirmed' : (String(t.confidence||'').trim() ? 'likely' : '')}))
    .filter(t=>contacts[t.for_idx] && t.part_number && !_bomBadToolPn(t.part_number, contacts[t.for_idx].part_number))
    .map(t=>({...t, description:/\btool\b/i.test(t.description) ? t.description
      : `CRIMP TOOL${t.kind&&t.kind!=='crimp'?' '+t.kind.toUpperCase():''} for ${contacts[t.for_idx].part_number}${t.description?' — '+t.description:''}`}));
}
// {tools:[…], web:true|false, error:''}. Web search first; when the account or
// the server does not allow it, the same question without it.
export async function aiFindCrimpTools(contacts){
  if(!contacts.length || !_aiReady()) return {tools:[], web:false, error:'', searches:[], opened:[]};
  const t0=Date.now();
  const ask=async(web, list=contacts, deep=false)=>{
    let messages=[{role:'user', content:_crimpToolPrompt(list, web, deep)}];
    let text='', searched=false; const searches=[], opened=[];
    for(let turn=0; turn<5; turn++){
      const body={model:_csModel(), max_tokens:4096, temperature:0, messages};
      if(web) body.tools=[{...WEB_SEARCH_TOOL, max_uses:Math.min(12, (deep?5:3)*list.length+(deep?4:2))},
                          {...WEB_FETCH_TOOL, max_uses:Math.min(8, (deep?3:2)*list.length+(deep?2:1))}];
      const resp=await _aiFetch({body:JSON.stringify(body)}, 240000);
      if(!resp.ok){ let m=`Anthropic error ${resp.status}`; try{ const e=await resp.json(); m=e.error?.message||m; }catch{} throw Object.assign(new Error(m),{status:resp.status}); }
      const data=await resp.json();
      text+=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
      for(const b of (data.content||[])){
        if(b.type==='server_tool_use'||b.type==='web_search_tool_result'||b.type==='web_fetch_tool_result') searched=true;
        if(b.type==='server_tool_use' && b.name==='web_search' && b.input?.query) searches.push(String(b.input.query).slice(0,120));
        if(b.type==='server_tool_use' && b.name==='web_fetch' && b.input?.url) opened.push(String(b.input.url).slice(0,300));
      }
      // A long search can pause; hand the turn back so it carries on.
      if(data.stop_reason!=='pause_turn') break;
      messages=[...messages, {role:'assistant', content:data.content}];
    }
    return {tools:_cleanCrimpTools(_parseToolsReply(text), list), searched, searches, opened};
  };
  try{
    const r=await ask(true);
    // An answer with no search in it means the search never ran — a server
    // that does not pass web search on yet, or an account where it is off. Then
    // the question is asked again plainly, from what the AI knows.
    if(!r.searched){
      const note='Web search did not run (update the server functions and enable web search for the Anthropic account)';
      const r2=r.tools.length ? r : await ask(false);
      logSystemAudit('crimp_tool_search',{contacts:contacts.length, found:r2.tools.length, web:false, webError:note, ms:Date.now()-t0},true);
      return {tools:r2.tools, web:false, error:note, searches:[], opened:[]};
    }
    // Contacts the first search found nothing for get one deeper search of
    // their own (family + wire range → the maker's tooling specification).
    const missing=contacts.map((c,i)=>i).filter(i=>!r.tools.some(t=>t.for_idx===i));
    if(missing.length){
      try{
        const r2=await ask(true, missing.map(i=>contacts[i]), true);
        r.tools.push(...r2.tools.map(t=>({...t, for_idx:missing[t.for_idx]})));
        r.searches.push(...r2.searches); r.opened.push(...r2.opened);
      }catch(e){ console.warn('[tools] second search', e.message); }
    }
    logSystemAudit('crimp_tool_search',{contacts:contacts.length, found:r.tools.length, web:true, deep:missing.length, searches:r.searches.length, opened:r.opened.length, ms:Date.now()-t0},true);
    return {tools:r.tools, web:true, error:'', searches:r.searches, opened:r.opened};
  }catch(e){
    // Web search not enabled for the organisation, or an older proxy that drops
    // tools and so gets an answer with no searches: ask from knowledge instead.
    try{
      const {tools}=await ask(false);
      logSystemAudit('crimp_tool_search',{contacts:contacts.length, found:tools.length, web:false, webError:e.message, ms:Date.now()-t0},true);
      return {tools, web:false, error:'Web search unavailable: '+e.message, searches:[], opened:[]};
    }catch(e2){
      logSystemAudit('crimp_tool_search',{contacts:contacts.length, error:e2.message, ms:Date.now()-t0},false);
      return {tools:[], web:false, error:e2.message, searches:[], opened:[]};
    }
  }
}
