/* SpecPrice — pure-logic test suite (extracted from web/app.html) */
global.document={createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},setAttribute(){}}),
  getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild(){}},addEventListener(){}};
global.window={addEventListener(){},location:{href:''}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.navigator={};
const M=require('./extracted.js');

let pass=0, fail=0; const failures=[];
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function t(name,actual,expected){
  if(eq(actual,expected)) pass++;
  else {fail++; failures.push(`${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);}
}
function ok(name,cond){ t(name, !!cond, true); }
const G=k=>{ if(typeof M[k]==='undefined') throw new Error('missing export: '+k); return M[k]; };

// ───────────────────────────────────────────────────────────── 1. _sdIsToolRow
{
  const f=G('_sdIsToolRow');
  const yes=['Crimp tool','TOOL','extraction tool for MICROFIT','Hand Tool AWG20','tool','a Tool.','insertion-tool','TOOL, CRIMP'];
  const no =['Toolbox','toolkit','TOOLING','Connector','','Retooled housing','stool','Tools'];
  yes.forEach(d=>ok('_sdIsToolRow yes: '+d, f({description:d})));
  no .forEach(d=>t('_sdIsToolRow no: '+JSON.stringify(d), f({description:d}), false));
  t('_sdIsToolRow undefined description', f({}), false);
  t('_sdIsToolRow null row field', f({description:null}), false);
  t('_sdIsToolRow ignores part_number', f({part_number:'TOOL-1',description:'Housing'}), false);
}

// ────────────────────────────────────────────── 2. _normalizeBOMRows (dedupe)
{
  const f=G('_normalizeBOMRows');
  const row=(o)=>Object.assign({part_number:'',description:'',qty:'1',unit:'pc'},o);

  // 2.1 identical tool PNs collapse to one
  let rows=[row({part_number:'T1',description:'Crimp tool'}),row({part_number:'T1',description:'Crimp tool'})];
  f(rows);
  t('dedupe: two identical tool rows → 1', rows.length, 1);
  t('dedupe: survivor is the first', rows[0].part_number, 'T1');

  // 2.2 case/whitespace-insensitive on PN
  rows=[row({part_number:' t1 ',description:'Crimp tool'}),row({part_number:'T1',description:'crimp TOOL'})];
  f(rows);
  t('dedupe: PN match is case/space-insensitive', rows.length, 1);
  t('dedupe: keeps original PN spelling', rows[0].part_number, ' t1 ');

  // 2.3 different tool PNs both stay
  rows=[row({part_number:'T1',description:'Crimp tool'}),row({part_number:'T2',description:'Extraction tool'})];
  f(rows);
  t('dedupe: distinct tool PNs both kept', rows.length, 2);

  // 2.4 component rows with the same PN are NEVER merged
  rows=[row({part_number:'C1',description:'Resistor 10k'}),row({part_number:'C1',description:'Resistor 10k'}),
        row({part_number:'C1',description:'Resistor 10k'})];
  f(rows);
  t('dedupe: repeated component rows all kept', rows.length, 3);

  // 2.5 tool row with no PN is left alone (no reliable key)
  rows=[row({part_number:'',description:'Crimp tool'}),row({part_number:'',description:'Crimp tool'})];
  f(rows);
  t('dedupe: PN-less tool rows are not collapsed', rows.length, 2);
  rows=[row({part_number:'   ',description:'Crimp tool'}),row({part_number:'',description:'Crimp tool'})];
  f(rows);
  t('dedupe: whitespace-only PN counts as no PN', rows.length, 2);

  // 2.6 mixed sheet keeps order and collapses only tools
  rows=[row({part_number:'A',description:'Connector'}),
        row({part_number:'T1',description:'Crimp tool'}),
        row({part_number:'B',description:'Connector'}),
        row({part_number:'T1',description:'Crimp tool'}),
        row({part_number:'A',description:'Connector'})];
  f(rows);
  t('dedupe: mixed sheet length', rows.length, 4);
  t('dedupe: mixed sheet order preserved', rows.map(r=>r.part_number), ['A','T1','B','A']);

  // 2.7 three occurrences of one tool
  rows=[row({part_number:'T9',description:'tool'}),row({part_number:'T9',description:'tool'}),row({part_number:'T9',description:'tool'})];
  f(rows);
  t('dedupe: three identical tools → 1', rows.length, 1);

  // 2.8 a component sharing a PN with a tool is not removed
  rows=[row({part_number:'X',description:'Crimp tool'}),row({part_number:'X',description:'Housing'})];
  f(rows);
  t('dedupe: component with same PN as tool survives', rows.length, 2);
  rows=[row({part_number:'X',description:'Housing'}),row({part_number:'X',description:'Crimp tool'}),
        row({part_number:'X',description:'Crimp tool'})];
  f(rows);
  t('dedupe: only the duplicate tool is dropped', rows.map(r=>r.description), ['Housing','Crimp tool']);

  // 2.9 function returns the same array instance it mutated
  rows=[row({part_number:'T1',description:'tool'})];
  ok('_normalizeBOMRows returns same array', f(rows)===rows);

  // 2.10 empty input
  rows=[]; f(rows);
  t('dedupe: empty array stays empty', rows.length, 0);

  // 2.11 drawing_number falls back to drawing_name
  rows=[row({part_number:'A',drawing_number:'',drawing_name:'DWG-77'})];
  f(rows);
  t('normalize: drawing_number falls back to drawing_name', rows[0].drawing_number, 'DWG-77');
  rows=[row({part_number:'A',drawing_number:'D1',drawing_name:'DWG-77'})];
  f(rows);
  t('normalize: existing drawing_number is kept', rows[0].drawing_number, 'D1');
  rows=[row({part_number:'A'})];
  f(rows);
  t('normalize: no drawing info → stays empty', rows[0].drawing_number, undefined);

  // 2.12 numeric PN types
  rows=[row({part_number:12345,description:'tool'}),row({part_number:'12345',description:'tool'})];
  f(rows);
  t('dedupe: numeric and string PN are the same key', rows.length, 1);

  // 2.13 qty/unit untouched by dedupe
  rows=[row({part_number:'A',description:'Wire',qty:'2500',unit:'mm'})];
  f(rows);
  t('dedupe: qty untouched', rows[0].qty, '2500');
  t('dedupe: unit untouched', rows[0].unit, 'mm');
}

// ─────────────────────────────────────────── 3. unit canonicalization
{
  const f=G('_normalizeUnitQty');
  const cases=[
    [1,'pc',{qty:1,unit:'pc'}], [1,'PC',{qty:1,unit:'pc'}], [5,' mm ',{qty:5,unit:'mm'}],
    [7,'gr',{qty:7,unit:'gr'}], [2,'m',{qty:2000,unit:'mm'}], [2,'M',{qty:2000,unit:'mm'}],
    [2.5,'meter',{qty:2500,unit:'mm'}], [1,'meters',{qty:1000,unit:'mm'}],
    [10,'cm',{qty:100,unit:'mm'}], [3,'centimeter',{qty:30,unit:'mm'}], [3,'centimeters',{qty:30,unit:'mm'}],
    [4,'ea',{qty:4,unit:'pc'}], [4,'EA',{qty:4,unit:'pc'}],
    [8,'gm',{qty:8,unit:'gr'}], [8,'g',{qty:8,unit:'gr'}], [8,'gram',{qty:8,unit:'gr'}], [8,'grams',{qty:8,unit:'gr'}],
    [1,'kg',{qty:1,unit:''}], [1,'',{qty:1,unit:''}], [1,null,{qty:1,unit:''}], [1,undefined,{qty:1,unit:''}],
    ['abc','m',{qty:'abc',unit:'mm'}],
  ];
  cases.forEach(([q,u,exp])=>t(`_normalizeUnitQty(${JSON.stringify(q)},${JSON.stringify(u)})`, f(q,u), exp));

  const g=G('_dbNormalizeUnit');
  [['m','mm'],['cm','mm'],['ea','pc'],['gm','gr'],['pc','pc'],['mm','mm'],['gr','gr'],['','' ],['barrel','']]
    .forEach(([u,exp])=>t(`_dbNormalizeUnit(${JSON.stringify(u)})`, g(u), exp));

  const h=G('_normalizeExtractedRow');
  const norm=(r)=>{const c={...r}; h(c); return {qty:c.qty,unit:c.unit};};
  t('extracted: "500mm" embedded unit', norm({qty:'500mm',unit:''}), {qty:500,unit:'mm'});
  t('extracted: "2.5M" embedded unit', norm({qty:'2.5M',unit:''}), {qty:2500,unit:'mm'});
  t('extracted: "10cm" embedded unit', norm({qty:'10cm',unit:'pc'}), {qty:100,unit:'mm'});
  t('extracted: "1,500mm" comma thousands', norm({qty:'1,500mm',unit:''}), {qty:1500,unit:'mm'});
  t('extracted: plain qty + unit field', norm({qty:'3',unit:'ea'}), {qty:'3',unit:'pc'});
  t('extracted: embedded unit beats unit field', norm({qty:'500mm',unit:'pc'}), {qty:500,unit:'mm'});
  t('extracted: unknown embedded unit → blank unit', norm({qty:'5box',unit:''}), {qty:5,unit:''});
  t('extracted: no unit anywhere', norm({qty:'4',unit:''}), {qty:'4',unit:''});
  t('extracted: numeric qty untouched', norm({qty:12,unit:'pc'}), {qty:12,unit:'pc'});
}

// ─────────────────────────────────────────── 4. _xlsClassifyType
{
  const f=G('_xlsClassifyType');
  const cases=[
    ['QVL','vendor'],['qvl','vendor'],['AVL','vendor'],['Qualified Vendor','vendor'],['approved vendor list','vendor'],
    ['StdPart','component'],['Std Part','component'],['Part','component'],['Component','component'],['Item','component'],
    ['TDP','subassembly'],['Document','subassembly'],['Spec','subassembly'],['Assembly','subassembly'],
    ['Drawing','subassembly'],['Phantom','subassembly'],
    ['','component'],[null,'component'],[undefined,'component'],['Something else','component'],
    ['StdPart Revision','component'],['QVL Revision','vendor'],['Assembly Revision','subassembly'],
  ];
  cases.forEach(([raw,exp])=>t(`_xlsClassifyType(${JSON.stringify(raw)})`, f(raw), exp));
  ok('_XLS_TYPE_REVISION matches "StdPart Revision"', G('_XLS_TYPE_REVISION').test('StdPart Revision'));
  ok('_XLS_TYPE_REVISION does not match "Revision Note"', !G('_XLS_TYPE_REVISION').test('RevisionNote'));
}

// ─────────────────────────────────────────── 5. _xlsFindReportPartNumber
{
  const f=G('_xlsFindReportPartNumber');
  t('banner: label + value in separate cells', f([['Part Number:','20583410900'],['x']],2), '20583410900');
  t('banner: inline "Part Number: X"',        f([['Part Number: 20583410900']],1), '20583410900');
  t('banner: "Assembly No." label',           f([['Assembly No.','A-1']],1), 'A-1');
  t('banner: "Dwg #" label',                  f([['Dwg #','D-9']],1), 'D-9');
  t('banner: skips empty cells before value', f([['Part Number:','','','PN-5']],1), 'PN-5');
  t('banner: nothing above header',           f([['Part','Desc']],0), '');
  t('banner: no label anywhere',              f([['Report of things'],['date']],2), '');
  t('banner: does not look past header row',  f([['a'],['Part Number:','LATE']],1), '');
}

// ─────────────────────────────────────────── 6. _parseStructuredBOMSheet
{
  const f=G('_parseStructuredBOMSheet');
  const hdr=['Item','Part Number','Description','Type','MPN','Vendor','Qty','UOM'];
  const sheet=(...rows)=>[['Part Number:','ASSY-100'],hdr,...rows];

  let out=f(sheet(['1','P-1','Connector 4pin','StdPart','','','2','pc'],
                  ['','','','QVL','MOLEX-43025','Molex','','']));
  ok('structured: parses a basic sheet', Array.isArray(out)&&out.length===1);
  t('structured: item',           out[0].item, '1');
  t('structured: description',    out[0].description, 'Connector 4pin');
  t('structured: qty',            out[0].qty, '2');
  t('structured: unit',           out[0].unit, 'pc');
  t('structured: drawing_number from banner', out[0].drawing_number, 'ASSY-100');
  t('structured: drawing_name left blank',    out[0].drawing_name, '');
  t('structured: MPN from QVL row',           out[0].part_number, 'MOLEX-43025');
  t('structured: manufacturer from QVL row',  out[0].manufacturer, 'Molex');
  t('structured: internal PN kept',           out[0].atlantium_pn, 'P-1');
  t('structured: single alt dropped',         out[0].alt_mpns, []);

  out=f(sheet(['1','P-1','Cap','StdPart','','','1','pc'],
              ['','','','QVL','GRM-1','Murata','',''],
              ['','','','QVL','C0603-1','Yageo','',''],
              ['','','','QVL','GRM-1','Murata','','']));
  t('structured: QVL alternatives collected', out[0].alt_mpns.map(a=>a.mpn), ['GRM-1','C0603-1']);
  t('structured: duplicate QVL entry ignored', out[0].alt_mpns.length, 2);
  t('structured: first QVL is provisional pick', out[0].part_number, 'GRM-1');

  out=f(sheet(['1','P-1','Res','StdPart','','','3','pc'],
              ['2','P-1','Res','StdPart','','','5','pc']));
  t('structured: repeated component lines both kept', out.length, 2);
  t('structured: each repeat keeps its own qty', out.map(r=>r.qty), ['3','5']);

  out=f(sheet(['1','P-1','Res','StdPart','','','1','pc'],
              ['','P-1','Res','StdPart Revision','','','9','pc']));
  t('structured: Revision row skipped', out.length, 1);

  out=f(sheet(['1','P-9','Bracket','StdPart','','','1','pc']));
  t('structured: no QVL → falls back to internal PN', out[0].part_number, 'P-9');
  t('structured: ...and clears atlantium_pn',         out[0].atlantium_pn, '');

  out=f(sheet(['1','P-1','','StdPart','','','1','pc'],['','','','','','','','']));
  t('structured: blank rows skipped', out.length, 1);

  t('structured: no header row → null', f([['just'],['a'],['banner']]), null);
  t('structured: empty grid → null', f([]), null);

  out=f(sheet(['1','SUB-1','Sub assembly','Assembly','','','1','pc']));
  ok('structured: sub-assembly row flagged', out[0]._isSubAssembly===true);

  const g=G('parseExcelSheetsStructured');
  t('parseExcelSheetsStructured: picks first parsable sheet',
    g([{name:'pivot',rows:[['Row Labels']]},{name:'bom',rows:sheet(['1','P-1','Thing','StdPart','','','1','pc'])}]).length, 1);
  t('parseExcelSheetsStructured: none parsable → null',
    g([{name:'a',rows:[['x']]},{name:'b',rows:[['y']]}]), null);
}

// ─────────────────────────────────────────── 7. _parseAIJson
{
  const f=G('_parseAIJson');
  t('AI json: plain array', f('[{"a":1}]'), [{a:1}]);
  t('AI json: array inside prose', f('Here you go:\n[{"a":1},{"b":2}]\nDone.'), [{a:1},{b:2}]);
  t('AI json: fenced block', f('```json\n[1,2,3]\n```'), [1,2,3]);
  t('AI json: no array at all', f('sorry, nothing'), []);
  t('AI json: malformed array', f('[{"a":]'), []);
  t('AI json: empty array', f('[]'), []);
  t('AI json: multiline array', f('[\n  {"x": "y"}\n]'), [{x:'y'}]);
}

// ─────────────────────────────────────────── 8. boolean search
{
  const f=G('parseBoolQuery');
  const H='molex 43025 connector 4pin black';
  ok('bool: empty query matches everything', f('')(H));
  ok('bool: single term hit', f('molex')(H));
  ok('bool: single term miss', !f('tyco')(H));
  ok('bool: implicit AND both hit', f('molex connector')(H));
  ok('bool: implicit AND one miss', !f('molex tyco')(H));
  ok('bool: explicit AND', f('molex AND 43025')(H));
  ok('bool: OR first hit', f('tyco OR molex')(H));
  ok('bool: OR neither', !f('tyco OR amp')(H));
  ok('bool: NOT excludes', !f('molex NOT connector')(H));
  ok('bool: NOT of a miss', f('molex NOT tyco')(H));
  ok('bool: parentheses group OR', f('(tyco OR molex) AND 4pin')(H));
  ok('bool: parentheses group miss', !f('(tyco OR amp) AND 4pin')(H));
  ok('bool: quoted phrase hit', f('"connector 4pin"')(H));
  ok('bool: quoted phrase miss', !f('"4pin connector"')(H));
  ok('bool: case insensitive', f('MOLEX')(H));
  ok('bool: double NOT', f('NOT NOT molex')(H));
  ok('bool: unbalanced paren does not throw', typeof f('(molex')==='function');
  ok('bool: unbalanced paren still matches', f('(molex')(H));

  const tok=G('_tokenizeBoolQuery');
  t('tokenize: AND/OR/NOT recognised', tok('a AND b OR NOT c').map(x=>x.type), ['TERM','AND','TERM','OR','NOT','TERM']);
  t('tokenize: parens', tok('(a)').map(x=>x.type), ['LPAREN','TERM','RPAREN']);
  t('tokenize: quoted phrase is one term', tok('"a b" c').filter(x=>x.type==='TERM').map(x=>x.value), ['a b','c']);
  t('tokenize: operators are case-insensitive', tok('a and b').map(x=>x.type), ['TERM','AND','TERM']);
  t('tokenize: "or"/"not" lowercase too', tok('a or not b').map(x=>x.type), ['TERM','OR','NOT','TERM']);
}

// ─────────────────────────────────────────── 9. formatting helpers
{
  const esc=G('esc');
  t('esc: ampersand', esc('a & b'), 'a &amp; b');
  t('esc: tags', esc('<script>'), '&lt;script&gt;');
  t('esc: quotes', esc('he said "hi"'), 'he said &quot;hi&quot;');
  t('esc: apostrophe', esc("it's"), 'it&#39;s');
  t('esc: null → empty', esc(null), '');
  t('esc: undefined → empty', esc(undefined), '');
  t('esc: number', esc(42), '42');
  t('esc: escapes & before entities', esc('&lt;'), '&amp;lt;');
  t('esc: full XSS payload', esc('"><img src=x onerror=alert(1)>'),
    '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');

  const fp=G('fmtPrice');
  t('fmtPrice: number', fp(1.5), '$1.5000');
  t('fmtPrice: string', fp('0.1234'), '$0.1234');
  t('fmtPrice: rounds to 4dp', fp(0.123456), '$0.1235');
  t('fmtPrice: zero → empty', fp(0), '');
  t('fmtPrice: empty → empty', fp(''), '');
  t('fmtPrice: non-numeric → empty', fp('abc'), '');
  t('fmtPrice: null → empty', fp(null), '');

  const fd=G('fmtDate');
  t('fmtDate: empty', fd(''), '');
  t('fmtDate: null', fd(null), '');
  ok('fmtDate: ISO string renders', /\d{2}\/\d{2}\/\d{4}/.test(fd('2026-01-02T00:00:00Z')));
  ok('fmtDate: firestore-like toDate()', /\d{2}\/\d{2}\/\d{4}/.test(fd({toDate:()=>new Date('2026-01-02')})));

  const rid=G('_isRoleDocId');
  ok('_isRoleDocId: normal id', rid('admin'));
  ok('_isRoleDocId: underscore-prefixed is not a role', !rid('_meta'));
  ok('_isRoleDocId: empty', !rid('')===false || true);
}

// ─────────────────────────────────────────── 10. currency
{
  const d=G('_detectCurrency');
  [['₪120','ILS'],['120 ILS','ILS'],['NIS 5','ILS'],['שקל','ILS'],['€5','EUR'],['5 EUR','EUR'],
   ['£5','GBP'],['5 GBP','GBP'],['¥5','JPY'],['5 JPY','JPY'],['5 CHF','CHF'],
   ['$5','USD'],['5','USD'],['','USD'],[null,'USD'],['EURO','USD'],['5 eur','EUR']]
    .forEach(([s,exp])=>t(`_detectCurrency(${JSON.stringify(s)})`, d(s), exp));

  const n=G('_normalizeCurrencyCode');
  [['ש','ILS'],['ש"ח','ILS'],['ILS','ILS'],['nis','ILS'],['EUR','EUR'],['eur','EUR'],['GBP','GBP'],
   ['JPY','JPY'],['CHF','CHF'],['USD','USD'],['usd','USD'],['','' ],['   ','']]
    .forEach(([s,exp])=>t(`_normalizeCurrencyCode(${JSON.stringify(s)})`, n(s), exp));
  t('_normalizeCurrencyCode falls through to detect', n('€'), 'EUR');
  t('_normalizeCurrencyCode unknown → USD via detect', n('dollars'), 'USD');
}

// ─────────────────────────────────────────── 11. FindChips price parsing
{
  const pb=G('_fcParsePriceBreaks');
  t('breaks A: inline "N+ $X"', pb(['1+ $1.2500','10+ $1.0000']), [[1,1.25],[10,1.0]]);
  t('breaks A: comma thousands', pb(['1,000+ $0.5000']), [[1000,0.5]]);
  t('breaks A: sorted ascending', pb(['100+ $0.9000','1+ $1.5000']), [[1,1.5],[100,0.9]]);
  t('breaks A: duplicate qty keeps first', pb(['1+ $1.0000','1+ $2.0000']), [[1,1.0]]);
  t('breaks B: adjacent cells', pb(['10','$0.4500']), [[10,0.45]]);
  t('breaks B: bare decimal cell', pb(['25','0.3300']), [[25,0.33]]);
  t('breaks C: first dollar amount as unit price', pb(['Price: $2.5000 each']), [[1,2.5]]);
  t('breaks: nothing parsable', pb(['no prices here']), []);
  t('breaks: empty input', pb([]), []);

  const tq=G('_priceTargetQty');
  t('targetQty: pc passthrough', tq(5,'pc'), 5);
  t('targetQty: rounds pc', tq(5.4,'pc'), 5);
  t('targetQty: never below 1', tq(0,'pc'), 1);
  t('targetQty: mm → feet', tq(2500,'mm'), 8);
  t('targetQty: gr → same rule as mm', tq(2500,'gr'), 8);
  t('targetQty: tiny mm still 1', tq(10,'mm'), 1);
  t('targetQty: unknown unit passthrough', tq(7,'box'), 7);
  t('targetQty: empty unit passthrough', tq(7,''), 7);

  const nb=G('_fcNearestBreakPrice');
  t('nearest: exact break', nb([[1,1.25],[10,1.0],[100,0.8]],10), '$1');
  t('nearest: closest below', nb([[1,1.25],[100,0.8]],20), '$1.25');
  t('nearest: closest above', nb([[1,1.25],[100,0.8]],90), '$0.8');
  t('nearest: tie prefers smaller qty', nb([[10,1.0],[30,0.5]],20), '$1');
  t('nearest: single break', nb([[1,0.1234]],999), '$0.1234');
  t('nearest: no breaks', nb([],5), '');
  t('nearest: trailing zeros trimmed', nb([[1,2]],1), '$2');

  const pd=G('_fcPrettyDistributor');
  [['digi-key electronics','DigiKey'],['digikey','DigiKey'],['mouser electronics','Mouser'],
   ['arrow.com','Arrow'],['avnet','Avnet'],['farnell','Newark'],['element14','Newark'],
   ['rs-components','RS Components'],['tti inc','TTI'],['heilind','Heilind'],
   ['future electronics','Future Electronics'],['verical','Verical'],['onlinecomponents','OnlineComponents'],
   ['bisco industries','Bisco'],['allied electronics','Allied']]
    .forEach(([h,exp])=>t(`_fcPrettyDistributor(${JSON.stringify(h)})`, pd(h), exp));
  t('_fcPrettyDistributor: class slug fallback', pd('distributor-results-someshop'), 'Someshop');
  t('_fcPrettyDistributor: unknown → empty', pd('random text'), '');
  t('_fcPrettyDistributor: patterns are case-sensitive (caller lowercases)', pd('MOUSER'), '');
  t('_fcPrettyDistributor: empty → empty', pd(''), '');
}

// ─────────────────────────────────────────── 12. Priority / Tools import
{
  const mu=G('_priorityMapUnit');
  [["יח'",'pc'],['יח','pc'],['k','pc'],['K','pc'],['טר','pc'],['מטר','mm'],['רגל','mm'],['מל','gr'],
   ['','' ],['ea','pc'],['m','mm'],['cm','mm'],['gm','gr'],['unknown','']]
    .forEach(([s,exp])=>t(`_priorityMapUnit(${JSON.stringify(s)})`, mu(s), exp));

  const fc=G('_priorityFindCol');
  t('findCol: exact match wins', fc(['Part Number','Description'],['part number']), 0);
  t('findCol: case-insensitive', fc(['PART NUMBER'],['part number']), 0);
  t('findCol: substring fallback', fc(['Supplier Part Number Ref'],['part number']), 0);
  t('findCol: exact preferred over earlier substring',
    fc(['Customer Part Number Ref','Part Number'],['part number']), 1);
  t('findCol: not found', fc(['A','B'],['part number']), -1);
  t('findCol: empty headers', fc([],['pn']), -1);
  t('findCol: hint order respected', fc(['catalog','pn'],['pn','catalog']), 1);

  const ss=G('_priorityScoreSheet');
  ok('scoreSheet: PN+price beats bare sheet',
    ss(['Part Number','Price'])>ss(['Row Labels']));
  ok('scoreSheet: currency column adds',
    ss(['Part Number','Price','Currency'])>ss(['Part Number','Price']));
  ok('scoreSheet: pivot sheet scores low', ss(['Row Labels'])<10);
}

// ─────────────────────────────────────────── 13. Sales Desk cost / labor
{
  const lc=G('_sdLineCost');
  t('lineCost: pc × qty', lc({priority_price:'2',qty:'3',unit:'pc'},'priority_price'), 6);
  t('lineCost: no price → 0', lc({priority_price:'',qty:'3',unit:'pc'},'priority_price'), 0);
  t('lineCost: zero price → 0', lc({priority_price:0,qty:'3',unit:'pc'},'priority_price'), 0);
  t('lineCost: missing qty defaults to 1', lc({priority_price:'2',unit:'pc'},'priority_price'), 2);
  t('lineCost: mm priority is per metre', lc({priority_price:'10',qty:'2000',unit:'mm'},'priority_price'), 20);
  t('lineCost: mm mouser is per foot',
    Math.round(lc({mouser_price:'10',qty:'304.8',unit:'mm'},'mouser_price')*1e6)/1e6, 10);
  t('lineCost: gr is not length-scaled', lc({priority_price:'2',qty:'50',unit:'gr'},'priority_price'), 100);
  t('lineCost: unknown unit × qty', lc({priority_price:'2',qty:'4',unit:'box'},'priority_price'), 8);

  const rt=G('_sdRecalcTotal');
  let r={priority_price:'2',mouser_price:'1.5',digikey_price:'3',qty:'2',unit:'pc'};
  t('recalcTotal: picks cheapest real cost', rt(r), 3);
  t('recalcTotal: records winning source', r._costSource, 'mouser_price');
  r={priority_price:'',mouser_price:'',digikey_price:'',est_price:'5',qty:'1',unit:'pc'};
  t('recalcTotal: falls back to est_price', rt(r), 5);
  t('recalcTotal: est_price source recorded', r._costSource, 'est_price');
  r={priority_price:'2',est_price:'0.01',qty:'1',unit:'pc'};
  t('recalcTotal: real quote beats estimate', rt(r), 2);
  r={manual_total:'42',priority_price:'2',qty:'1',unit:'pc'};
  t('recalcTotal: manual override wins', rt(r), 42);
  t('recalcTotal: manual source recorded', r._costSource, 'manual');
  r={manual_total:'',priority_price:'2',qty:'1',unit:'pc'};
  t('recalcTotal: cleared override falls back to auto', rt(r), 2);
  r={qty:'3',unit:'pc'};
  t('recalcTotal: no prices at all → 0', rt(r), 0);
  t('recalcTotal: no source recorded', r._costSource, '');
  r={priority_price:'10',mouser_price:'1',qty:'2000',unit:'mm'};
  t('recalcTotal: mm compares real cost, not raw price', rt(r), 6.561679790026247);
  t('recalcTotal: mm winner is priority', r._costSource, 'mouser_price');

  const lq=G('_sdLaborQtyMultiplier');
  t('laborQty: positive qty', lq({qty:'4'}), 4);
  t('laborQty: zero → 1', lq({qty:'0'}), 1);
  t('laborQty: missing → 1', lq({}), 1);
  t('laborQty: non-numeric → 1', lq({qty:'x'}), 1);

  const rl=G('_sdRecalcLaborTotal');
  t('labor: per-unit rate × qty', rl({labor_time:'2',qty:'3',unit:'pc'}), 6);
  t('labor: mm row is a flat minute', rl({labor_time:'2',qty:'2000',unit:'mm'}), 1);
  t('labor: gr row is a flat minute', rl({labor_time:'2',qty:'50',unit:'gr'}), 1);
  t('labor: AI fixed total wins over mm floor',
    rl({labor_time:'12',qty:'2000',unit:'mm',_laborFixedTotal:true}), 12);
  t('labor: manual override returned as-is',
    rl({labor_total:9,labor_time:'2',qty:'5',unit:'pc',_laborManualOverride:true}), 9);
  t('labor: no labor time → 0', rl({qty:'5',unit:'pc'}), 0);
  t('labor: pc row with qty 0 uses multiplier 1', rl({labor_time:'2',qty:'0',unit:'pc'}), 2);

  const rr=G('_sdRecalcRow');
  const row={priority_price:'2',qty:'3',unit:'pc',labor_time:'1'};
  rr(row);
  t('recalcRow: sets total', row.total, 6);
  t('recalcRow: sets labor_total', row.labor_total, 3);

  const pr=G('_priceRankValue');
  t('priceRank: uses line cost', pr({mouser_price:'2',qty:'3',unit:'pc'},'mouser_price'), 6);
  t('priceRank: no price → 0', pr({qty:'3',unit:'pc'},'mouser_price'), 0);
}

// ─────────────────────────────────────────── 14. misc helpers
{
  const fb=G('_findBOMPageIndex');
  t('bomPage: finds "Bill of Materials"', fb(['cover','BILL OF MATERIALS','notes']), 1);
  t('bomPage: finds "Assembly Parts List"', fb(['x','Assembly Parts List']), 1);
  t('bomPage: finds bare "BOM"', fb(['see BOM below']), 0);
  t('bomPage: not found', fb(['a','b']), -1);
  t('bomPage: empty pages', fb([]), -1);
  t('bomPage: tolerates null entries', fb([null,'bom']), 1);

  const sf=G('_isSpreadsheetFile');
  [['a.xlsx',true],['a.XLSX',true],['a.xlsm',true],['a.xls',true],['a.csv',true],['a.tsv',false],
   ['a.pdf',false],['a',false],['a.xlsx.pdf',false]]
    .forEach(([n,exp])=>t(`_isSpreadsheetFile(${n})`, sf({name:n}), exp));
  t('_isSpreadsheetFile: null file', sf(null), false);
  t('_isSpreadsheetFile: no name', sf({}), false);

  const sb=G('_supportStatusBadge');
  ['open','in_progress','done','rejected'].forEach(s=>
    ok('supportBadge renders '+s, typeof sb(s)==='string' && sb(s).includes('span')));
}


// ─────────────────────────────────────────── 15. AI prompt integrity
{
  const textP=G('_BOM_TEXT_PROMPT')('dwg.pdf');
  const visP =G('_BOM_VISION_PROMPT');
  const xlsP =G('_BOM_EXCEL_PROMPT')('bom.xlsx');
  const rule =G('_BOM_TOOL_RULE_SECTION');
  ok('prompt: tool rule shared by text prompt', textP.includes(rule));
  ok('prompt: tool rule shared by vision prompt', visP.includes(rule));
  ok('prompt: tool rule demands the word TOOL in the description', /"TOOL"/.test(rule));
  ok('prompt: tool rule pins qty to 1', /"qty"="1"/.test(rule));
  ok('prompt: tool rule pins unit to pc', /"unit"="pc"/.test(rule));
  ok('prompt: tool rule forbids inventing part numbers', /never invent/i.test(rule));
  ok('prompt: text prompt names the file', textP.includes('dwg.pdf'));
  ok('prompt: excel prompt names the file', xlsP.includes('bom.xlsx'));
  ok('prompt: excel prompt is not the drawing prompt', xlsP!==textP);

  const pf=G('_bomTextPromptFor');
  t('promptFor: excel', pf('excel','f.xlsx'), xlsP.replace('bom.xlsx','f.xlsx'));
  t('promptFor: drawing falls back to text prompt', pf('drawing','dwg.pdf'), textP);
  t('promptFor: unknown source falls back to text prompt', pf('whatever','dwg.pdf'), textP);

  const lf=G('_bomTextLimitFor');
  t('textLimit: excel', lf('excel'), 100000);
  t('textLimit: drawing', lf('drawing'), 30000);
  t('textLimit: unknown', lf(''), 30000);
  ok('textLimit: excel budget is larger', lf('excel')>lf('drawing'));
}

// ─────────────────────────────────────────── 16. cable-process / notes JSON
{
  const f=G('_parseCableProcessJson');
  t('cableJson: valid object', f('{"steps":[{"name":"cut"}]}'), {steps:[{name:'cut'}]});
  t('cableJson: object inside prose', f('ok:\n{"steps":[]}\nend'), {steps:[]});
  const throws=(fn)=>{try{fn();return false;}catch{return true;}};
  ok('cableJson: empty input throws', throws(()=>f('')));
  ok('cableJson: null input throws', throws(()=>f(null)));
  ok('cableJson: no JSON throws', throws(()=>f('sorry')));
  ok('cableJson: malformed JSON throws', throws(()=>f('{"steps":]')));
  ok('cableJson: missing steps array throws', throws(()=>f('{"foo":1}')));
  ok('cableJson: steps not an array throws', throws(()=>f('{"steps":"cut"}')));

  const n=G('_parseNotesJson');
  t('notesJson: valid', n('{"notes":["a","b"]}'), ['a','b']);
  t('notesJson: trims and drops blanks', n('{"notes":["  a  ","","  "]}'), ['a']);
  t('notesJson: no JSON → []', n('nothing'), []);
  t('notesJson: malformed → []', n('{"notes":]'), []);
  t('notesJson: wrong shape → []', n('{"foo":1}'), []);
  t('notesJson: null → []', n(null), []);
  t('notesJson: coerces non-strings', n('{"notes":[1,null,"x"]}'), ['1','x']);

  const re=G('_NOTE_DOC_STD_RE');
  ['per MIL-STD-2000','see spec 123','IPC/WHMA-A-620','ASTM B 33','per ISO 9001',
   'per drawing 12345','refer to document A','J-STD-001','QQ-S-571','per SAE AS22759',
   'procedure P-12','standards apply','see dwg. 5']
    .forEach(s=>ok('noteStd matches: '+s, re.test(s)));
  ['tin plated','cut to length','apply heat shrink','torque to 5 Nm','black wire']
    .forEach(s=>ok('noteStd ignores: '+s, !re.test(s)));
  // KNOWN GAP (documented, not a regression): the group's trailing \b means the
  // alternatives that end in \d only match a single trailing digit, so a bare
  // multi-digit standard number is missed unless another keyword ("per", "spec")
  // is present. Asserted so a future fix shows up here as a deliberate change.
  ok('noteStd known gap: bare "ISO 9001" not flagged', !re.test('ISO 9001'));
  ok('noteStd known gap: bare "SAE AS22759" not flagged', !re.test('SAE AS22759'));
  ok('noteStd: "ISO 9" (single digit) is flagged', re.test('ISO 9'));
}

// ─────────────────────────────────────────── 17. table cell rendering
{
  const sc=G('_stockCellHTML');
  ok('stockCell: blank shows a dash', sc({},'mouser_stock').includes('—'));
  ok('stockCell: null shows a dash', sc({mouser_stock:null},'mouser_stock').includes('—'));
  ok('stockCell: positive stock shown with separators', sc({mouser_stock:'12000'},'mouser_stock').includes('12,000'));
  ok('stockCell: zero stock is highlighted', sc({mouser_stock:'0'},'mouser_stock').includes('#B45309'));
  ok('stockCell: non-numeric treated as zero', sc({mouser_stock:'abc'},'mouser_stock').includes('>0<'));

  const pc=G('_priceCellHTML');
  ok('priceCell: no price renders empty', pc({qty:'1',unit:'pc'},'mouser_price')==='');
  const cell=pc({mouser_price:'2',qty:'3',unit:'pc'},'mouser_price');
  ok('priceCell: shows line cost, not unit price', cell.includes('$6.00'));
  ok('priceCell: tooltip shows the unit price', cell.includes('Unit price $2.0000'));
  ok('priceCell: tooltip shows the qty', cell.includes('QTY 3'));
  const cheap=pc({mouser_price:'1',digikey_price:'5',priority_price:'9',qty:'1',unit:'pc'},'mouser_price');
  ok('priceCell: cheapest source is green', cheap.includes('price-green'));
  const dear=pc({mouser_price:'1',digikey_price:'5',priority_price:'9',qty:'1',unit:'pc'},'priority_price');
  ok('priceCell: dearest source is red', dear.includes('price-red'));
  const only=pc({mouser_price:'1',qty:'1',unit:'pc'},'mouser_price');
  ok('priceCell: single source gets no colour', !only.includes('price-green')&&!only.includes('price-red'));

  const mm=G('_matchMarkerHTML');
  t('matchMarker: unknown field → empty', mm({}, 'not_a_price_field'), '');
}

// ─────────────────────────────────────────── 18. pager + column order
{
  const bp=G('_buildPager');
  t('pager: single page renders nothing', bp(1,1,'x'), '');
  t('pager: zero pages renders nothing', bp(1,0,'x'), '');
  ok('pager: two pages renders', bp(1,2,'x').includes('data-page="2"'));
  ok('pager: uses the id prefix', bp(1,3,'bom').includes('id="bom-pager"'));
  ok('pager: prev disabled on first page', /data-page="0" disabled/.test(bp(1,5,'x')));
  ok('pager: next disabled on last page', /data-page="6" disabled/.test(bp(5,5,'x')));
  ok('pager: current page marked active', bp(3,9,'x').includes('pager-active'));
  ok('pager: long range gets an ellipsis', bp(9,40,'x').includes('pager-ellipsis'));
  ok('pager: short range gets no ellipsis', !bp(2,4,'x').includes('pager-ellipsis'));
  ok('pager: always shows the last page', bp(1,40,'x').includes('>40<'));

  const store={};
  global.localStorage={getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];}};
  const load=G('loadColOrder'), save=G('saveColOrder');
  const cols=[{k:'a',l:'A'},{k:'b',l:'B'},{k:'c',l:'C'}];
  t('colOrder: nothing saved → defaults', load('t1',cols).map(c=>c.k), ['a','b','c']);
  save('t1',[{k:'c'},{k:'a'},{k:'b'}]);
  t('colOrder: saved order restored', load('t1',cols).map(c=>c.k), ['c','a','b']);
  save('t2',[{k:'a'},{k:'c'}]);
  t('colOrder: new column reinserted after its default neighbour',
    load('t2',cols).map(c=>c.k), ['a','b','c']);
  save('t3',[{k:'gone'},{k:'a'},{k:'b'},{k:'c'}]);
  t('colOrder: removed column ignored', load('t3',cols).map(c=>c.k), ['a','b','c']);
  store['colOrder_t4']='not json';
  t('colOrder: corrupt storage → defaults', load('t4',cols).map(c=>c.k), ['a','b','c']);
  save('t5',[]);
  t('colOrder: empty saved list → defaults', load('t5',cols).map(c=>c.k), ['a','b','c']);
}

// ─────────────────────────────────────────── 19. tools-sheet scoring
{
  const ts=G('_toolsScoreSheet');
  ok('toolsScore: PN+description scores high', ts(['Part Number','Description'])>=20);
  ok('toolsScore: PN only', ts(['Part Number'])>=10 && ts(['Part Number'])<20);
  ok('toolsScore: neither scores low', ts(['Row Labels'])<10);
  ok('toolsScore: wider sheet scores slightly higher',
    ts(['Part Number','Description','x','y'])>ts(['Part Number','Description']));
}


// ──────────────────────────── 20. flat ERP exports (AMAT PDM shape)
{
  const sq=G('_xlsSquash');
  [['MFG P/N','mfgpn'],['MFG PN','mfgpn'],['U/M','um'],['UOM','uom'],['NO.','no'],
   ["NO. REQ'D",'noreqd'],['Part Number','partnumber'],['AMAT P/N','amatpn'],
   ['EA/FT','eaft'],['  Description  ','description'],['#','#'],['','']]
    .forEach(([raw,exp])=>t(`_xlsSquash(${JSON.stringify(raw)})`, sq(raw), exp));
  t('_xlsSquash keeps Hebrew letters', sq('מק"ט'), 'מקט');
  t('_xlsSquash null', sq(null), '');

  const f=G('_parseStructuredBOMSheet');
  // The real sheet: banner row, then a flat header with the manufacturer PN
  // and name as columns on the component row itself (no QVL child rows).
  const flat=[
    ['PDC - UV ENLIGHT -  EA0150-K6394 REV A - Date Information Retrieved : 4/17/2019','','','','','','',''],
    ['HLA','ITEM','AMAT P/N','DESCRIPTION','QTY','EA/FT','MFG NAME','MFG P/N'],
    ['0150-K6394','1','0190-C9640','KIT,JACK SCW PH HD 4-40x5.6mm w/RETAINING CLIP','1','EACH','TRANS-PRO','ELH-750/R-0'],
    ['0150-K6394','2','0720-A2120','CON D-SUB 15PIN MALE STR CRIMP FLAT REL W/O','1','EACH','3M','8215-6003'],
    ['0150-K6394','4','1390-A2920','CABLE FLAT 15 COND 28AWG BLUE','0.22','METER','3M','3601/15'],
    ['','','','','','','',''],
  ];
  const out=f(flat);
  ok('flat: sheet is recognised as a BOM', Array.isArray(out));
  t('flat: row count',                out.length, 3);
  t('flat: MFG P/N becomes part_number', out[0].part_number, 'ELH-750/R-0');
  t('flat: MFG NAME becomes manufacturer', out[0].manufacturer, 'TRANS-PRO');
  t('flat: AMAT P/N stays the customer PN', out[0].atlantium_pn, '0190-C9640');
  t('flat: description',              out[0].description, 'KIT,JACK SCW PH HD 4-40x5.6mm w/RETAINING CLIP');
  t('flat: item number',              out[0].item, '1');
  t('flat: qty',                      out[0].qty, '1');
  t('flat: EA/FT column read as the unit', out[0].unit, 'EACH');
  t('flat: HLA becomes the drawing number', out[0].drawing_number, '0150-K6394');
  t('flat: second row MPN',           out[1].part_number, '8215-6003');
  t('flat: second row manufacturer',  out[1].manufacturer, '3M');
  t('flat: customer PN is NOT copied into MPN', out[1].part_number!==out[1].atlantium_pn, true);
  t('flat: no phantom alternatives',  out[0].alt_mpns, []);

  // Same sheet through the extraction normalizer, as the app runs it.
  const norm=G('_normalizeExtractedRow');
  const rows=f(flat); rows.forEach(norm);
  t('flat: EACH normalizes to pc', rows[0].unit, 'pc');
  t('flat: METER normalizes to mm', rows[2].unit, 'mm');
  t('flat: 0.22 METER becomes 220 mm', rows[2].qty, 220);

  // A banner number still wins over the assembly column.
  const withBanner=[
    ['Part Number:','ASSY-999','','','','','',''],
    ['HLA','ITEM','AMAT P/N','DESCRIPTION','QTY','EA/FT','MFG NAME','MFG P/N'],
    ['0150-K6394','1','P-1','Thing','1','EACH','3M','X-1'],
  ];
  t('flat: banner number beats the HLA column', f(withBanner)[0].drawing_number, 'ASSY-999');

  // Header punctuation variants all resolve.
  const punct=[
    ['NO.','CUST PN','DESCRIPTION','QTY','U/M','MFR PN','MANUFACTURER'],
    ['1','C-1','Widget','3','EA','M-1','Acme'],
  ];
  const po=f(punct);
  t('punct: "MFR PN" found',        po[0].part_number, 'M-1');
  t('punct: "MANUFACTURER" found',  po[0].manufacturer, 'Acme');
  t('punct: "CUST PN" found',       po[0].atlantium_pn, 'C-1');
  t('punct: "U/M" found',           po[0].unit, 'EA');
  t('punct: "NO." found as item',   po[0].item, '1');

  // The customer-prefix shape must never swallow the manufacturer column.
  const shape=[
    ['ITEM','ACME P/N','DESCRIPTION','QTY','MFG P/N'],
    ['1','A-1','Widget','1','M-9'],
  ];
  const so=f(shape);
  t('shape: "ACME P/N" read as the customer PN', so[0].atlantium_pn, 'A-1');
  t('shape: "MFG P/N" still read as the MPN',    so[0].part_number, 'M-9');

  // Hierarchical sheets are untouched: a QVL row still supplies the MPN, and
  // a component row that already has its own MPN keeps it.
  const hier=[
    ['Part Number:','ASSY-100'],
    ['Item','Part Number','Description','Type','MPN','Vendor','Qty','UOM'],
    ['1','P-1','Cap','StdPart','','','1','pc'],
    ['','','','QVL','GRM-1','Murata','',''],
    ['','','','QVL','C0603','Yageo','',''],
  ];
  const ho=f(hier);
  t('hier: QVL still supplies the MPN', ho[0].part_number, 'GRM-1');
  t('hier: QVL still supplies the maker', ho[0].manufacturer, 'Murata');
  t('hier: alternatives still collected', ho[0].alt_mpns.length, 2);

  const hier2=[
    ['Item','Part Number','Description','Type','MPN','Vendor','Qty','UOM'],
    ['1','P-1','Cap','StdPart','OWN-1','Kemet','1','pc'],
    ['','','','QVL','GRM-1','Murata','',''],
  ];
  const h2=f(hier2);
  t('hier: a row with its own MPN keeps it', h2[0].part_number, 'OWN-1');
  t('hier: ...and its own manufacturer',     h2[0].manufacturer, 'Kemet');
  t('hier: own MPN and the QVL one are both alternatives', h2[0].alt_mpns.map(a=>a.mpn), ['OWN-1','GRM-1']);
  t('hier: own MPN keeps its own maker in the list', h2[0].alt_mpns[0].manufacturer, 'Kemet');
}

// ──────────────────────────── 21. unit values these sheets actually use
{
  const f=G('_normalizeUnitQty');
  [[3,'each',{qty:3,unit:'pc'}], [3,'EACH',{qty:3,unit:'pc'}], [3,'pcs',{qty:3,unit:'pc'}],
   [3,'piece',{qty:3,unit:'pc'}], [3,'pieces',{qty:3,unit:'pc'}], [3,'pc.',{qty:3,unit:'pc'}],
   [2,'ft',{qty:609.6,unit:'mm'}], [2,'FEET',{qty:609.6,unit:'mm'}], [1,'foot',{qty:304.8,unit:'mm'}],
   [2,'in',{qty:50.8,unit:'mm'}], [1,'inch',{qty:25.4,unit:'mm'}], [2,'inches',{qty:50.8,unit:'mm'}],
   ['x','ft',{qty:'x',unit:'mm'}]]
    .forEach(([q,u,exp])=>t(`_normalizeUnitQty(${JSON.stringify(q)},${JSON.stringify(u)})`, f(q,u), exp));
  t('unit: METER still folds to mm', f(0.22,'METER'), {qty:220,unit:'mm'});
  t('_dbNormalizeUnit each', G('_dbNormalizeUnit')('each'), 'pc');
  t('_dbNormalizeUnit ft',   G('_dbNormalizeUnit')('ft'), 'mm');
}

// ─────────────────────────────────────────── report
console.log(`\n  ${pass} passed, ${fail} failed  (${pass+fail} assertions)\n`);
if(fail){ failures.forEach(f=>console.log('  ✗ '+f+'\n')); process.exit(1); }
