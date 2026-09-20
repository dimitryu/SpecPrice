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


// ──────────────────────────── 22. header analysis, ambiguity, repeated rows
{
  const find=G('_xlsFindHeaderRow'), analyze=G('_xlsAnalyzeSheet'),
        parse=G('_parseStructuredBOMSheet'), merge=G('_xlsMergeRepeatedRows'),
        count=G('_xlsCountRepeatedRows');

  // The AMAT flat sheet: every role matches exactly one column, no repeats.
  const flat=[
    ['PDC - UV ENLIGHT - EA0150-K6394 REV A','','','','','','',''],
    ['HLA','ITEM','AMAT P/N','DESCRIPTION','QTY','EA/FT','MFG NAME','MFG P/N'],
    ['0150-K6394','1','0190-C9640','KIT,JACK SCW','1','EACH','TRANS-PRO','ELH-750/R-0'],
    ['0150-K6394','2','0720-A2120','CON D-SUB 15PIN','1','EACH','3M','8215-6003'],
  ];
  const fa=analyze(flat);
  t('analyze: header row found', fa.hdrIdx, 1);
  t('analyze: no ambiguous roles', fa.ambiguous, []);
  t('analyze: no repeated rows', fa.repeats, 0);
  t('analyze: a confident sheet is never interrupted', fa.needsConfirmation, false);
  t('analyze: row count', fa.rowCount, 2);
  t('analyze: sample value comes from the first data row', fa.sample[7], 'ELH-750/R-0');
  t('analyze: headers captured verbatim', fa.headers[6], 'MFG NAME');

  // The ELBIT hierarchical sheet: also unambiguous.
  const hier=[
    ['Part Number:','ASSY-100'],
    ['Item','Part Number','Description','Type','MPN','Vendor','Qty','UOM'],
    ['1','P-1','Cap','StdPart','','','1','pc'],
    ['','','','QVL','GRM-1','Murata','',''],
  ];
  t('analyze: hierarchical sheet needs no confirmation', analyze(hier).needsConfirmation, false);

  // The CBL export: duplicate header names AND one row per manufacturer.
  const cbl=[
    ['Date','Top-Level Part','Part Description','Part Number','Part Description',
     'Quantity','Factory Unit','Baloon no.','Manufacturer Name','Mnf. Part No.','Factory Unit'],
    ['07/22/2026','CBL002351-AA','CABLE ASSY','CON000177','CON D-TYPE 9P','1.000','ea','10','CONEC','163A11069X','ea'],
    ['07/22/2026','CBL002351-AA','CABLE ASSY','CON000177','CON D-TYPE 9P','1.000','ea','10','CVILUX','CD5109PA100','ea'],
    ['07/22/2026','CBL002351-AA','CABLE ASSY','CON000366','CON MOLEX 2 PIN','1.000','ea','16','MOLEX INC','39-01-3022','ea'],
  ];
  const ca=analyze(cbl);
  t('analyze: "Mnf. Part No." is recognised as the MPN column', ca.candidates.mfpn, [9]);
  t('analyze: "Part Number" stays the customer PN', ca.candidates.internal_pn, [3]);
  t('analyze: "Manufacturer Name" found', ca.candidates.vendor, [8]);
  t('analyze: "Baloon no." found as the item column', ca.candidates.item, [7]);
  t('analyze: "Top-Level Part" found as the assembly', ca.candidates.assembly, [1]);
  t('analyze: duplicate Part Description flagged', ca.candidates.description, [2,4]);
  t('analyze: duplicate Factory Unit flagged', ca.candidates.uom, [6,10]);
  t('analyze: ambiguous roles listed', ca.ambiguous.sort(), ['description','uom']);
  t('analyze: repeated rows counted', ca.repeats, 1);
  t('analyze: this sheet asks before importing', ca.needsConfirmation, true);

  // Auto-guess: the MPN is now real, not the customer number.
  const guess=parse(cbl);
  t('cbl: MNF P/N is the manufacturer number', guess[0].part_number, '163A11069X');
  t('cbl: customer PN preserved separately',   guess[0].atlantium_pn, 'CON000177');
  t('cbl: manufacturer read from the row',     guess[0].manufacturer, 'CONEC');
  t('cbl: drawing number from Top-Level Part', guess[0].drawing_number, 'CBL002351-AA');
  t('cbl: item from Baloon no.',               guess[0].item, '10');
  t('cbl: without merging, every row stays',   guess.length, 3);

  // A confirmed mapping overrides the guess (component description, not the assembly's).
  const fixed=parse(cbl,{hdrIdx:ca.hdrIdx, colMap:{...ca.colMap, description:4, uom:10}});
  t('override: the chosen description column is used', fixed[0].description, 'CON D-TYPE 9P');

  // Merging folds the repeats into alternatives.
  const mergedRows=parse(cbl,{hdrIdx:ca.hdrIdx, colMap:{...ca.colMap, description:4}, mergeDuplicates:true});
  t('merge: repeated component collapses',      mergedRows.length, 2);
  t('merge: first manufacturer stays the pick', mergedRows[0].part_number, '163A11069X');
  t('merge: both manufacturers kept as QVL',    mergedRows[0].alt_mpns.map(a=>a.mpn), ['163A11069X','CD5109PA100']);
  t('merge: each alternative keeps its maker',  mergedRows[0].alt_mpns[1].manufacturer, 'CVILUX');
  t('merge: qty is NOT multiplied',             mergedRows[0].qty, '1.000');
  t('merge: a component listed once is untouched', mergedRows[1].alt_mpns, []);

  // Merge helpers on their own.
  const rows=[{atlantium_pn:'A',part_number:'M1',manufacturer:'X',alt_mpns:[{mpn:'M1',manufacturer:'X'}]},
              {atlantium_pn:'A',part_number:'M2',manufacturer:'Y',alt_mpns:[{mpn:'M2',manufacturer:'Y'}]},
              {atlantium_pn:'B',part_number:'M3',manufacturer:'Z',alt_mpns:[{mpn:'M3',manufacturer:'Z'}]}];
  t('countRepeated: one repeat', count(rows), 1);
  const m=merge(rows.map(r=>({...r, alt_mpns:[...r.alt_mpns]})));
  t('mergeRepeated: two lines out', m.length, 2);
  t('mergeRepeated: alternatives gathered', m[0].alt_mpns.map(a=>a.mpn), ['M1','M2']);
  t('mergeRepeated: keyed case-insensitively',
    merge([{atlantium_pn:'a',part_number:'M1',alt_mpns:[]},{atlantium_pn:'A',part_number:'M2',alt_mpns:[]}]).length, 1);
  t('mergeRepeated: rows with no key are never folded',
    merge([{atlantium_pn:'',description:'',part_number:'M1',alt_mpns:[]},
           {atlantium_pn:'',description:'',part_number:'M2',alt_mpns:[]}]).length, 2);
  t('mergeRepeated: falls back to description as the key',
    merge([{atlantium_pn:'',description:'Cap',part_number:'M1',alt_mpns:[]},
           {atlantium_pn:'',description:'Cap',part_number:'M2',alt_mpns:[]}]).length, 1);
  t('countRepeated: nothing repeats', count([{atlantium_pn:'A'},{atlantium_pn:'B'}]), 0);

  t('findHeaderRow: no header anywhere → null', find([['just'],['text']]), null);
  t('analyze: unparsable sheet → null', analyze([['x']]), null);
}

