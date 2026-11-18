#!/usr/bin/env node
// Keeps every version mark in web/app.html in step with one number.
//
//   node tools/stamp-release.js 1.59.0     set a new version
//   node tools/stamp-release.js            re-stamp with the version already there
//
// Why it exists: the browser caches each JS and CSS file on its own. Right
// after a release it could otherwise run a NEW app.html against OLD modules
// (or the other way round) for up to ten minutes, and a module that asks for
// a function the old file does not have stops the whole app from loading. So
// every file is requested as name.js?v=<version>, through the import map, and
// a new version is a new URL the browser has never cached.
//
// It writes: the APP_VER line, the import map (every file under web/js), the
// stylesheet links and the main script tag. The push script refuses to publish
// when these do not match, so a forgotten stamp cannot reach the site.
const fs=require('fs'), path=require('path');
const WEB=path.join(__dirname,'..','web');
const APP=path.join(WEB,'app.html');
let html=fs.readFileSync(APP,'utf8');
const cur=(/const APP_VER = '([0-9][0-9.]*)';/.exec(html)||[])[1];
const ver=process.argv[2]||cur;
if(!/^[0-9]+(\.[0-9]+)*$/.test(ver||'')) { console.error('no valid version'); process.exit(1); }

// ── Content-Security-Policy ───────────────────────────────────────────────────
// What the pages may load and talk to, written into a <meta> between the
// csp:begin / csp:end markers. Scripts only from this site, cdnjs (pdf.js,
// ExcelJS, html2canvas, jsPDF — each with Subresource Integrity) and gstatic
// (Firebase); no inline event handlers and no eval. The two inline scripts the
// page needs (APP_VER and the import map) are allowed by their exact SHA-256,
// so this must run after any change to them — which is why it lives here.
// Connections only to Firebase (googleapis) and our own Cloud Functions, so a
// script that did slip in could not send data anywhere else.
const crypto=require('crypto');
function inlineHashes(doc){
  const out=[], re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m; while((m=re.exec(doc))) out.push(`'sha256-${crypto.createHash('sha256').update(m[1],'utf8').digest('base64')}'`);
  return out;
}
function cspFor(doc){
  return [
    "default-src 'self'",
    `script-src 'self' https://cdnjs.cloudflare.com https://www.gstatic.com ${inlineHashes(doc).join(' ')}`,
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
    "connect-src 'self' data: blob: https://*.googleapis.com https://us-central1-specprice-236a2.cloudfunctions.net",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src https://specprice-236a2.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
function withCsp(doc){
  const re=/(<!-- csp:begin -->)[\s\S]*?(<!-- csp:end -->)/;
  if(!re.test(doc)) throw new Error('marker missing: csp');
  // Hash the scripts with the meta emptied first: the meta itself is not a script.
  const bare=doc.replace(re,'$1\n  $2');
  return bare.replace(re, `$1\n  <meta http-equiv="Content-Security-Policy" content="${cspFor(bare)}">\n  $2`);
}

const list=(dir,ext)=>{ const out=[]; (function rec(d){ for(const f of fs.readdirSync(d).sort()){ const p=path.join(d,f);
  if(fs.statSync(p).isDirectory()) rec(p); else if(f.endsWith(ext)) out.push(path.relative(WEB,p).split(path.sep).join('/')); } })(path.join(WEB,dir)); return out; };
const js=list('js','.js'), css=list('css','.css');

const map={imports:Object.fromEntries(js.map(f=>[`./${f}`,`./${f}?v=${ver}`]))};
const block=(name,body)=>new RegExp(`(<!-- ${name}:begin -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
const put=(name,body)=>{ const re=block(name); if(!re.test(html)) throw new Error('marker missing: '+name); html=html.replace(re,`$1\n${body}\n  $2`); };

html=html.replace(/const APP_VER = '[0-9][0-9.]*';/, `const APP_VER = '${ver}';`);
put('importmap', `  <script type="importmap">\n${JSON.stringify(map,null,2).replace(/^/gm,'  ')}\n  </script>`);
put('styles', css.map(f=>`  <link rel="stylesheet" href="./${f}?v=${ver}">`).join('\n'));
put('main', `  <script type="module" src="./js/main.js?v=${ver}"></script>`);
html=withCsp(html);
fs.writeFileSync(APP, html);
// The sign-in page carries the same policy (its own inline script hashed).
const INDEX=path.join(WEB,'index.html');
if(fs.existsSync(INDEX)) fs.writeFileSync(INDEX, withCsp(fs.readFileSync(INDEX,'utf8')));
console.log(`stamped v${ver}: ${js.length} modules, ${css.length} stylesheets, CSP with ${inlineHashes(html).length} inline-script hashes`);
