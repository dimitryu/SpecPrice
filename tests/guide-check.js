// The user guide's source is consistent: every screenshot it names exists, every
// screenshot in the folder is used, chapter ids are unique, every block is a
// known type. Run: node guide-check.js
const fs=require('fs'), path=require('path');
const G=path.join(__dirname,'..','web','guide');
const d=JSON.parse(fs.readFileSync(path.join(G,'content.json'),'utf8'));
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('  ✗ '+m); } };
const TYPES=new Set(['h1','h2','p','steps','list','tip','warn','img','table']);
ok(Array.isArray(d.blocks) && d.blocks.length>20, 'blocks present');
ok(d.blocks[0].t==='h1', 'starts with a chapter');
d.blocks.forEach((b,i)=>ok(TYPES.has(b.t), `block ${i}: unknown type ${b.t}`));
const ids=d.blocks.filter(b=>b.t==='h1').map(b=>b.id);
ok(new Set(ids).size===ids.length, 'chapter ids unique');
const used=new Set();
d.blocks.filter(b=>b.t==='img').forEach(b=>{ used.add(path.basename(b.src));
  ok(fs.existsSync(path.join(G,b.src)), 'missing image '+b.src); });
fs.readdirSync(path.join(G,'img')).forEach(f=>ok(used.has(f), 'unused image '+f));
d.blocks.filter(b=>b.t==='table').forEach((b,i)=>b.rows.forEach(r=>ok(r.length===b.head.length, `table ${i}: row width`)));
ok(!/\b(RFQ's|Customers screen)\b/.test(JSON.stringify(d)), 'RFQ / Customers screens are not documented');
console.log(`guide check: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