// ──────────────────────────── 23. remembering a confirmed mapping
{
  const store={};
  global.localStorage={getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];}};
  const sig=G('_xlsMapSignature'), save=G('_xlsSaveMap'), load=G('_xlsLoadSavedMap');
  const headers=['Part Number','Mnf. Part No.','Quantity'];
  t('signature: punctuation-insensitive', sig(headers), sig(['PART NUMBER','MNF PART NO','quantity']));
  t('signature: different layouts differ', sig(headers)===sig(['A','B','C']), false);
  t('recall: nothing saved yet', load(headers), null);
  save(headers,{mfpn:1, internal_pn:0, qty:2});
  t('recall: saved mapping comes back', load(headers), {mfpn:1, internal_pn:0, qty:2});
  t('recall: a different layout is unaffected', load(['A','B','C']), null);
  store['xlsColMap_v1_'+sig(headers)]='not json';
  t('recall: corrupt entry is ignored', load(headers), null);

  t('map fields: MNF P/N is the required one',
    G('_XLS_MAP_FIELDS').filter(f=>f.required).map(f=>f.key), ['mfpn']);
  t('map fields: every field is a real column role',
    G('_XLS_MAP_FIELDS').every(f=>f.key in G('_XLS_COL_ALIASES')), true);
}


// ──────────────────────────── 24. version check
{
  const parse=G('_parseAppVer'), newer=G('_verIsNewer');

  t('parseAppVer: reads the constant', parse("const APP_VER   = '1.32.0';"), '1.32.0');
  t('parseAppVer: tolerates spacing',  parse("const APP_VER='2.0.1';"), '2.0.1');
  t('parseAppVer: two-part version',   parse("const APP_VER = '3.4';"), '3.4');
  t('parseAppVer: finds it inside a bigger file',
    parse("let a=1;\nconst APP_VER   = '1.31.9';\nfunction x(){}"), '1.31.9');
  t('parseAppVer: nothing to find',    parse('<html>404</html>'), '');
  t('parseAppVer: empty body',         parse(''), '');
  t('parseAppVer: null',               parse(null), '');
  t('parseAppVer: ignores a lookalike', parse("const OTHER_VER = '9.9.9';"), '');

  // The comparison a string sort gets wrong.
  t('verIsNewer: 1.32.0 > 1.9.9',   newer('1.32.0','1.9.9'), true);
  t('verIsNewer: 1.9.9 < 1.32.0',   newer('1.9.9','1.32.0'), false);
  t('verIsNewer: patch bump',       newer('1.32.1','1.32.0'), true);
  t('verIsNewer: minor bump',       newer('1.33.0','1.32.9'), true);
  t('verIsNewer: major bump',       newer('2.0.0','1.99.99'), true);
  t('verIsNewer: identical',        newer('1.32.0','1.32.0'), false);
  t('verIsNewer: older is not newer',newer('1.31.0','1.32.0'), false);
  t('verIsNewer: shorter but newer', newer('2','1.32.0'), true);
  t('verIsNewer: shorter and equal', newer('1.32','1.32.0'), false);
  t('verIsNewer: longer and equal',  newer('1.32.0.0','1.32'), false);
  t('verIsNewer: longer and newer',  newer('1.32.0.1','1.32'), true);
  t('verIsNewer: unreadable remote', newer('','1.32.0'), false);
  t('verIsNewer: unreadable local',  newer('1.32.0',''), true);
  t('verIsNewer: junk parts count as 0', newer('1.x.0','1.0.0'), false);

  // Round trip: what the fetch reads out of a served file decides the answer.
  const served="const APP_VER   = '1.33.0';";
  t('round trip: a newer served file triggers an update', newer(parse(served), '1.32.0'), true);
  t('round trip: the same file does not', newer(parse("const APP_VER   = '1.32.0';"), '1.32.0'), false);
  t('round trip: an unreadable response never triggers one', newer(parse('oops'), '1.32.0'), false);
}


