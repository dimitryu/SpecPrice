#!/usr/bin/env node
// Rewrites the import lines of every module in web/js from what the module
// actually uses. Every top-level name in the app is unique (the test bundle
// joins all modules into one script, so it has to be), which makes "which
// module exports X" a lookup, not a guess.
//
//   node tools/fix-imports.js          rewrite
//   node tools/fix-imports.js --check  report only (exit 1 if anything would change)
const fs=require('fs'), path=require('path');
const req=m=>{ for(const base of [__dirname, path.join(__dirname,'..','tests')]){ try{ return require(require.resolve(m,{paths:[base, path.join(base,'node_modules')]})); }catch{} } throw new Error('npm install '+m+' (in tests/)'); };
const acorn=req('acorn'), escope=req('eslint-scope');
const ROOT=path.join(__dirname,'..','web','js');
const CHECK=process.argv.includes('--check');
const files=[]; (function rec(d){ for(const f of fs.readdirSync(d).sort()){ const p=path.join(d,f); fs.statSync(p).isDirectory()?rec(p):f.endsWith('.js')&&files.push(p); } })(ROOT);
const parse=src=>acorn.parse(src,{ecmaVersion:2022,sourceType:'module',ranges:true});
// export index
const owner=new Map();
for(const f of files){
  const ast=parse(fs.readFileSync(f,'utf8'));
  for(const n of ast.body){
    if(n.type!=='ExportNamedDeclaration') continue;
    if(n.declaration){ const d=n.declaration; (d.declarations||[d]).forEach(x=>x.id&&owner.set(x.id.name,f)); }
    (n.specifiers||[]).forEach(s=>owner.set(s.exported.name,f));
  }
}
const GLOBALS=new Set(Object.getOwnPropertyNames(globalThis).concat(['window','document','localStorage','sessionStorage','location','navigator',
  'fetch','FileReader','Image','alert','confirm','prompt','pdfjsLib','XLSX','ExcelJS','html2canvas','URL','Blob','history','getComputedStyle',
  'requestAnimationFrame','HTMLElement','Event','MouseEvent','KeyboardEvent','CustomEvent','structuredClone','performance','crypto','console',
  'setTimeout','setInterval','clearTimeout','clearInterval','atob','btoa','TextEncoder','TextDecoder','DOMParser','Node','FormData','AbortController']));
let changed=0, problems=0;
for(const f of files){
  const src=fs.readFileSync(f,'utf8'); const ast=parse(src);
  const sm=escope.analyze(ast,{ecmaVersion:2022,sourceType:'module'});
  const modScope=sm.globalScope.childScopes.find(s=>s.type==='module');
  const imported=new Map(); // local -> import decl
  ast.body.filter(n=>n.type==='ImportDeclaration' && !/^https?:/.test(n.source.value)).forEach(n=>n.specifiers.forEach(s=>imported.set(s.local.name,n)));
  // names used but not declared in this module
  const need=new Map(); // name -> module file
  const free=new Set(sm.globalScope.through.map(r=>r.identifier.name));
  // references to current imports that are still used
  for(const v of modScope.variables){ if(imported.has(v.name) && v.references.length) free.add(v.name); }
  for(const name of free){
    if(owner.has(name) && owner.get(name)!==f){ need.set(name, owner.get(name)); continue; }
    if(owner.get(name)===f) continue;
    if(!GLOBALS.has(name)){ console.error(`✗ ${path.relative(ROOT,f)}: "${name}" is not defined anywhere`); problems++; }
  }
  // build the new import block
  const rel=t=>{ let r=path.relative(path.dirname(f),t).split(path.sep).join('/'); return r.startsWith('.')?r:'./'+r; };
  const byFile=new Map(); for(const [n,t] of need){ if(!byFile.has(t)) byFile.set(t,new Set()); byFile.get(t).add(n); }
  const order=[...byFile.keys()].sort((a,b)=>{ const ka=a.endsWith(path.join('core','state.js'))?'':path.relative(ROOT,a), kb=b.endsWith(path.join('core','state.js'))?'':path.relative(ROOT,b); return ka.localeCompare(kb); });
  const block=order.map(t=>`import { ${[...byFile.get(t)].sort().join(', ')} } from '${rel(t)}';`).join('\n');
  const relImports=ast.body.filter(n=>n.type==='ImportDeclaration' && !/^https?:/.test(n.source.value));
  let out;
  if(relImports.length){
    const a=relImports[0].range[0], b=relImports[relImports.length-1].range[1];
    out=src.slice(0,a)+block+src.slice(b);
  } else out=(block?block+'\n\n':'')+src;
  if(out!==src){ changed++; if(CHECK) console.log('would change: '+path.relative(ROOT,f)); else fs.writeFileSync(f,out); }
}
console.log(`${CHECK?'checked':'rewrote'} ${changed} module(s)${problems?`, ${problems} undefined name(s)`:''}`);
process.exit(problems||(CHECK&&changed)?1:0);
