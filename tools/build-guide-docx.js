#!/usr/bin/env node
// Builds the Word user guide from the same source as the in-app guide.
//
//   node tools/build-guide-docx.js            → docs/user-guide/SpecPrice-User-Guide.docx
//
// Source: web/guide/content.json + the screenshots in web/guide/img/. Change the
// guide there (never in the .docx), then re-run this. See features/guide.js for
// the block format.
const fs=require('fs'), path=require('path');
let D; try{ D=require('docx'); }catch{ D=require(path.join(__dirname,'..','tests','node_modules','docx')); }
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType,
        AlignmentType, HeadingLevel, ShadingType, BorderStyle, LevelFormat, PageBreak, Footer, Header,
        PageNumber, Bookmark, InternalHyperlink, TableLayoutType } = D;

const ROOT=path.join(__dirname,'..');
const GUIDE=path.join(ROOT,'web','guide');
const OUT=path.join(ROOT,'docs','user-guide','SpecPrice-User-Guide.docx');
const data=JSON.parse(fs.readFileSync(path.join(GUIDE,'content.json'),'utf8'));

const FONT='Arial';
const BLUE='1F3A5F', BLUE2='2E75B6', RED='E11D48', MUTED='64748B';
const PAGE_W=11906, MARGIN=1000, CONTENT_W=PAGE_W-2*MARGIN;   // A4, DXA
const IMG_MAX_W=640, IMG_MAX_H=760;                            // px at 96 dpi

// ── text ─────────────────────────────────────────────────────────────────────
function runs(text, base={}){
  const out=[];
  const re=/(\*\*.+?\*\*|`.+?`)/g;
  let last=0, m;
  const s=String(text||'');
  const push=(t,o={})=>{ if(t) out.push(new TextRun({text:t, font:FONT, rightToLeft:true, size:base.size||22,
      sizeComplexScript:base.size||22, bold:!!(base.bold||o.bold), boldComplexScript:!!(base.bold||o.bold),
      color:o.color||base.color, shading:o.shading})); };
  while((m=re.exec(s))){
    push(s.slice(last,m.index));
    const tok=m[0];
    if(tok.startsWith('**')) push(tok.slice(2,-2),{bold:true});
    else push(' '+tok.slice(1,-1)+' ',{bold:true,color:'0F172A',shading:{type:ShadingType.CLEAR,fill:'E2E8F0',color:'auto'}});
    last=m.index+tok.length;
  }
  push(s.slice(last));
  return out;
}
const para=(children,o={})=>new Paragraph({bidirectional:true, alignment:o.align||AlignmentType.START,
  spacing:{before:o.before??60, after:o.after??100, line:o.line||300}, children, ...o.extra});

// ── images ───────────────────────────────────────────────────────────────────
function pngSize(buf){ return {w:buf.readUInt32BE(16), h:buf.readUInt32BE(20)}; }
function image(src){
  const buf=fs.readFileSync(path.join(GUIDE,src));
  const {w,h}=pngSize(buf);
  // Screenshots are taken at 1.5× — shown at their real on-screen size, capped to the page.
  let W=w/1.5, H=h/1.5;
  const s=Math.min(1, IMG_MAX_W/W, IMG_MAX_H/H);
  W=Math.round(W*s); H=Math.round(H*s);
  return new Paragraph({alignment:AlignmentType.CENTER, spacing:{before:140, after:60}, keepNext:true,
    children:[new ImageRun({type:'png', data:buf, transformation:{width:W, height:H},
      altText:{title:src, description:src, name:src}})]});
}

// ── blocks ───────────────────────────────────────────────────────────────────
let listInstance=0;
const border={style:BorderStyle.SINGLE, size:4, color:'CBD5E1'};
function table(head, rows){
  const n=head.length;
  const widths = n===2 ? [Math.round(CONTENT_W*0.3), CONTENT_W-Math.round(CONTENT_W*0.3)]
                       : Array(n).fill(Math.floor(CONTENT_W/n));
  const cell=(t,i,hdr)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},
    borders:{top:border,bottom:border,left:border,right:border},
    shading: hdr?{type:ShadingType.CLEAR,fill:'DBEAFE',color:'auto'}:undefined,
    margins:{top:60,bottom:60,left:100,right:100},
    children:[para(runs(t,{bold:hdr,color:hdr?BLUE:undefined,size:20}),{before:0,after:0,line:276})]});
  return new Table({visuallyRightToLeft:true, width:{size:CONTENT_W,type:WidthType.DXA}, columnWidths:widths,
    layout:TableLayoutType.FIXED,
    rows:[new TableRow({tableHeader:true, children:head.map((h,i)=>cell(h,i,true))}),
          ...rows.map(r=>new TableRow({cantSplit:true, children:r.map((c,i)=>cell(c,i,false))}))]});
}
function box(text, kind){
  const c = kind==='tip' ? {fill:'ECFDF5', line:'34D399', icon:'💡 טיפ: '} : {fill:'FFFBEB', line:'F59E0B', icon:'⚠️ שימו לב: '};
  const b={style:BorderStyle.SINGLE, size:8, color:c.line, space:6};
  return new Paragraph({bidirectional:true, spacing:{before:140,after:160,line:300},
    shading:{type:ShadingType.CLEAR, fill:c.fill, color:'auto'}, border:{top:b,bottom:b,left:b,right:b},
    indent:{left:120,right:120},
    children:[...runs(c.icon,{bold:true}), ...runs(text)]});
}
function callouts(list){
  return list.map((t,i)=>new Paragraph({bidirectional:true, spacing:{before:30,after:50,line:290},
    indent:{right:120},
    children:[new TextRun({text:` ${i+1} `, bold:true, boldComplexScript:true, color:'FFFFFF', font:FONT, size:20,
      shading:{type:ShadingType.CLEAR, fill:RED, color:'auto'}}), new TextRun({text:'  ',font:FONT}), ...runs(t)]}));
}