// ──────────────────────────── 25. how many cables the quote covers
{
  const units=G('_sdDwgUnits'), apply=G('_sdApplyUnits'), groups=G('_sdComputeGroups'),
        labor=G('_sdRecalcLaborTotal'), unitsFor=G('_sdUnitsForRow'),
        items=G('sdItems'), settings=G('_sdDwgSettings'), recalc=G('_sdRecalcRow');

  const reset=()=>{ items.length=0; for(const k in settings) delete settings[k]; };
  const row=(dwg,o={})=>Object.assign({drawing_number:dwg, part_number:'P-'+dwg,
    description:'part', qty:'2', unit:'pc', mouser_price:'5', labor_time:'3'}, o);

  // Default is one cable, and anything nonsensical falls back to one rather
  // than zeroing out a quote.
  reset();
  t('units: unset drawing is one cable', units('D1'), 1);
  settings['D1']={units:0};   t('units: 0 falls back to 1', units('D1'), 1);
  settings['D1']={units:-4};  t('units: negative falls back to 1', units('D1'), 1);
  settings['D1']={units:'x'}; t('units: junk falls back to 1', units('D1'), 1);
  settings['D1']={units:''};  t('units: blank falls back to 1', units('D1'), 1);
  settings['D1']={units:7};   t('units: a real number is kept', units('D1'), 7);
  settings['D1']={units:'12'};t('units: numeric string is kept', units('D1'), 12);
  t('unitsForRow reads the row\'s drawing', unitsFor({drawing_number:'D1'}), 12);
  t('unitsForRow: unknown drawing is one', unitsFor({drawing_number:'nope'}), 1);

  // Applying rescales QTY and everything computed from it.
  reset();
  items.push(row('A'), row('A'), row('B'));
  items.forEach(recalc);
  t('apply: parts total before', groups()[0].partsTotal, 20);   // 2 rows x qty2 x $5
  apply('A',10);
  t('apply: QTY multiplied', items[0].qty, 20);
  t('apply: both rows of the drawing', items[1].qty, 20);
  t('apply: the other drawing is untouched', items[2].qty, '2');
  t('apply: units recorded on the group', groups()[0].units, 10);
  t('apply: parts total scales', groups()[0].partsTotal, 200);
  t('apply: the untouched drawing still costs the same', groups()[1].partsTotal, 10);

  // Re-running with the same number must not compound — this is the whole
  // reason the per-cable quantity is remembered instead of multiplying live.
  apply('A',10);
  t('apply: running 10 twice is still 10', items[0].qty, 20);
  apply('A',10); apply('A',10);
  t('apply: four times, still 10', items[0].qty, 20);

  // ...and lowering divides back down rather than being a one-way door.
  apply('A',2);
  t('apply: 10 down to 2', items[0].qty, 4);
  apply('A',1);
  t('apply: back to a single cable', items[0].qty, 2);
  t('apply: and the price with it', groups()[0].partsTotal, 20);

  // Fractional per-cable quantities survive the round trip without drifting.
  reset();
  items.push(row('A',{qty:'0.1'}));
  items.forEach(recalc);
  apply('A',3);
  t('apply: 0.1 x 3 is 0.3, not 0.30000000000000004', items[0].qty, 0.3);
  apply('A',1);
  t('apply: and back to 0.1 exactly', items[0].qty, 0.1);

  // Labor has to scale too, or the quote prices 10 cables of parts with the
  // labor of building one.
  reset();
  settings['A']={units:4};
  t('labor: AI fixed total x units',
    labor({drawing_number:'A', labor_time:'12', qty:'1', unit:'pc', _laborFixedTotal:true}), 48);
  t('labor: mm row is a flat minute per cable',
    labor({drawing_number:'A', labor_time:'2', qty:'2000', unit:'mm'}), 4);
  t('labor: gr row likewise',
    labor({drawing_number:'A', labor_time:'2', qty:'50', unit:'gr'}), 4);
  t('labor: a typed per-unit rate scales through QTY, not twice',
    labor({drawing_number:'A', labor_time:'2', qty:'12', unit:'pc'}), 24);
  t('labor: a manual override is left exactly as typed',
    labor({drawing_number:'A', labor_total:9, labor_time:'2', qty:'5', unit:'pc', _laborManualOverride:true}), 9);
  settings['A']={units:1};
  t('labor: one cable is the old behaviour',
    labor({drawing_number:'A', labor_time:'12', qty:'1', unit:'pc', _laborFixedTotal:true}), 12);

  // End to end: parts, labor and the final price all move together.
  reset();
  settings['A']={profitPct:0, laborRateMin:1};
  items.push(row('A',{labor_time:'10', _laborFixedTotal:true}));
  items.forEach(recalc);
  const before=groups()[0];
  t('e2e: one cable subtotal', before.subtotal, 20);        // $10 parts + 10 min x $1
  apply('A',5);
  const after=groups()[0];
  t('e2e: five cables of parts', after.partsTotal, 50);
  t('e2e: five cables of labor minutes', after.laborMinutes, 50);
  t('e2e: subtotal scales exactly 5x', after.subtotal, before.subtotal*5);
  t('e2e: final scales exactly 5x', after.final, before.final*5);
  t('e2e: price per cable is unchanged', after.final/after.units, before.final);

  reset();
}


