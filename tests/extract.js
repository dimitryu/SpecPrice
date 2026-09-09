// Extracts every top-level function + safe top-level const from web/app.html
// into a plain CommonJS module, so the pure logic can be unit-tested outside a
// browser. Run from this folder:  node extract.js && node app-logic.test.js
const fs=require('fs'), path=require('path'), acorn=require('acorn');
const HTML=path.join(__dirname,'..','web','app.html');
const OUT =path.join(__dirname,'extracted.js');
const html=fs.readFileSync(HTML,'utf8');
const sm=/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/.exec(html);
if(!sm) throw new Error('no <script type="module"> found in web/app.html');
const lineOffset=html.slice(0,sm.index).split('\n').length-1;
fs.writeFileSync(path.join(__dirname,'app.mjs'), '\n'.repeat(lineOffset)+sm[1]);
const src=fs.readFileSync(path.join(__dirname,'app.mjs'),'utf8');
const ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'module',locations:true});

const SAFE_INIT=new Set(['Literal','TemplateLiteral','ArrayExpression','ObjectExpression',
  'ArrowFunctionExpression','FunctionExpression','UnaryExpression','BinaryExpression']);

function initSafe(n){
  if(!n) return true;                       // `let x;`
  if(!SAFE_INIT.has(n.type)) return false;
  // reject anything containing a call/new/member-on-globals inside a data literal
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

const pieces=[], names=[], skipped=[];
for(const node of ast.body){
  if(node.type==='FunctionDeclaration'){
    pieces.push(src.slice(node.start,node.end)); names.push(node.id.name);
  } else if(node.type==='VariableDeclaration'){
    const ok=node.declarations.every(d=>d.id.type==='Identifier'&&initSafe(d.init));
    if(ok){
      pieces.push(src.slice(node.start,node.end));
      node.declarations.forEach(d=>names.push(d.id.name));
    } else {
      node.declarations.forEach(d=>skipped.push(d.id.name||'(pattern)'));
    }
  }
}
fs.writeFileSync(OUT,
  pieces.join('\n')+'\nmodule.exports={'+[...new Set(names)].join(',')+'};\n');
console.log('functions+consts exported:',new Set(names).size);
console.log('skipped consts:',skipped.length);
