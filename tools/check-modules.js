#!/usr/bin/env node
// Static check of the module graph in web/js, with no browser:
//  - every file parses as an ES module
//  - every `import { x } from './y.js'` names a file that exists and exports x
//  - no top-level name is declared in two modules
//  - every module is reachable from main.js
// Run: node tools/check-modules.js   (exit code 1 on any problem)
const fs=require('fs'), path=require('path');
let acorn; try{ acorn=require('acorn'); }catch{ acorn=require(path.join(__dirname,'..','tests','node_modules','acorn')); }
const ROOT=path.join(__dirname,'..','web','js');
const files=[]; (function rec(d){ for(const f of fs.readdirSync(d)){ const p=path.join(d,f); fs.statSync(p).isDirectory()?rec(p):f.endsWith('.js')&&files.push(p); } })(ROOT);
const info=new Map(); let bad=0; const err=m=>{ console.error('✗ '+m); bad++; };
for(const f of files){
  const src=fs.readFileSync(f,'utf8'); let ast;
  try{ ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'module'}); }catch(e){ err(`${path.relative(ROOT,f)}: ${e.message}`); continue; }
  const exports=new Set(), imports=[], decls=[];
  for(const n of ast.body){
    if(n.type==='ExportNamedDeclaration'){
      if(n.declaration){ const d=n.declaration; (d.declarations||[d]).forEach(x=>{ const nm=(x.id&&x.id.name); if(nm){exports.add(nm); decls.push(nm);} }); }
      (n.specifiers||[]).forEach(s=>exports.add(s.exported.name));
    } else if(n.type==='ImportDeclaration'){
      imports.push({from:n.source.value, names:n.specifiers.map(s=>s.imported?s.imported.name:'default')});
    } else if(n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'){
      ((n.declarations)||[n]).forEach(x=>x.id&&decls.push(x.id.name));
    }
  }
  info.set(f,{exports,imports,decls});
}
// an imported binding is read-only in an ES module: writing to one throws at
// run time, on whatever click reaches that line — so find them now.
let walkMod; try{ walkMod=require('acorn-walk'); }catch{ try{ walkMod=require(path.join(__dirname,'..','tests','node_modules','acorn-walk')); }catch{ walkMod=null; } }
if(walkMod){
  for(const f of files){
    const src=fs.readFileSync(f,'utf8'); const ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'module'});
    const imported=new Set(); ast.body.filter(n=>n.type==='ImportDeclaration').forEach(n=>n.specifiers.forEach(s=>imported.add(s.local.name)));
    const shadowed=new Set();
    walkMod.ancestor(ast,{
      AssignmentExpression(n){ const t=n.left; if(t.type==='Identifier'&&imported.has(t.name)) err(`${path.relative(ROOT,f)}: assigns to imported "${t.name}"`); },
      UpdateExpression(n){ const t=n.argument; if(t.type==='Identifier'&&imported.has(t.name)) err(`${path.relative(ROOT,f)}: updates imported "${t.name}"`); },
    });
  }
} else console.log('(acorn-walk not installed — skipped the read-only import check)');
// Only data/ (and core/firebase.js, which wraps the SDK) may use Firestore.
const FIRESTORE=new Set(['db','doc','getDoc','getDocs','setDoc','addDoc','updateDoc','deleteDoc','collection','query','where','orderBy',
  'limit','serverTimestamp','writeBatch','arrayUnion','deleteField','onSnapshot']);
for(const [f,i] of info){
  const rel=path.relative(ROOT,f).split(path.sep).join('/');
  if(rel.startsWith('data/') || rel==='core/firebase.js') continue;
  for(const im of i.imports){ if(!/core\/firebase\.js$/.test(im.from)) continue;
    const bad=im.names.filter(n=>FIRESTORE.has(n));
    if(bad.length) err(`${rel}: uses Firestore directly (${bad.join(', ')}) — go through data/`); }
}
// Only ai/ talks to the model.
for(const f of files){ const rel=path.relative(ROOT,f).split(path.sep).join('/');
  if(rel.startsWith('ai/')) continue;
  if(/api\.anthropic\.com|\/aiProxy\b/.test(fs.readFileSync(f,'utf8').replace(/\/\/.*$/gm,''))) err(`${rel}: calls the AI model directly — go through ai/`); }
const owner=new Map();
for(const [f,i] of info){ for(const d of i.decls){ if(owner.has(d)) err(`"${d}" declared in both ${path.relative(ROOT,owner.get(d))} and ${path.relative(ROOT,f)}`); else owner.set(d,f); }
  for(const im of i.imports){ if(/^https?:/.test(im.from)) continue;
    const t=path.resolve(path.dirname(f), im.from);
    if(!info.has(t)){ err(`${path.relative(ROOT,f)}: imports missing file ${im.from}`); continue; }
    for(const n of im.names) if(!info.get(t).exports.has(n)) err(`${path.relative(ROOT,f)}: ${im.from} does not export "${n}"`);
  } }
const seen=new Set(); (function walk(f){ if(seen.has(f)) return; seen.add(f); for(const im of (info.get(f)||{imports:[]}).imports){ if(!/^https?:/.test(im.from)) walk(path.resolve(path.dirname(f),im.from)); } })(path.join(ROOT,'main.js'));
for(const f of files) if(!seen.has(f)) err(`${path.relative(ROOT,f)} is not reachable from main.js`);
console.log(bad?`${bad} problem(s)`:`module graph OK — ${files.length} modules, ${owner.size} top-level names`);
process.exit(bad?1:0);