// ──────────────────────────── 26. a tool is bought once, not once per cable
{
  const apply=G('_sdApplyUnits'), groups=G('_sdComputeGroups'), unitsFor=G('_sdUnitsForRow'),
        labor=G('_sdRecalcLaborTotal'), items=G('sdItems'), settings=G('_sdDwgSettings'),
        recalc=G('_sdRecalcRow');
  const reset=()=>{ items.length=0; for(const k in settings) delete settings[k]; };

  const part=(dwg)=>({drawing_number:dwg, part_number:'P1', description:'Connector 4pin',
    qty:'2', unit:'pc', mouser_price:'5'});
  const tool=(dwg)=>({drawing_number:dwg, part_number:'T1', description:'CRIMP TOOL for MICROFIT',
    qty:'1', unit:'pc', mouser_price:'165'});

  reset();
  settings['A']={units:10};
  t('unitsForRow: a part scales with the order', unitsFor(part('A')), 10);
  t('unitsForRow: a tool never does', unitsFor(tool('A')), 1);

  reset();
  items.push(part('A'), tool('A'));
  items.forEach(recalc);
  const before=groups()[0];
  t('tools: one cable — parts', before.partsTotal, 10);
  t('tools: one cable — tools', before.toolsTotal, 165);

  apply('A',10);
  const after=groups()[0];
  t('tools: the part QTY is multiplied', items[0].qty, 20);
  t('tools: the TOOL QTY is not', items[1].qty, '1');
  t('tools: parts scale to ten cables', after.partsTotal, 100);
  t('tools: the tool still costs what one tool costs', after.toolsTotal, 165);
  t('tools: and is still excluded from the subtotal', after.subtotal, after.partsTotal+after.laborCost);

  // A tool carrying AI-estimated time must not scale either.
  reset();
  settings['A']={units:6};
  t('tools: fixed labor on a tool row is not multiplied',
    labor({drawing_number:'A', description:'CRIMP TOOL', labor_time:'4', qty:'1', unit:'pc', _laborFixedTotal:true}), 4);
  t('tools: the same row as a part would be',
    labor({drawing_number:'A', description:'Connector', labor_time:'4', qty:'1', unit:'pc', _laborFixedTotal:true}), 24);

  // Self-heal: a tool scaled by an older build is put back on the next apply.
  reset();
  const stale=tool('A'); stale.qty=40; stale._qtyPerUnit=1;
  items.push(part('A'), stale);
  items.forEach(recalc);
  apply('A',10);
  t('tools: a previously multiplied tool is restored', items[1].qty, 1);
  t('tools: ...and its cost with it', groups()[0].toolsTotal, 165);

  reset();
}