function render(blocks){
  const out=[];
  for(const b of blocks){
    switch(b.t){
      case 'h1':
        out.push(new Paragraph({heading:HeadingLevel.HEADING_1, bidirectional:true, pageBreakBefore:true,
          spacing:{before:0, after:200},
          children:[new Bookmark({id:'ch_'+b.id, children:runs(b.text,{bold:true,size:36,color:BLUE})})]}));
        break;
      case 'h2':
        out.push(new Paragraph({heading:HeadingLevel.HEADING_2, bidirectional:true, keepNext:true,
          spacing:{before:260, after:100}, children:runs(b.text,{bold:true,size:28,color:BLUE2})})); break;
      case 'p': out.push(para(runs(b.text))); break;
      case 'steps': case 'list': {
        const ref=b.t==='steps'?'steps':'bullets'; const inst=++listInstance;
        (b.items||[]).forEach(t=>out.push(new Paragraph({bidirectional:true, numbering:{reference:ref, level:0, instance:inst},
          spacing:{before:30, after:60, line:300}, children:runs(t)})));
        break;
      }
      case 'tip': case 'warn': out.push(box(b.text,b.t)); break;
      case 'img':
        out.push(image(b.src));
        if(b.caption) out.push(para(runs(b.caption,{size:18,color:MUTED}),{align:AlignmentType.CENTER,before:0,after:120,
          extra:{keepNext:!!(b.callouts||[]).length}}));
        out.push(...callouts(b.callouts||[]));
        out.push(para([],{before:0,after:80}));
        break;
      case 'table': out.push(table(b.head||[], b.rows||[])); out.push(para([],{before:0,after:80})); break;
    }
  }
  return out;
}

// ── cover + contents ─────────────────────────────────────────────────────────
function cover(){
  const chapters=data.blocks.filter(b=>b.t==='h1');
  const today=new Date().toLocaleDateString('he-IL');
  const kids=[
    para([],{before:1800}),
    para(runs('SpecPrice',{bold:true,size:72,color:BLUE}),{align:AlignmentType.CENTER,after:360,line:240}),
    para(runs('מדריך למשתמש',{bold:true,size:44,color:BLUE2}),{align:AlignmentType.CENTER,after:200}),
    para(runs('הצעות מחיר לכבלים ולרתמות · דפי חיתוך וחשיפה · הוראות יצור',{size:24,color:MUTED}),{align:AlignmentType.CENTER}),
    para(runs(`גרסת המערכת ${data.version||''} · ${today}`,{size:22,color:MUTED}),{align:AlignmentType.CENTER,after:600}),
  ];
  const home=data.blocks.find(b=>b.t==='img' && /02-home/.test(b.src));
  if(home) kids.push(image(home.src));
  kids.push(new Paragraph({children:[new PageBreak()]}));
  kids.push(new Paragraph({heading:HeadingLevel.HEADING_1, bidirectional:true, spacing:{after:240},
    children:runs('תוכן העניינים',{bold:true,size:36,color:BLUE})}));
  chapters.forEach(c=>kids.push(new Paragraph({bidirectional:true, spacing:{before:80,after:80},
    children:[new InternalHyperlink({anchor:'ch_'+c.id, children:runs(c.text,{size:26,color:BLUE2})})]})));
  kids.push(para([],{before:300}));
  kids.push(box('המדריך זמין גם בתוך המערכת: קוביית User Guide במסך הבית — עם חיפוש, ותמיד בגרסה העדכנית.','tip'));
  return kids;
}

const numbering={config:[
  {reference:'steps', levels:[{level:0, format:LevelFormat.DECIMAL, text:'%1.', alignment:AlignmentType.START,
    style:{paragraph:{indent:{left:540, hanging:360}}, run:{bold:true, color:BLUE2}}}]},
  {reference:'bullets', levels:[{level:0, format:LevelFormat.BULLET, text:'•', alignment:AlignmentType.START,
    style:{paragraph:{indent:{left:540, hanging:360}}}}]},
]};
const footer=new Footer({children:[new Paragraph({bidirectional:true, alignment:AlignmentType.CENTER,
  children:[new TextRun({children:['SpecPrice · מדריך למשתמש · עמוד ', PageNumber.CURRENT], font:FONT, size:16, color:MUTED, rightToLeft:true})]})]});

const doc=new Document({
  creator:'SpecPrice', title:data.title||'SpecPrice User Guide', description:'SpecPrice user guide (Hebrew)',
  styles:{default:{document:{run:{font:FONT, size:22, rightToLeft:true}}},
    paragraphStyles:[
      {id:'Heading1', name:'Heading 1', basedOn:'Normal', next:'Normal', quickFormat:true,
       run:{font:FONT, size:36, bold:true, color:BLUE}, paragraph:{outlineLevel:0}},
      {id:'Heading2', name:'Heading 2', basedOn:'Normal', next:'Normal', quickFormat:true,
       run:{font:FONT, size:28, bold:true, color:BLUE2}, paragraph:{outlineLevel:1}}]},
  numbering,
  sections:[{properties:{page:{margin:{top:MARGIN,bottom:MARGIN,left:MARGIN,right:MARGIN}}},
    footers:{default:footer}, children:[...cover(), ...render(data.blocks)]}],
});

fs.mkdirSync(path.dirname(OUT),{recursive:true});
Packer.toBuffer(doc).then(buf=>{ fs.writeFileSync(OUT,buf); console.log(`wrote ${path.relative(ROOT,OUT)} (${Math.round(buf.length/1024)} KB)`); });
