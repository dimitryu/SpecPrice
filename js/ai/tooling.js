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
export function _crimpToolPrompt(contacts, web=true){
  const list=contacts.map((c,i)=>`${i}: ${c.part_number||''} | ${c.manufacturer||''} | ${c.description||''}`).join('\n');
  return `You are a wire-harness tooling engineer. For each crimp contact below (pin, socket, terminal, ferrule, lug), find the HAND CRIMP TOOL its manufacturer specifies for that exact contact part number.

Contacts (index: manufacturer part number | manufacturer | description):
${list}

How to find it:
${web ? `1. If the manufacturer field is empty, work it out from the part number and description first.
2. Search the web (web_search) for the contact's part number with its manufacturer and description (e.g. "<part number> <maker> crimp tool", "<part number> datasheet application tooling").
3. OPEN the best result with web_fetch — the MANUFACTURER's product page for that contact (it usually has an "Application Tooling" / "Tooling" / "Crimp tool" / "Hand tool" section) or the contact's datasheet / application tooling specification (PDF is fine). A distributor page (Mouser, DigiKey) that lists the maker's recommended tool is also acceptable. Read the tool's part number there.` :
`Use what you know of each manufacturer's application tooling documentation.`}
4. Return the HAND crimp tool (not a bench applicator). If that hand tool needs a separate die, locator or positioner, return it as a second entry. For MIL-spec contacts (M39029/…) return the M22520 crimp frame and its positioner.
5. "confidence": "confirmed" when a page states this tool for this contact (give that page as source_url); "likely" when no page says so but the maker's hand tool for that contact series and wire size is known to you — never a made-up number. The tool's part number is never the contact's own number, with or without a suffix. Nothing at all only when you have neither.

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
  const ask=async(web)=>{
    let messages=[{role:'user', content:_crimpToolPrompt(contacts, web)}];
    let text='', searched=false; const searches=[], opened=[];
    for(let turn=0; turn<5; turn++){
      const body={model:_csModel(), max_tokens:4096, temperature:0, messages};
      if(web) body.tools=[{...WEB_SEARCH_TOOL, max_uses:Math.min(12, 3*contacts.length+2)},
                          {...WEB_FETCH_TOOL, max_uses:Math.min(8, 2*contacts.length+1)}];
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
    return {tools:_cleanCrimpTools(_parseToolsReply(text), contacts), searched, searches, opened};
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
    logSystemAudit('crimp_tool_search',{contacts:contacts.length, found:r.tools.length, web:true, searches:r.searches.length, opened:r.opened.length, ms:Date.now()-t0},true);
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