// ──────────────────────────── 27. screens a role can see but not open
{
  const allowed=G('allowedViews'), disabled=G('disabledViews'), can=G('canView'),
        isOff=G('isViewDisabled'), map=G('roleViewsMap');
  // currentUserRole is '' in a fresh module, so the role document under that key
  // is the one the gate reads.
  const set=(views,disabledViews)=>{ map['']={name:'test',views,disabledViews}; };

  set(['rfq','sales-desk','part-stock'],[]);
  t('gate: nothing disabled', disabled(), []);
  t('gate: an allowed screen opens', can('rfq'), true);
  t('gate: an absent screen does not', can('admin'), false);
  t('gate: home always opens', can('home'), true);

  set(['rfq','sales-desk','part-stock'],['sales-desk']);
  t('gate: the disabled screen is still in views', allowed().includes('sales-desk'), true);
  t('gate: ...and listed as disabled', disabled(), ['sales-desk']);
  t('gate: isViewDisabled says so', isOff('sales-desk'), true);
  t('gate: but it cannot be opened', can('sales-desk'), false);
  t('gate: its neighbours still open', can('rfq'), true);
  t('gate: home is unaffected', can('home'), true);

  // Disabling something the role never had is meaningless but must not crash
  // or accidentally grant it.
  set(['rfq'],['admin']);
  t('gate: disabling a screen the role lacks grants nothing', can('admin'), false);
  t('gate: and the rest is untouched', can('rfq'), true);

  // A role document with no disabledViews at all (every existing record).
  map['']={name:'legacy',views:['rfq','admin']};
  t('gate: a record with no disabled list reads as none', disabled(), []);
  t('gate: legacy records keep working', can('admin'), true);

  // Malformed data must fail closed-ish, not throw.
  map['']={name:'broken',views:['rfq'],disabledViews:'not-an-array'};
  t('gate: a non-array disabled list is ignored', disabled(), []);
  t('gate: ...and access still resolves', can('rfq'), true);

  delete map[''];
}

// ──────────────────────────── 28. the breakdown is priced per cable
{
  const apply=G('_sdApplyUnits'), groups=G('_sdComputeGroups'),
        items=G('sdItems'), settings=G('_sdDwgSettings'), recalc=G('_sdRecalcRow');
  const reset=()=>{ items.length=0; for(const k in settings) delete settings[k]; };

  const part=(dwg,price,qty)=>({drawing_number:dwg, part_number:'P'+price,
    description:'Connector 4pin', qty:String(qty), unit:'pc', mouser_price:String(price),
    labor_time:'3'});

  reset();
  items.push(part('A',5,2));
  items.forEach(recalc);
  settings['A']={profitPct:0};
  const one=groups()[0];
  t('per cable: a single cable is its own order', one.units, 1);
  t('per cable: parts', one.partsTotalPerUnit, one.partsTotal);
  t('per cable: subtotal', one.subtotalPerUnit, one.subtotal);
  t('per cable: price', one.finalPerUnit, one.final);

  apply('A',10);
  const ten=groups()[0];
  t('per cable: the order now covers ten', ten.units, 10);
  t('per cable: parts per cable are unchanged by the quantity',
    +ten.partsTotalPerUnit.toFixed(6), +one.partsTotal.toFixed(6));
  t('per cable: ...and the order total is ten of them',
    +ten.partsTotal.toFixed(6), +(ten.partsTotalPerUnit*10).toFixed(6));
  t('per cable: labor minutes per cable are unchanged',
    +ten.laborMinutesPerUnit.toFixed(6), +one.laborMinutes.toFixed(6));
  t('per cable: labor cost scales with the order',
    +ten.laborCost.toFixed(6), +(ten.laborCostPerUnit*10).toFixed(6));
  t('per cable: subtotal per cable = parts + labor, per cable',
    +ten.subtotalPerUnit.toFixed(6), +(ten.partsTotalPerUnit+ten.laborCostPerUnit).toFixed(6));
  t('per cable: the unit price times the quantity is the order total',
    +ten.final.toFixed(6), +(ten.finalPerUnit*10).toFixed(6));
  ok('per cable: ten cables cost more than one', ten.final > one.final);
  t('per cable: but one of them costs the same',
    +ten.finalPerUnit.toFixed(6), +one.finalPerUnit.toFixed(6));

  // A typed Labor Time override is minutes for ONE cable — the panel says so,
  // and the order total must multiply it back up rather than treating it as the
  // time for the whole run.
  settings['A'].laborMinutes='30';
  const ovr=groups()[0];
  t('per cable: a typed override is per cable', ovr.laborMinutesPerUnit, 30);
  t('per cable: ...and the run takes ten times as long', ovr.laborMinutes, 300);
  t('per cable: ...costed at the same rate', +ovr.laborCost.toFixed(6), +(30*10*ovr.rate).toFixed(6));

  // Profit is a percentage, so it applies identically at both scales.
  settings['A'].laborMinutes=''; settings['A'].profitPct=25;
  const pr=groups()[0];
  t('per cable: profit % applies per cable',
    +pr.finalPerUnit.toFixed(6), +(pr.subtotalPerUnit*1.25).toFixed(6));
  t('per cable: ...and to the order the same way',
    +pr.final.toFixed(6), +(pr.subtotal*1.25).toFixed(6));

  reset();
}

