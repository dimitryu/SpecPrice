/**
 * SpecPrice — Cloud Functions
 * ---------------------------------------------------------------------------
 *   priceLookup — part pricing from the Mouser and DigiKey APIs
 *   apiConfig   — admin-managed storage for those API credentials
 *   priceProxy  — a narrow CORS proxy, now only for currency-rate pages
 *
 * HISTORY, because it explains the shape of this file: pricing used to come
 * from scraping findchips.com through priceProxy. That was abandoned — the
 * site served a different page to datacenter IPs than to a browser, so lookups
 * failed in a way no amount of parser work could fix. The vendors' own APIs
 * replaced it: structured JSON, a documented contract, and nothing to block.
 * priceProxy survives only because coinmill.com (currency rates for the
 * Priority import) is a plain web page with no CORS header of its own.
 *
 * NONE OF THESE ARE OPEN ENDPOINTS — deliberately:
 *   • priceProxy fetches only the hosts in ALLOWED_HOSTS;
 *   • only our own web origins get a CORS grant;
 *   • a valid Firebase ID token is required, and apiConfig also demands the
 *     'admin' role.
 * An unrestricted proxy would let anyone on the internet route traffic through
 * your Google project, on your quota and under your IP's reputation.
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

// NOTE ON CREDENTIALS — deliberately NOT defineSecret().
// An earlier version bound these functions to three Secret Manager secrets.
// That made deployment all-or-nothing: the CLI refuses to deploy a function
// whose declared secrets don't all exist yet, so not having a Mouser key
// blocked deploying the DigiKey support too.
//
// Credentials now live in Firestore, written through the Admin page (see
// getCredentials / apiConfig below). Environment variables are still honoured
// as a fallback for anyone who prefers configuring them outside the UI; unlike
// declared secrets, an absent env var is simply undefined and blocks nothing.

// Only these upstreams may be fetched. FindChips scraping has been removed —
// prices now come from the vendors' own APIs (see priceLookup) — leaving the
// Priority import's currency-rate lookups as this proxy's only remaining job.
const ALLOWED_HOSTS = new Set([
  'iw.coinmill.com',
]);

// Web origins allowed to call this function. Add any new domain the app is
// served from. localhost is kept so the app can be run locally for testing.
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/dimitryu\.github\.io$/,
  /^https?:\/\/(www\.)?specprice\.net$/,
];

// Set to false only if you need to debug without signing in. Leaving it false
// in production means anyone who learns this URL can use your quota.
const REQUIRE_AUTH = true;

// Look like a real browser. Kept from the FindChips era because coinmill also
// serves reduced content to obvious bots, and these headers cost nothing.
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

exports.priceProxy = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB', cors: false },
  async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = !origin || ALLOWED_ORIGINS.some(re => re.test(origin));

    if (origin && originAllowed) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Max-Age', '3600');

    // CORS preflight
    if (req.method === 'OPTIONS') return void res.status(204).send('');
    if (req.method !== 'GET') return void res.status(405).json({ error: 'Use GET' });
    if (!originAllowed) return void res.status(403).json({ error: `Origin not allowed: ${origin}` });

    // ── Auth: must be a signed-in SpecPrice user ──
    if (REQUIRE_AUTH) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return void res.status(401).json({ error: 'Missing auth token' });
      try {
        await admin.auth().verifyIdToken(token);
      } catch (e) {
        return void res.status(401).json({ error: 'Invalid auth token' });
      }
    }

    // ── Validate the target ──
    const target = req.query.url;
    if (!target) return void res.status(400).json({ error: 'Missing ?url=' });

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return void res.status(400).json({ error: 'Malformed url' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return void res.status(400).json({ error: 'Only http(s) is allowed' });
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return void res.status(403).json({ error: `Host not allowed: ${parsed.hostname}` });
    }

    // ── Fetch upstream (Node 20 has global fetch) ──
    try {
      const upstream = await fetch(parsed.toString(), {
        headers: UPSTREAM_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
      });
      let body = await upstream.text();

      // Strip inline <script>/<style>, which the caller never reads. On a
      // coinmill rate page this is most of the bytes.
      const before = body.length;
      body = body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      res.set('X-Original-Size', String(before));
      res.set('X-Stripped-Size', String(body.length));

      // Identical part numbers get re-checked often; a short shared cache cuts
      // both latency and load on the upstream site.
      res.set('Cache-Control', 'public, max-age=900');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('X-Upstream-Status', String(upstream.status));
      return void res.status(upstream.ok ? 200 : 502).send(body);
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return void res.status(504).json({
        error: timedOut ? 'Upstream timed out' : `Upstream fetch failed: ${e.message}`,
      });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
 * OFFICIAL DISTRIBUTOR APIs — Mouser + DigiKey
 * ---------------------------------------------------------------------------
 * Why this exists alongside priceProxy: scraping findchips.com is a moving
 * target. It has no contract with us, serves a different page to datacenter
 * IPs than to a browser, and its markup can change any day. These are the
 * vendors' OWN documented APIs — structured JSON, no HTML parsing, no bot
 * defences to fight, and legitimate use of the service.
 *
 * The endpoint returns a normalised shape so the app never has to know how
 * either vendor formats its data:
 *   { pn, qty, mouser:{price,breakQty,stock,url,mpn,manufacturer}|null,
 *     digikey:{...}|null, errors:[...] }
 * A vendor that isn't configured, or that fails, comes back null with a note
 * in `errors` — one vendor being down never blocks the other.
 * ═══════════════════════════════════════════════════════════════════════════ */

