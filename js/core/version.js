import { esc, toast } from './ui.js';

// The running version is set ONCE, in app.html (const APP_VER = '…'), where
// the update check and the push script also read it. tools/stamp-release.js
// keeps it in step with the ?v= on every module and stylesheet.
export const APP_VER = (typeof window!=='undefined' && window.APP_VER) || 'dev';

// ── Version check ─────────────────────────────────────────────────────────────
// The app is static files on GitHub Pages, so a browser can keep
// serving a cached copy for hours after a deploy — long enough for someone to
// report a bug that was fixed that morning, from a screen that no longer
// exists in the current code. There's no service worker here to push an
// update, so the app asks instead: it re-fetches app.html, cache bypassed,
// and compares the version string it finds with the one it is running.
//
// Only the first 64KB are requested — APP_VER sits in the <head> of app.html —
// so the check costs almost nothing. A server that ignores the Range header
// simply returns the whole file, which parses exactly the same.
export const _VER_CHECK_BYTES=65535;

export function _parseAppVer(html){
  const m=String(html||'').match(/const\s+APP_VER\s*=\s*'([0-9]+(?:\.[0-9]+)*)'/);
  return m?m[1]:'';
}
// Compared part by part as NUMBERS: '1.32.0' is newer than '1.9.9', which a
// plain string comparison gets backwards.
export function _verIsNewer(remote, local){
  const a=String(remote||'').split('.').map(x=>parseInt(x,10)||0);
  const b=String(local||'').split('.').map(x=>parseInt(x,10)||0);
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const x=a[i]||0, y=b[i]||0;
    if(x>y) return true;
    if(x<y) return false;
  }
  return false;
}

// The version the SERVER is serving right now, or '' when it couldn't be read.
// Never throws: a failed check is a non-event, not something to explain.
export async function fetchLatestAppVersion(){
  try{
    const resp=await fetch(`app.html?_vc=${Date.now()}`,
      {cache:'no-store', headers:{Range:`bytes=0-${_VER_CHECK_BYTES}`}});
    if(!resp.ok && resp.status!==206) return '';
    return _parseAppVer(await resp.text());
  }catch(e){ console.warn('[version] check failed:', e.message); return ''; }
}

// Loads from a URL the cache has never seen. That is the only reliable way to
// bypass it — location.reload(true) has been ignored by browsers for years.
export function _applyUpdate(latest){
  location.replace(`app.html?v=${encodeURIComponent(latest||String(Date.now()))}`);
}

// A dismissible bar rather than a modal: an update is worth noticing, not
// worth interrupting a quote someone is in the middle of building.
export function _showUpdateBar(latest){
  if(document.getElementById('update-bar')) return;
  const bar=document.createElement('div');
  bar.id='update-bar';
  bar.setAttribute('role','status');
  bar.innerHTML=`<span>New version <b>v${esc(latest)}</b> available — you're on v${esc(APP_VER)}.</span>
    <button class="btn btn-green btn-sm" id="update-now">↻ Update now</button>
    <button class="btn btn-ghost btn-sm" id="update-later">Later</button>`;
  document.body.appendChild(bar);
  document.getElementById('update-now').addEventListener('click',()=>_applyUpdate(latest));
  document.getElementById('update-later').addEventListener('click',()=>bar.remove());
}

// The explicit "Check for updates" button. Reports EVERY outcome — up to date,
// update available, or server unreachable — because a button that sometimes
// says nothing leaves the person no wiser than before they pressed it.
export async function checkForUpdate(btn){
  const restore=btn?btn.textContent:'';
  if(btn){ btn.disabled=true; btn.textContent='Checking…'; }
  const latest=await fetchLatestAppVersion();
  if(btn){ btn.disabled=false; btn.textContent=restore; }
  if(!latest){ toast('Could not reach the server to check the version','error'); return; }
  if(_verIsNewer(latest, APP_VER)){
    _showUpdateBar(latest);
    toast(`Version ${latest} is available`,'info');
  } else {
    toast(`You're on the latest version (v${APP_VER})`,'success');
  }
}

// Runs once after sign-in. Shows the bar when there is something to update and
// stays completely silent otherwise.
export async function autoCheckForUpdate(){
  const latest=await fetchLatestAppVersion();
  if(latest && _verIsNewer(latest, APP_VER)) _showUpdateBar(latest);
}