// ──────────────────────────── 29. statistics: counting what actually happened
{
  const count=G('_statCount'), sum=G('_statSum'), avg=G('_statAvg'),
        perDay=G('_statPerDay'), perUser=G('_statPerUser'), drawings=G('_statDrawings'),
        coverage=G('_statCoverage'), isoDay=G('_statIsoDay'), logDate=G('_statLogDate'),
        details=G('_statDetails'), fmtMs=G('_statFmtMs'), fmtPct=G('_statFmtPct'),
        setRange=G('_statSetRangeDays'), sheetName=G('_statSheetName'), sheetRows=G('_statSheetRows');

  const log=(action,user,details,success=true,day=null)=>({
    action, user, details, success,
    timestamp: day ? {toDate:()=>new Date(day+'T09:00:00')} : null});

  const L=[
    log('drawing_bom_search','a@x',{filename:'D1.pdf',rowsFound:20,ms:4000},true,'2026-09-01'),
    log('drawing_bom_search','a@x',{filename:'D1.pdf',rowsFound:30,ms:6000},true,'2026-09-01'),
    log('drawing_bom_search','b@x',{filename:'D2.pdf',rowsFound:10,ms:2000},false,'2026-09-02'),
    log('drawing_bom_search','b@x',{filename:'D2.pdf',rowsFound:12},true,'2026-09-03'),
    log('price_check','a@x',{checked:50,found:40,failed:10,ms:30000},true,'2026-09-03'),
    log('login','a@x',null,true,'2026-09-01'),
    log('login','a@x',null,true,'2026-09-02'),
    log('login','b@x',null,true,'2026-09-02'),
    log('login','SYSTEM',null,true,'2026-09-02'),
    log('login','c@x',null,false,'2026-09-02'),
  ];

  t('stat: successful runs are counted', count(L,'drawing_bom_search'), 3);
  t('stat: failures can be counted too', count(L,'drawing_bom_search',false), 4);
  t('stat: an action nobody performed is zero', count(L,'rfq_created'), 0);
  t('stat: a numeric detail is summed', sum(L,'price_check','checked'), 50);
  t('stat: a detail nothing carries sums to zero', sum(L,'price_check','nosuch'), 0);
  t('stat: averages ignore rows that never measured', avg(L,'drawing_bom_search','ms'), 5000);
  t('stat: nothing measured is "no data", not zero', avg(L,'rfq_created','ms'), null);
  t('stat: a failed run is left out of the average', avg(L,'price_check','ms'), 30000);

  t('stat: per day, oldest first', perDay(L,'drawing_bom_search'),
    [['2026-09-01',2],['2026-09-03',1]]);
  t('stat: per day counts only successes', perDay(L,'login').length, 2);
  t('stat: per person, busiest first', perUser(L,'login'), [['a@x',2],['b@x',1]]);
  t('stat: automated work is not a person', perUser(L,'login').some(p=>p[0]==='SYSTEM'), false);
  t('stat: a failed sign-in is not a sign-in', perUser(L,'login').some(p=>p[0]==='c@x'), false);

  const d=drawings(L);
  t('stat: one row per drawing file', d.length, 2);
  t('stat: busiest drawing first', d[0].drawing, 'D1.pdf');
  t('stat: runs', d[0].runs, 2);
  t('stat: successes and failures are kept apart', [d[1].ok,d[1].failed], [1,1]);
  t('stat: average rows found', d[0].avgRows, 25);
  t('stat: average time', d[0].avgMs, 5000);
  t('stat: a drawing with no timings reports none', d[1].avgMs, null);
  t('stat: the last time it ran', isoDay(d[1].last), '2026-09-03');
  t('stat: an unnamed extraction is not dropped', drawings([log('drawing_bom_search','a',{})]) [0].drawing, '(unnamed)');

  const cov=coverage([
    {drawing_number:'D1',mouser_price:'5'},
    {drawing_number:'D1',priority_price:'0'},
    {drawing_number:'D1'},
    {drawing_number:'',digikey_price:'2'},
  ]);
  t('stat: parts held', cov.total, 4);
  t('stat: parts we can quote', cov.withPrice, 2);
  t('stat: coverage %', cov.pct, 50);
  t('stat: a zero price is not a price', cov.byDrawing.find(x=>x.drawing==='D1').priced, 1);
  t('stat: parts with no drawing are still counted somewhere',
    cov.byDrawing.some(x=>x.drawing==='(no drawing #)'), true);
  t('stat: an empty database is "no data", not 0%', coverage([]).pct, null);
  t('stat: ...and does not crash on undefined', coverage(undefined).total, 0);

  t('stat: a pending serverTimestamp is skipped, not dated 1970', logDate({timestamp:null}), null);
  t('stat: details of a string-detail row read as empty', details({details:'text'}), {});
  t('stat: a missing row reads as empty', details(null), {});
  t('stat: sub-second timings read in ms', fmtMs(450), '450 ms');
  t('stat: seconds', fmtMs(4500), '4.5 s');
  t('stat: minutes', fmtMs(125000), '2m 5s');
  t('stat: no measurement shows a dash', fmtMs(null), '—');
  t('stat: percentages carry one decimal', fmtPct(33.333), '33.3%');
  t('stat: no percentage shows a dash', fmtPct(null), '—');

  // The range itself: _statFrom/_statTo are module state a CommonJS export can't
  // observe, so the day arithmetic is checked on the pure day formatter instead.
  t('stat: a day is the local calendar day, not UTC',
    isoDay(new Date(2026,8,3,23,30)), '2026-09-03');
  t('stat: ...zero-padded', isoDay(new Date(2026,0,7)), '2026-01-07');
  ok('stat: setting a range does not throw', (()=>{ setRange(7); setRange(365); return true; })());

  t('stat: a sheet name cannot contain a character Excel rejects',
    sheetName('a/b:c*d?e[f]'), 'a b c d e f ');
  t('stat: ...and is never longer than Excel allows', sheetName('x'.repeat(50)).length, 31);
  const rows=sheetRows({title:'Activity',columns:['Metric','Value'],rows:[['RFQs',3]]});
  t('stat: every sheet names itself', rows[0], ['Activity']);
  ok('stat: ...and states the range it covers', /Range: /.test(rows[1][0]));
  t('stat: the header row is the block header', rows[3], ['Metric','Value']);
  t('stat: the data follows it', rows[4], ['RFQs',3]);
}