// Both vendors quote tiered pricing. Pick the tier whose quantity is closest to
// what we're actually buying — the same rule the FindChips path uses, so the
// three price columns stay comparable instead of silently mixing order sizes.
function pickNearestBreak(breaks, targetQty) {
  const valid = (breaks || []).filter(b => b && b.price > 0);
  if (!valid.length) return null;
  const target = targetQty > 0 ? targetQty : 1;
  let best = valid[0];
  let bestDist = Math.abs(target - best.qty);
  for (const b of valid.slice(1)) {
    const d = Math.abs(target - b.qty);
    if (d < bestDist || (d === bestDist && b.price < best.price)) { best = b; bestDist = d; }
  }
  return best;
}

/* Part-number matching.
 * Distributors normalise manufacturer part numbers differently from how the
 * manufacturer prints them on a drawing. Molex's "08-50-0031" is listed by
 * DigiKey as "0008500031"; TE parts appear with and without dashes. Comparing
 * the raw strings therefore reports "not found" for parts that are sitting in
 * stock — which is exactly what we saw against the real catalogue.
 *
 * So: try an exact match first (unambiguous, always preferred), then fall back
 * to a normalised comparison that ignores punctuation and zero-padding.
 * Deliberately NOT a substring match — "07461" appearing inside "074613" is a
 * different part, and quoting the wrong part's price is worse than no price. */
function pnKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}
// Picks the best entry from a candidate list: exact match wins, else normalised.
// Returns { item, exact } or null.
function matchPart(items, wantedPn, getPn) {
  const wantRaw = String(wantedPn || '').trim().toUpperCase();
  const wantKey = pnKey(wantedPn);
  if (!wantKey) return null;
  for (const it of items) {
    if (String(getPn(it) || '').trim().toUpperCase() === wantRaw) return { item: it, exact: true };
  }
  for (const it of items) {
    if (pnKey(getPn(it)) === wantKey) return { item: it, exact: false };
  }
  return null;
}

const numFrom = v => {
  if (typeof v === 'number') return v;
  // Mouser returns strings like "$0.104", "1.234,56 €" — strip everything but
  // digits and the decimal separator, treating a comma as a decimal point when
  // it's clearly not a thousands separator.
  const s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const norm = (s.includes(',') && !s.includes('.')) ? s.replace(',', '.') : s.replace(/,/g, '');
  return parseFloat(norm) || 0;
};

// ── Mouser: single POST, API key in the query string ──────────────────────
async function lookupMouser(pn, qty, apiKey) {
  const resp = await fetch(
    `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        SearchByPartRequest: { mouserPartNumber: pn, partSearchOptions: 'Exact' },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!resp.ok) throw new Error(`Mouser HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.Errors && data.Errors.length) {
    throw new Error('Mouser: ' + data.Errors.map(e => e.Message || e.Code).join('; '));
  }
  const parts = (data.SearchResults && data.SearchResults.Parts) || [];
  // Mouser's "Exact" option still returns close relatives, so we do our own
  // matching rather than trusting the first row back.
  const m = matchPart(parts, pn, p => p.ManufacturerPartNumber);
  if (!m) return null;
  const part = m.item;

  const breaks = (part.PriceBreaks || []).map(b => ({
    qty: parseInt(b.Quantity, 10) || 0,
    price: numFrom(b.Price),
    currency: b.Currency || 'USD',
  }));
  const best = pickNearestBreak(breaks, qty);
  if (!best) return null;
  return {
    price: best.price,
    currency: best.currency,
    breakQty: best.qty,
    stock: String(part.Availability || '').replace(/\D+/g, '') || '',
    mpn: part.ManufacturerPartNumber || '',
    exactMatch: m.exact,
    manufacturer: part.Manufacturer || '',
    url: part.ProductDetailUrl || '',
  };
}

