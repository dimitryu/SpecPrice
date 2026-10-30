// Builds extracted.js — every function and safe constant of the app as one
// plain CommonJS module, so the logic can be tested outside a browser.
//
// The app is ES modules under web/js. Here they are joined back into a single
// script (import/export lines removed), which is exactly what they were before
// the split — so the same 1,000+ assertions run against the same code. Shared
// state (S in core/state.js) is also exposed as plain globals, so a test can
// still write `companyId='c1'` or read `allParts`.
//
// Run from this folder:  node extract.js && node app-logic.test.js
const fs=require('fs'), path=require('path'), acorn=require('acorn');
const ROOT=path.join(__dirname,'..','web','js');
const OUT =path.join(__dirname,'extracted.js');

const files=[]; (function rec(d){ for(const f of fs.readdirSync(d).sort()){ const p=path.join(d,f);
  fs.statSync(p).isDirectory()?rec(p):f.endsWith('.js')&&files.push(p); } })(ROOT);
// state first, then everything else (no module reads another's constant while
// loading — tools/check-modules.js and the split guarantee that)
files.sort((a,b)=>(b.endsWith(path.join('core','state.js'))-a.endsWith(path.join('core','state.js'))));

const SAFE_INIT=new Set(['Literal','TemplateLiteral','ArrayExpression','ObjectExpression',
  'ArrowFunctionExpression','FunctionExpression','UnaryExpression','BinaryExpression']);
function initSafe(n){
  if(!n) return true;
  if(!SAFE_INIT.has(n.type)) return false;
  if(n.type==='ArrowFunctionExpression'||n.type==='FunctionExpression') return true;
  let bad=false;
  (function walk(x){
    if(!x||typeof x!=='object'||bad) return;
    if(Array.isArray(x)){x.forEach(walk);return;}
    if(x.type==='CallExpression'||x.type==='NewExpression'||x.type==='AwaitExpression'){bad=true;return;}
    if(x.type==='Identifier'&&/^(document|window|localStorage|auth|db|navigator)$/.test(x.name)){bad=true;return;}
    for(const k in x){ if(k==='loc'||k==='start'||k==='end'||k==='type') continue; walk(x[k]); }
  })(n);
  return !bad;
}

const pieces=[], names=[], skipped=[]; let stateKeys=[];
for(const f of files){
  const src=fs.readFileSync(f,'utf8');
  const ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'module'});
  const isState=f.endsWith(path.join('core','state.js'));
  for(const top of ast.body){
    const node = top.type==='ExportNamedDeclaration' ? top.declaration : top;
    if(!node) continue;                                  // export { … } lists
    if(isState && node.type==='VariableDeclaration' && node.declarations[0].id.name==='S'){
      // S, one property at a time: an initialiser that needs the browser
      // (localStorage) must not take the rest of the state down with it.
      const props=node.declarations[0].init.properties;
      stateKeys=props.map(p=>p.key.name);
      pieces.push('const S = {};\n'+props.map(p=>
        `try { S.${p.key.name} = (${src.slice(p.value.start,p.value.end)}); } catch(_e) { S.${p.key.name} = undefined; }`).join('\n')
        +`\nfor (const _k of Object.keys(S)) { try { Object.defineProperty(globalThis, _k, { get(){ return S[_k]; }, set(v){ S[_k]=v; }, configurable:true }); } catch(_e) {} }`);
      names.push('S');
      continue;
    }
    if(node.type==='FunctionDeclaration'){ pieces.push(src.slice(node.start,node.end)); names.push(node.id.name); }
    else if(node.type==='VariableDeclaration'){
      // APP_VER reads window.APP_VER (set by app.html) with a 'dev' fallback —
      // no call, safe to evaluate anywhere.
      const ok=node.declarations.every(d=>d.id.type==='Identifier'&&(initSafe(d.init)||d.id.name==='APP_VER'));
      if(ok){ pieces.push(src.slice(node.start,node.end)); node.declarations.forEach(d=>names.push(d.id.name)); }
      else node.declarations.forEach(d=>skipped.push(d.id.name||'(pattern)'));
    }
  }
}
const uniq=[...new Set(names)];
fs.writeFileSync(OUT, pieces.join('\n')
  +'\nmodule.exports={'+uniq.join(',')+'};\n'
  +stateKeys.map(k=>`Object.defineProperty(module.exports, ${JSON.stringify(k)}, { get(){ return S[${JSON.stringify(k)}]; }, enumerable:true });`).join('\n')+'\n');
console.log('functions+consts exported:', uniq.length, '(+', stateKeys.length, 'shared state)');
console.log('skipped consts:', skipped.length);