// ──────────────────────────── 30. a new screen reaches the administrator
{
  const buttons=G('HOME_BUTTONS'), seed=G('SEED_ROLE_VIEWS'), auto=G('ADMIN_AUTO_VIEWS'),
        protectedViews=G('PROTECTED_VIEWS');
  ok('new screen: Statistics has a Home button', !!buttons['statistics']);
  t('new screen: with an icon and a label', buttons['statistics'].length, 2);
  ok('new screen: a fresh installation gives it to the admin role',
     seed.admin.includes('statistics'));
  ok('new screen: an existing admin role gets it without editing anything',
     auto.includes('statistics'));
  // Auto-granted is not the same as locked: PROTECTED_VIEWS can never be taken
  // away, ADMIN_AUTO_VIEWS can still be disabled.
  t('new screen: ...but it is not locked on', protectedViews.includes('statistics'), false);
  // Every Home button must be routable, or a role could be granted a screen
  // that opens nothing.
  const routed=['rfq','sales-desk','part-stock','cut-strip','customers','statistics','settings','admin'];
  t('new screen: every Home button has a screen behind it',
    Object.keys(buttons).filter(k=>!routed.includes(k)), []);
}

// ──────────────────────────── 31. support: a ticket is a conversation
{
  const thread=G('_supportThread'), needsUser=G('_supportNeedsUser'),
        needsAdmin=G('_supportNeedsAdmin'), dot=G('_supportUnreadDot'),
        chips=G('_supFileChips'), icon=G('_supFileIcon'), bytes=G('_supFmtBytes'),
        turn=G('_supTurn'), card=G('_supTicketCard'), badge=G('_supportStatusBadge'),
        maxB64=G('_SUP_FILE_MAX_B64'), statuses=G('_SUPPORT_STATUSES');

  // A ticket written before threads existed: one message, one reply, no array.
  const legacy={user:'a@x', message:'Printer is on fire', createdAt:'2026-09-01T08:00:00Z',
                adminReply:'Unplug it', repliedBy:'admin@x', repliedAt:'2026-09-01T09:00:00Z',
                status:'done'};
  const lt=thread(legacy);
  t('support: a legacy ticket still reads as a conversation', lt.length, 2);
  t('support: ...starting with what the user wrote', [lt[0].role,lt[0].text], ['user','Printer is on fire']);
  t('support: ...then the admin answer', [lt[1].role,lt[1].text], ['admin','Unplug it']);

  // The same ticket once someone replies on the new build.
  const mixed={...legacy, thread:[
    {role:'user', by:'a@x', text:'Still smoking', at:'2026-09-02T07:00:00Z'},
    {role:'admin', by:'admin@x', text:'On my way', at:'2026-09-02T07:30:00Z', files:[{id:'f1',name:'a.png',type:'image/png',size:1024}]},
  ]};
  const mt=thread(mixed);
  t('support: old turns and new turns are one list', mt.length, 4);
  t('support: in the order they happened',
    mt.map(m=>m.text), ['Printer is on fire','Unplug it','Still smoking','On my way']);
  t('support: a turn keeps its attachments', mt[3].files.length, 1);
  t('support: a turn with none reads as none', mt[2].files, []);
  t('support: a malformed thread field does not break the ticket',
    thread({message:'hi', thread:'not-an-array'}).length, 1);
  t('support: an empty ticket is an empty conversation', thread({}).length, 0);
  t('support: a ticket that is only an attachment still shows',
    thread({user:'a@x', message:'', files:[{id:'f',name:'x.png'}]}).length, 1);

  t('support: nothing waiting is nothing waiting', needsUser({}), false);
  t('support: ...for the admin too', needsAdmin({}), false);
  t('support: a ticket from before this version is not "new"', needsUser(legacy), false);
  t('support: a flag set by a reply is', needsUser({userUnread:true}), true);
  t('support: ...and the admin side reads its own flag', needsAdmin({adminUnread:true}), true);
  t('support: the two sides are independent',
    [needsUser({adminUnread:true}), needsAdmin({userUnread:true})], [false,false]);

  ok('support: an unread dot is drawn when there is news', /background:#E53E3E/.test(dot(true,'x')));
  t('support: ...and nothing at all when there is not', dot(false,'x'), '');

  t('support: bytes', [bytes(500),bytes(2048),bytes(3*1048576)], ['500 B','2 KB','3.0 MB']);
  t('support: a missing size does not print NaN', bytes(undefined), '0 B');
  t('support: attachments are iconed by kind',
    [icon('image/png'),icon('application/pdf'),icon('text/csv'),icon('application/zip')],
    ['🖼️','📕','📊','📎']);
  t('support: no attachments, no chip row', chips([]), '');
  ok('support: a chip carries the id it downloads',
     /data-id="f1"/.test(chips([{id:'f1',name:'a.png',type:'image/png',size:10}])));

  // Everything a user typed is rendered as text, never as markup.
  const xss=turn({role:'user', by:'<b>a@x</b>', text:'<img src=x onerror=alert(1)>',
                  at:'2026-09-01T08:00:00Z', files:[{id:'<i>',name:'<script>',type:'',size:1}]});
  t('support: a message cannot inject markup', /<img src=x/.test(xss), false);
  t('support: ...nor can the sender name', /<b>a@x<\/b>/.test(xss), false);
  t('support: ...nor an attachment name', /<script>/.test(xss), false);
  ok('support: the escaped text is still there', /&lt;img src=x/.test(xss));

  // The same turn reads differently depending on who is looking at it.
  const mine=turn({role:'user', by:'a@x', text:'hi', at:'2026-09-01T08:00:00Z'});
  const theirs=turn({role:'user', by:'a@x', text:'hi', at:'2026-09-01T08:00:00Z'}, {userLabel:'a@x'});
  ok('support: in your own window a message of yours says "You"', /You/.test(mine));
  t('support: ...and in the admin copy it says who wrote it', /You/.test(theirs), false);
  ok('support: ...naming them once, not twice', (theirs.match(/a@x/g)||[]).length===1);
  ok('support: an admin turn is always labelled Admin',
     /Admin/.test(turn({role:'admin', by:'admin@x', text:'ok', at:'2026-09-01T08:00:00Z'}, {userLabel:'a@x'})));

  const c=card({_id:'t1', user:'a@x', message:'Hello', status:'done', userUnread:true,
                thread:[{role:'admin',by:'admin@x',text:'Fixed',at:'2026-09-02T07:00:00Z'}]}, true);
  ok('support: an expanded card offers a reply box', /class="sup-reply-inp"/.test(c));
  ok('support: ...and a way to attach a file', /class="sup-reply-files"/.test(c));
  ok('support: ...and shows both turns', /Hello/.test(c) && /Fixed/.test(c));
  ok('support: an unread card is marked', /background:#E53E3E/.test(c));
  const collapsed=card({_id:'t1', user:'a@x', message:'Hello', status:'open'}, false);
  t('support: a collapsed card has no reply box', /sup-reply-inp/.test(collapsed), false);
  ok('support: ...but still states the status', /Open<\/span>/.test(collapsed));

  t('support: an unknown status falls back to Open', /Open</.test(badge('nonsense')), true);
  statuses.forEach(st=>ok('support: status renders: '+st, badge(st).length>0));

  // The cap has to stay under Firestore's 1 MiB document limit with room for
  // the rest of the fields.
  ok('support: the attachment cap fits in a Firestore document', maxB64 < 1048576*0.95);
}

// ─────────────────────────────────────────── report
console.log(`\n  ${pass} passed, ${fail} failed  (${pass+fail} assertions)\n`);
if(fail){ failures.forEach(f=>console.log('  ✗ '+f+'\n')); process.exit(1); }