// ── DigiKey: OAuth2 client-credentials, then a keyword search ─────────────
// The access token is valid for ~10 minutes; cache it in module scope so a
// warm instance reuses it across parts instead of re-authenticating each time.
let _dkToken = null, _dkTokenExp = 0;
async function digikeyToken(clientId, clientSecret) {
  if (_dkToken && Date.now() < _dkTokenExp - 60000) return _dkToken;
  const resp = await fetch('https://api.digikey.com/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`DigiKey auth HTTP ${resp.status} — check Client ID/Secret`);
  const j = await resp.json();
  if (!j.access_token) throw new Error('DigiKey auth returned no access_token');
  _dkToken = j.access_token;
  _dkTokenExp = Date.now() + (parseInt(j.expires_in, 10) || 600) * 1000;
  return _dkToken;
}

async function lookupDigiKey(pn, qty, clientId, clientSecret) {
  const token = await digikeyToken(clientId, clientSecret);
  const resp = await fetch('https://api.digikey.com/products/v4/search/keyword', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-DIGIKEY-Client-Id': clientId,
      'X-DIGIKEY-Locale-Site': 'US',
      'X-DIGIKEY-Locale-Language': 'en',
      'X-DIGIKEY-Locale-Currency': 'USD',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ Keywords: pn, Limit: 10, Offset: 0 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`DigiKey HTTP ${resp.status}`);
  const data = await resp.json();
  const products = data.Products || [];
  const m = matchPart(products, pn, p => p.ManufacturerProductNumber);
  if (!m) return null;
  const product = m.item;

  // v4 puts pricing on each packaging variation (cut tape, reel, ...). Gather
  // every tier across all variations and let pickNearestBreak choose.
  const breaks = [];
  for (const v of (product.ProductVariations || [])) {
    for (const t of (v.StandardPricing || [])) {
      breaks.push({ qty: parseInt(t.BreakQuantity, 10) || 0, price: numFrom(t.UnitPrice) });
    }
  }
  for (const t of (product.StandardPricing || [])) {
    breaks.push({ qty: parseInt(t.BreakQuantity, 10) || 0, price: numFrom(t.UnitPrice) });
  }
  const best = pickNearestBreak(breaks, qty);
  if (!best) return null;
  return {
    price: best.price,
    currency: 'USD',
    breakQty: best.qty,
    stock: String(product.QuantityAvailable ?? ''),
    mpn: product.ManufacturerProductNumber || '',
    exactMatch: m.exact,
    manufacturer: (product.Manufacturer && product.Manufacturer.Name) || '',
    url: product.ProductUrl || '',
  };
}

exports.priceLookup = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    cors: false,
  },
  async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = !origin || ALLOWED_ORIGINS.some(re => re.test(origin));
    if (origin && originAllowed) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') return void res.status(204).send('');
    if (!originAllowed) return void res.status(403).json({ error: `Origin not allowed: ${origin}` });

    if (REQUIRE_AUTH) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return void res.status(401).json({ error: 'Missing auth token' });
      try { await admin.auth().verifyIdToken(token); }
      catch { return void res.status(401).json({ error: 'Invalid auth token' }); }
    }

    const pn = String(req.query.pn || '').trim();
    const qty = parseInt(req.query.qty, 10) || 1;
    if (!pn) return void res.status(400).json({ error: 'Missing ?pn=' });

    const out = { pn, qty, mouser: null, digikey: null, errors: [] };

    // Both vendors are queried in parallel and failures are isolated: a missing
    // key or a vendor outage must never take the other one down with it.
    const creds = await getCredentials();
    const mouserKey = creds.mouser_api_key;
    const dkId = creds.digikey_client_id;
    const dkSecret = creds.digikey_client_secret;

    await Promise.all([
      (async () => {
        if (!mouserKey) { out.errors.push('Mouser: no API key configured'); return; }
        try { out.mouser = await lookupMouser(pn, qty, mouserKey); }
        catch (e) { out.errors.push(e.message || 'Mouser lookup failed'); }
      })(),
      (async () => {
        if (!dkId || !dkSecret) { out.errors.push('DigiKey: no credentials configured'); return; }
        try { out.digikey = await lookupDigiKey(pn, qty, dkId, dkSecret); }
        catch (e) { out.errors.push(e.message || 'DigiKey lookup failed'); }
      })(),
    ]);

    res.set('Cache-Control', 'private, max-age=900');
    return void res.status(200).json(out);
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
 * CREDENTIAL STORAGE — Admin UI ➜ Firestore ➜ Cloud Function
 * ---------------------------------------------------------------------------
 * The Anthropic/Gemini keys live in each admin's localStorage because the
 * BROWSER calls those APIs directly. Mouser and DigiKey are different: only
 * this Cloud Function ever talks to them, so the credentials must live
 * server-side — and, critically, must NEVER be readable by the browser.
 *
 * They're kept in Firestore at secure_config/distributor_api, a path that
 * firestore.rules denies to every client for both read AND write. That looks
 * like a mistake but is the whole point: the Admin SDK used here bypasses
 * security rules entirely, so this function can read and write the document
 * while no browser — not even a logged-in admin's, not even one running
 * hand-crafted SDK calls from the console — can fetch it.
 *
 * So the admin form POSTs new values to this function (which checks the
 * caller really is an admin) and only ever GETs back a "configured / not
 * configured" status. The secrets travel in one direction and never come back.
 *
 * Environment variables remain a fallback for configuring outside the UI.
 *
 * EACH VENDOR IS INDEPENDENT. Mouser and DigiKey are configured, tested and
 * queried separately, so running with only one is a fully supported state —
 * not a half-broken one. Signing up for the second vendor later needs no code
 * change and no redeploy.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG_DOC = 'secure_config/distributor_api';
const CRED_FIELDS = ['mouser_api_key', 'digikey_client_id', 'digikey_client_secret'];

// A price check runs one lookup per part, so re-reading Firestore for every
// row would add a pointless round-trip to each. 60s is short enough that a
// credential change takes effect almost immediately.
let _credCache = null, _credCacheExp = 0;

async function getCredentials() {
  if (_credCache && Date.now() < _credCacheExp) return _credCache;

  // Environment first, so an install configured outside the UI still works.
  const out = {
    mouser_api_key: (process.env.MOUSER_API_KEY || '').trim(),
    digikey_client_id: (process.env.DIGIKEY_CLIENT_ID || '').trim(),
    digikey_client_secret: (process.env.DIGIKEY_CLIENT_SECRET || '').trim(),
  };

  try {
    const snap = await admin.firestore().doc(CONFIG_DOC).get();
    if (snap.exists) {
      const d = snap.data() || {};
      // Firestore wins where it has a value — it's the one an admin can change
      // from the UI without a redeploy.
      for (const f of CRED_FIELDS) if (d[f]) out[f] = String(d[f]).trim();
    }
  } catch (e) {
    console.warn('[creds] Firestore read failed, using Secret Manager only:', e.message);
  }

  _credCache = out;
  _credCacheExp = Date.now() + 60000;
  return out;
}

function toIso(v) {
  try {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

// Enough to confirm you pasted the right key, useless to anyone who steals it.
function hint(v) {
  const s = String(v || '');
  return s.length > 4 ? '…' + s.slice(-4) : (s ? '…' : '');
}

// Being an authenticated user is not enough here — these credentials are
// billable and shared, so writing them requires the 'admin' role, read from
// the same users/{uid}.role field firestore.rules uses.
async function requireAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Missing auth token'), { code: 401 });

  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token); }
  catch { throw Object.assign(new Error('Invalid auth token'), { code: 401 }); }

  const snap = await admin.firestore().doc(`users/${decoded.uid}`).get();
  const role = snap.exists ? (snap.data() || {}).role : '';
  if (role !== 'admin') {
    throw Object.assign(new Error('Admin role required'), { code: 403 });
  }
  return decoded;
}

exports.apiConfig = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    cors: false,
  },
  async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = !origin || ALLOWED_ORIGINS.some(re => re.test(origin));
    if (origin && originAllowed) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return void res.status(204).send('');
    if (!originAllowed) return void res.status(403).json({ error: `Origin not allowed: ${origin}` });

    let user;
    try { user = await requireAdmin(req); }
    catch (e) { return void res.status(e.code || 401).json({ error: e.message }); }

    try {
      // ── Read: status only, never the values ──
      if (req.method === 'GET') {
        const creds = await getCredentials();
        let meta = {};
        try {
          const snap = await admin.firestore().doc(CONFIG_DOC).get();
          if (snap.exists) meta = snap.data() || {};
        } catch { /* status still useful without metadata */ }

        return void res.status(200).json({
          mouser: {
            configured: !!creds.mouser_api_key,
            hint: hint(creds.mouser_api_key),
            source: meta.mouser_api_key ? 'ui' : (creds.mouser_api_key ? 'env-var' : null),
          },
          digikey: {
            configured: !!(creds.digikey_client_id && creds.digikey_client_secret),
            clientIdHint: hint(creds.digikey_client_id),
            secretHint: hint(creds.digikey_client_secret),
            source: meta.digikey_client_id ? 'ui' : (creds.digikey_client_id ? 'env-var' : null),
          },
          // Normally a Firestore Timestamp, but tolerate a plain Date or an
          // ISO string too — a stale field format must not 500 the whole panel
          // and hide the configured/not answer the admin actually came for.
          updatedAt: toIso(meta.updatedAt),
          updatedBy: meta.updatedBy || '',
        });
      }

      if (req.method !== 'POST') return void res.status(405).json({ error: 'Use GET or POST' });

      const body = req.body || {};

      // ── Live test: prove the credentials actually work ──
      // Saving a typo'd key looks identical to saving a good one until the
      // next price check fails, so let the admin verify on the spot.
      // Tests the SAVED credentials — so click Save before Test.
      if (body.action === 'test') {
        const creds = await getCredentials();
        const pn = String(body.pn || '').trim() || '1-794610-2';
        const result = { pn, mouser: null, digikey: null };

        // "Not configured" is reported distinctly from "configured but broken":
        // one is a deliberate choice, the other is a problem to fix.
        result.mouser = !creds.mouser_api_key
          ? { ok: false, skipped: true, message: 'Not configured — skipped' }
          : await lookupMouser(pn, 1, creds.mouser_api_key).then(
              r => ({ ok: true, message: r ? `Found — $${r.price} @ qty ${r.breakQty}` : 'Connected, but this part was not found' }),
              e => ({ ok: false, message: e.message }));

        result.digikey = !(creds.digikey_client_id && creds.digikey_client_secret)
          ? { ok: false, skipped: true, message: creds.digikey_client_id
              ? 'Client Secret missing — enter it to complete DigiKey setup'
              : 'Not configured — skipped' }
          : await lookupDigiKey(pn, 1, creds.digikey_client_id, creds.digikey_client_secret).then(
              r => ({ ok: true, message: r ? `Found — $${r.price} @ qty ${r.breakQty}` : 'Connected, but this part was not found' }),
              e => ({ ok: false, message: e.message }));

        return void res.status(200).json(result);
      }

      // ── Write ──
      const update = {};
      const changed = [];
      for (const f of CRED_FIELDS) {
        if (!(f in body)) continue;             // field omitted → leave as-is
        const v = String(body[f] == null ? '' : body[f]).trim();
        // An empty string is a deliberate "clear this credential", which is how
        // an admin revokes one. Blank fields the UI didn't submit never get here.
        update[f] = v;
        changed.push(f);
      }
      if (!changed.length) return void res.status(400).json({ error: 'Nothing to update' });

      update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      update.updatedBy = user.email || user.uid;
      await admin.firestore().doc(CONFIG_DOC).set(update, { merge: true });
      _credCache = null; // force the next lookup to pick up the new values

      // Deliberately logged without any credential material.
      console.log(`[apiConfig] ${user.email || user.uid} updated: ${changed.join(', ')}`);
      return void res.status(200).json({ ok: true, updated: changed });
    } catch (e) {
      console.error('[apiConfig]', e);
      return void res.status(500).json({ error: e.message || 'Internal error' });
    }
  }
);
