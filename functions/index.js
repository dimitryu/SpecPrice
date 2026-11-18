/**
 * SpecPrice — Cloud Functions
 * ---------------------------------------------------------------------------
 *   priceLookup — part pricing from the Mouser and DigiKey APIs
 *   apiConfig   — admin-managed storage for those API credentials
 *   priceProxy  — a narrow CORS proxy, now only for currency-rate pages
 *   aiProxy     — every Anthropic (Claude) call the app makes, so the AI key
 *                 lives on the server and never in a browser
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
 *     'admin' role; aiProxy demands an enabled user profile.
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

/* ── Per-user limits ─────────────────────────────────────────────────────────
 * Every signed-in user can spend the company's Anthropic credit and the
 * distributors' daily API quotas. These limits stop one account — a script, a
 * stuck loop, a stolen session — from burning through them: a burst limit per
 * minute (per server instance, in memory) and a daily total per user (in
 * Firestore, usage/{uid}_{kind}_{date}, a collection no browser can read or
 * write). Generous for real work: a 33-drawing quote is a few hundred AI
 * calls; a Check Price of 1000 parts is 1000 lookups.
 * Over a limit the answer is HTTP 429 with a plain message. */
const RATE_LIMITS = {
  ai:    { perMinute: 60,  perDay: 2000 },
  price: { perMinute: 600, perDay: 30000 },
  proxy: { perMinute: 60,  perDay: 1000 },
};
const _burst = new Map();   // `${uid}|${kind}` → { minute, n }
function rateError(msg) { return Object.assign(new Error(msg), { code: 429 }); }
async function enforceRate(uid, kind) {
  const lim = RATE_LIMITS[kind];
  if (!lim || !uid) return;
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const k = `${uid}|${kind}`;
  const b = _burst.get(k);
  const n = b && b.minute === minute ? b.n + 1 : 1;
  _burst.set(k, { minute, n });
  if (_burst.size > 5000) for (const [key, v] of _burst) if (v.minute < minute) _burst.delete(key);
  if (n > lim.perMinute) throw rateError(`Too many requests — limit is ${lim.perMinute} a minute. Wait a minute and try again.`);
  const day = new Date(now).toISOString().slice(0, 10);
  const ref = admin.firestore().doc(`usage/${uid}_${kind}_${day}`);
  await ref.set({ uid, kind, day, count: admin.firestore.FieldValue.increment(1),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const snap = await ref.get();
  const count = (snap.exists && (snap.data() || {}).count) || 0;
  if (count > lim.perDay) throw rateError(`Daily limit reached (${lim.perDay} ${kind === 'ai' ? 'AI requests' : 'lookups'} a day for one user). It resets at midnight UTC — or ask an admin.`);
}

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

    // ── Auth: an enabled SpecPrice user — a sign-in account alone is not enough ──
    if (REQUIRE_AUTH) {
      try { const who = await requireMember(req); await enforceRate(who.uid, 'proxy'); }
      catch (e) { return void res.status(e.code || 401).json({ error: e.message }); }
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
/* Description matching — the tie-breaker when one part number isn't one part.
 *
 * Military and industry SPEC numbers (M81824/1-2, M23053/5, MS3106...) are not
 * unique products: every qualified manufacturer sells its own part under the
 * same number. A distributor legitimately returns several "exact matches", and
 * they are NOT interchangeable in price — the real case that prompted this had
 * Glenair at $179.93 and Milnec at $3.98 for M81824/1-2, a 45x spread. Taking
 * whichever came back first was effectively picking at random.
 *
 * The BOM description is what disambiguates them: "SPLICE CRIMP STYLE 20-16AWG
 * BLUE COLOR" matches "Butt splice 20-16 AWG blue" far better than "Terminal
 * Splice". So when more than one candidate matches the part number, score them
 * on description overlap and take the best.
 *
 * Deliberately NOT tie-broken on price. Choosing the cheapest of several
 * different products because they share a spec number is how you quote the
 * wrong part; cheapness has to be a consequence of matching, never the reason.
 */
const _DESC_STOP = new Set(['THE','AND','FOR','WITH','OF','TO','A','AN','TYPE','STYLE','COLOR','COLOUR','PART','NEW']);
function descTokens(s) {
  return String(s || '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && t.length > 1 && !_DESC_STOP.has(t));
}
// Tokens carrying a digit (gauge ranges, sizes, pin counts) are the ones that
// actually separate two similar products, so they count double.
function descScore(wanted, candidate) {
  const want = descTokens(wanted);
  if (!want.length) return 0;
  const have = new Set(descTokens(candidate));
  let score = 0;
  for (const t of new Set(want)) {
    if (have.has(t)) score += /\d/.test(t) ? 2 : 1;
  }
  return score;
}

// Returns { item, exact, considered, score, candidates } or null.
// `candidates` lists what was compared (part number, manufacturer, description,
// score) so the UI can SHOW the choice rather than assert it — without that,
// a wrong pick is indistinguishable from a right one.
function matchPart(items, wantedPn, getPn, wantedDesc, getDesc, getMfr, getKey) {
  const wantRaw = String(wantedPn || '').trim().toUpperCase();
  const wantKey = pnKey(wantedPn);
  if (!wantKey) return null;

  const exact = items.filter(it => String(getPn(it) || '').trim().toUpperCase() === wantRaw);
  const near  = items.filter(it => pnKey(getPn(it)) === wantKey && !exact.includes(it));
  // Exact matches are always preferred as a GROUP; description only chooses
  // within the best group, never promotes a near match over an exact one.
  let pool = exact.length ? exact : near;
  if (!pool.length) return null;

  // DigiKey's keyword response repeats the same products across ExactMatches
  // and Products, so two real products arrived as four candidates and the count
  // shown to the user ("4 similar") didn't match what the distributor's own
  // site shows. Deduplicate on manufacturer + part number.
  if (pool.length > 1) {
    const seen = new Set();
    pool = pool.filter(it => {
      // getKey: a vendor whose listings differ by more than maker + P/N (Farnell
      // sells one part as single pieces AND in packs, each its own SKU).
      const k = (getKey ? String(getKey(it) || '') + '|' : '') + `${String(getMfr ? getMfr(it) : '').trim().toUpperCase()}|${String(getPn(it) || '').trim().toUpperCase()}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  // Scoring happens here, but CHOOSING doesn't: the tie-break needs each
  // candidate's price, which only the vendor-specific reader can produce.
  const canScore = getDesc && String(wantedDesc || '').trim();
  const scored = pool.map(it => ({
    item: it,
    pn:   String(getPn(it) || ''),
    mfr:  getMfr ? String(getMfr(it) || '') : '',
    desc: String((getDesc ? getDesc(it) : '') || '').slice(0, 120),
    score: canScore ? descScore(wantedDesc, getDesc(it)) : 0,
  }));
  return { pool: scored, exact: exact.length > 0, considered: pool.length };
}

/* Picks one candidate, and says why.
 *
 * 1. Best description match wins — that's the only signal that can tell two
 *    genuinely different products apart.
 * 2. Among equally-matching candidates, the CHEAPEST wins.
 *
 * Rule 2 is the operator's call and it's right for the case that drives this:
 * spec numbers like M81824/1-2 are QPL items, so every qualified manufacturer's
 * version meets the same specification and is interchangeable — paying $179.93
 * when $3.98 buys a conforming part is simply an error. It also rescues the
 * situation where descriptions can't be read at all (an API returning the field
 * in an unexpected shape): every score is then 0, everything ties, and the
 * cheapest conforming part is a far better default than whichever the
 * distributor happened to list first.
 *
 * Note the ordering: price NEVER overrides a better description match. A
 * cheaper but wrong part still loses to a dearer, correct one.
 */
function chooseCandidate(scoredPool, read) {
  const withPrice = scoredPool.map(c => ({ ...c, info: read(c.item) }));
  const maxScore = Math.max(...withPrice.map(c => c.score));
  const top = withPrice.filter(c => c.score === maxScore);

  const priced = top.filter(c => c.info && c.info.price > 0);
  if (priced.length) {
    priced.sort((a, b) => a.info.price - b.info.price);
    return { ...priced[0],
             // 'price' only when the tie-break actually decided something.
             chosenBy: (top.length > 1 && priced.length > 1) ? 'price'
                     : (maxScore > 0 && scoredPool.length > 1 ? 'description' : 'only') };
  }
  return { ...top[0], chosenBy: 'only' };
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

/* Mouser lookup.
 *
 * Two passes, for the same reason DigiKey needs two: partSearchOptions 'Exact'
 * only matches Mouser's own normalisation of the part number, so anything
 * written with different punctuation is invisible to it. The keyword pass casts
 * a wider net and our own matchPart() does the deciding — which keeps the
 * safety property that we never quote a neighbouring part's price. */
async function mouserPost(path, apiKey, body) {
  const resp = await fetch(
    `https://api.mouser.com/api/v1/${path}?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (resp.status === 429) throw new Error('Mouser rate limit reached (HTTP 429) — try again shortly');
  if (resp.status === 401 || resp.status === 403) throw new Error(`Mouser auth failed (HTTP ${resp.status}) — check the API key`);
  if (!resp.ok) throw new Error(`Mouser HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.Errors && data.Errors.length) {
    throw new Error('Mouser: ' + data.Errors.map(e => e.Message || e.Code).join('; '));
  }
  return (data.SearchResults && data.SearchResults.Parts) || [];
}

function readMouserPart(part, qty, exact) {
  const breaks = (part.PriceBreaks || []).map(b => ({
    qty: parseInt(b.Quantity, 10) || 0,
    price: numFrom(b.Price),
    currency: b.Currency || 'USD',
  }));
  const best = pickNearestBreak(breaks, qty);
  // Availability is a free-text field ("143 In Stock", "None", "Non-Stocked").
  // Pull the number out; absent or unparseable means zero on hand, which is
  // information worth keeping rather than a reason to discard the part.
  const stockNum = String(part.Availability || '').replace(/[^\d]/g, '');
  return {
    price: best ? best.price : 0,
    currency: best ? best.currency : 'USD',
    breakQty: best ? best.qty : 0,
    stock: String(stockNum ? parseInt(stockNum, 10) : 0),
    mpn: part.ManufacturerPartNumber || '',
    exactMatch: exact,
    manufacturer: part.Manufacturer || '',
    url: part.ProductDetailUrl || '',
    // The datasheet is what an engineer actually opens: it is the document that
    // says how deep the contact seats and how far back to strip. Mouser returns
    // it on the part; passing it through costs nothing and saves a search.
    datasheet: part.DataSheetUrl || '',
    status: part.LifecycleStatus || '',
  };
}

async function lookupMouser(pn, qty, apiKey, desc) {
  const getDesc = mouserDesc;
  // ── 1. Part-number search ──
  let parts = await mouserPost('search/partnumber', apiKey, {
    SearchByPartRequest: { mouserPartNumber: pn, partSearchOptions: 'Exact' },
  });
  let m = matchPart(parts, pn, p => p.ManufacturerPartNumber, desc, getDesc, p => p.Manufacturer);

  // ── 2. Keyword search fallback ──
  if (!m) {
    parts = await mouserPost('search/keyword', apiKey, {
      SearchByKeywordRequest: { keyword: pn, records: 50, startingRecord: 0 },
    });
    m = matchPart(parts, pn, p => p.ManufacturerPartNumber, desc, getDesc, p => p.Manufacturer);
  }
  if (!m) return null;
  const pick = chooseCandidate(m.pool, it => readMouserPart(it, qty, m.exact));
  return { ...pick.info,
           considered: m.considered, descScore: pick.score, desc: pick.desc,
           chosenBy: pick.chosenBy,
           candidates: m.pool.map(c => ({ pn: c.pn, mfr: c.mfr, desc: c.desc, score: c.score,
                                          price: (readMouserPart(c.item, qty, m.exact) || {}).price || 0 })).slice(0, 8) };
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

// Reads a DigiKey v4 product object into our normalised shape.
// `qty` selects the price tier; a product with no pricing at all still comes
// back (with price 0) rather than being dropped — see the note in lookupDigiKey.
function readDigiKeyProduct(product, qty, exact) {
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
  let best = pickNearestBreak(breaks, qty);
  // Non-stocked and made-to-order parts often carry no price-break table but do
  // have a headline UnitPrice. Use it rather than reporting the part missing.
  if (!best && numFrom(product.UnitPrice) > 0) {
    best = { qty: 1, price: numFrom(product.UnitPrice) };
  }

  // Stock lives on the product for stocked items and on the variations for
  // parts sold in several packagings; take the largest we can see.
  let stock = parseInt(product.QuantityAvailable, 10);
  if (!(stock > 0)) {
    for (const v of (product.ProductVariations || [])) {
      const q = parseInt(v.QuantityAvailableforPackageType, 10);
      if (q > 0 && (!(stock > 0) || q > stock)) stock = q;
    }
  }

  return {
    price: best ? best.price : 0,
    currency: 'USD',
    breakQty: best ? best.qty : 0,
    stock: String(stock > 0 ? stock : 0),
    mpn: product.ManufacturerProductNumber || '',
    exactMatch: exact,
    manufacturer: (product.Manufacturer && product.Manufacturer.Name) || '',
    url: product.ProductUrl || '',
    datasheet: product.DatasheetUrl
      || (product.PrimaryDatasheet || '')
      || ((product.Product && product.Product.DatasheetUrl) || ''),
    status: (product.ProductStatus && product.ProductStatus.Status) || '',
  };
}

function digikeyHeaders(token, clientId) {
  return {
    'Authorization': `Bearer ${token}`,
    'X-DIGIKEY-Client-Id': clientId,
    'X-DIGIKEY-Locale-Site': 'US',
    'X-DIGIKEY-Locale-Language': 'en',
    'X-DIGIKEY-Locale-Currency': 'USD',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/* DigiKey lookup, in order of precision.
 *
 * The first version of this used only KeywordSearch with Limit 10, and found
 * 190 of 995 parts. KeywordSearch is a relevance-ranked *text* search: for
 * connector/wire part numbers like "55A0121-20-0/9" or "382A023-25-0" the
 * matching product is frequently outside the first 10 hits, or the query is
 * tokenised in a way that doesn't surface it at all — so parts that are plainly
 * on digikey.com came back "not found".
 *
 * ProductDetails is the endpoint built for this: it takes a manufacturer or
 * DigiKey part number directly and returns the best match plus any equivalents.
 * KeywordSearch stays as a fallback (with a much larger Limit) for the cases
 * ProductDetails 404s on, e.g. a partial or slightly-off part number. */
// DigiKey has moved this field around between API versions and endpoints:
// sometimes Description is an object, sometimes a plain string, and
// ProductDetails uses different keys again. Reading only one shape meant every
// candidate scored 0 — and with all scores equal the FIRST one wins, which is
// exactly the arbitrary pick this was meant to remove. Try them all.
function digikeyDesc(p) {
  if (!p) return '';
  const d = p.Description;
  const parts = [];
  if (typeof d === 'string') parts.push(d);
  else if (d && typeof d === 'object') parts.push(d.ProductDescription, d.DetailedDescription, d.Value);
  parts.push(p.ProductDescription, p.DetailedDescription, p.ProductTitle);
  return parts.filter(Boolean).join(' ').trim();
}
function digikeyMfr(p) {
  const m = p && p.Manufacturer;
  return (typeof m === 'string' ? m : (m && (m.Name || m.Value))) || '';
}
function mouserDesc(p) {
  return [p && p.Description, p && p.ProductDetailUrl ? '' : '', p && p.Category]
    .filter(Boolean).join(' ').trim();
}

async function lookupDigiKey(pn, qty, clientId, clientSecret, desc) {
  const token = await digikeyToken(clientId, clientSecret);
  const headers = digikeyHeaders(token, clientId);

  // ── 1. Exact product lookup ──
  try {
    const resp = await fetch(
      `https://api.digikey.com/products/v4/search/${encodeURIComponent(pn)}/productdetails`,
      { method: 'GET', headers, signal: AbortSignal.timeout(20000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const product = data.Product || data.product;
      if (product) {
        const exact = String(product.ManufacturerProductNumber || '').trim().toUpperCase()
                      === String(pn).trim().toUpperCase();
        // ProductDetails may itself report several manufacturers selling the
        // same spec number — that's the M81824/1-2 case. Score them all rather
        // than accepting whichever DigiKey happened to lead with.
        const siblings = Array.isArray(product.MatchingProducts) && product.MatchingProducts.length
          ? product.MatchingProducts : null;
        if (siblings) {
          const m = matchPart(siblings, pn, p => p.ManufacturerProductNumber, desc, digikeyDesc, digikeyMfr);
          if (m) {
            const pick = chooseCandidate(m.pool, it => readDigiKeyProduct(it, qty, m.exact));
            return { ...pick.info,
                     considered: m.considered, descScore: pick.score, desc: pick.desc,
                     chosenBy: pick.chosenBy,
                     candidates: m.pool.map(c => ({ pn: c.pn, mfr: c.mfr, desc: c.desc, score: c.score,
                                                    price: (readDigiKeyProduct(c.item, qty, m.exact) || {}).price || 0 })).slice(0, 8) };
          }
        }
        return { ...readDigiKeyProduct(product, qty, exact),
                 considered: 1, descScore: 0, desc: digikeyDesc(product) };
      }
    } else if (resp.status !== 404) {
      // 404 just means "no such part number" — anything else (401, 429, 5xx) is
      // a real problem the user needs to see rather than have masked by the
      // fallback silently returning nothing.
      if (resp.status === 401 || resp.status === 403) throw new Error(`DigiKey auth failed (HTTP ${resp.status}) — check credentials/API access`);
      if (resp.status === 429) throw new Error('DigiKey rate limit reached (HTTP 429) — try again shortly');
    }
  } catch (e) {
    if (/auth failed|rate limit/.test(e.message)) throw e;
    // Network hiccup on the precise path: fall through and try the search.
  }

  // ── 2. Keyword search fallback ──
  const resp = await fetch('https://api.digikey.com/products/v4/search/keyword', {
    method: 'POST',
    headers,
    body: JSON.stringify({ Keywords: pn, Limit: 50, Offset: 0 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('DigiKey rate limit reached (HTTP 429) — try again shortly');
    throw new Error(`DigiKey HTTP ${resp.status}`);
  }
  const data = await resp.json();
  // v4 nests results under ExactMatches/Products depending on the query.
  const products = [...(data.ExactMatches || []), ...(data.Products || [])];
  const m = matchPart(products, pn, p => p.ManufacturerProductNumber, desc, digikeyDesc, digikeyMfr);
  if (!m) return null;
  const pick = chooseCandidate(m.pool, it => readDigiKeyProduct(it, qty, m.exact));
  return { ...pick.info,
           considered: m.considered, descScore: pick.score, desc: pick.desc,
           chosenBy: pick.chosenBy,
           candidates: m.pool.map(c => ({ pn: c.pn, mfr: c.mfr, desc: c.desc, score: c.score,
                                          price: (readDigiKeyProduct(c.item, qty, m.exact) || {}).price || 0 })).slice(0, 8) };
}

/* Online Components lookup — their Inventory & Pricing API.
 * GET https://api.onlinecomponents.com/wapi/v1/{ApiName}/{Query}/{InStockOnly}/{ExactMatch}/{ResultsCount}/{ApiKey}
 * (OpenAPI: /wapi/docs/v1/docs.json). The key travels in the path, so it is
 * never logged — errors below are reported without the URL. Exact match is
 * off: our matchPart() decides, as with the other vendors, so a part number
 * written with other punctuation is still found and a neighbour is not.
 * Prices come back as strings in `price_breaks` [{pricebreak, pricelist}],
 * stock in `quantityAvailable`, the unit in `unitOfMeasure` (EA, FT, M …). */
const OC_BASE = 'https://api.onlinecomponents.com/wapi/v1';
const OC_DEFAULT_API_NAME = 'cgpriceavailability';
function readOnlineCompPart(part, qty, exact) {
  const breaks = (part.price_breaks || []).map(b => ({ qty: parseInt(b.pricebreak, 10) || 0, price: numFrom(b.pricelist) }));
  const best = pickNearestBreak(breaks, qty);
  const stock = parseInt(String(part.quantityAvailable || '').replace(/[^\d]/g, ''), 10) || 0;
  return {
    price: best ? best.price : 0,
    currency: part.currency || 'USD',
    breakQty: best ? best.qty : 0,
    stock: String(stock),
    mpn: part.partNumber || '',
    exactMatch: exact,
    manufacturer: part.manufacturer || '',
    // Their product links carry referral tags for the partner channel; the
    // page itself is what the user needs.
    url: String(part.productUrl || '').replace(/[?#].*$/, ''),
    datasheet: part.datasheetUrl || '',
    status: part.productLifeCycle || part.productStatus || '',
    uom: String(part.unitOfMeasure || '').trim().toUpperCase(),
    moq: parseInt(part.moq, 10) || 0,
    leadTime: part.factoryLeadTime || '',
  };
}
async function lookupOnlineComp(pn, qty, apiKey, apiName, desc) {
  const url = `${OC_BASE}/${encodeURIComponent(apiName || OC_DEFAULT_API_NAME)}/${encodeURIComponent(pn)}/false/false/50/${encodeURIComponent(apiKey)}`;
  let resp;
  try { resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error('Online Components: ' + (e.name === 'TimeoutError' ? 'timed out' : 'network error')); }
  if (resp.status === 401 || resp.status === 403) throw new Error(`Online Components auth failed (HTTP ${resp.status}) — check the API key and API name`);
  if (resp.status === 429) throw new Error('Online Components rate limit reached (HTTP 429) — try again shortly');
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Online Components HTTP ${resp.status}`);
  const data = await resp.json().catch(() => null);
  const parts = Array.isArray(data) ? data : [];
  const m = matchPart(parts, pn, p => p.partNumber, desc, p => p.description || '', p => p.manufacturer);
  if (!m) return null;
  const pick = chooseCandidate(m.pool, it => readOnlineCompPart(it, qty, m.exact));
  return { ...pick.info,
           considered: m.considered, descScore: pick.score, desc: pick.desc,
           chosenBy: pick.chosenBy,
           candidates: m.pool.map(c => ({ pn: c.pn, mfr: c.mfr, desc: c.desc, score: c.score,
                                          price: (readOnlineCompPart(c.item, qty, m.exact) || {}).price || 0 })).slice(0, 8) };
}

/* Farnell lookup — the element14 Product Search API (REST), the official API
 * behind farnell.com / newark.com / element14.com.
 * GET https://api.element14.com/catalog/products?term=manuPartNum:<PN>&storeInfo.id=il.farnell.com
 *     &resultsSettings.responseGroup=large&callInfo.responseDataFormat=JSON&callInfo.apiKey=<key>
 * Needs a free key from partner.element14.com. Their web site cannot be read
 * from a server (it answers "Access Denied" to anything that is not a
 * browser), so without a key the app only offers the search link.
 * storeInfo.id picks the country store and its currency: il.farnell.com
 * prices in US$. The key travels in the query string, so errors below never
 * include the URL. Prices are per unit of sale: a "pack of 100" is priced per
 * pack, so it is divided by packSize to give the per-piece price the app
 * compares with the other vendors (a part pack bought for fewer pieces is
 * charged in full); metre goods stay per metre. */
const FARNELL_BASE = 'https://api.element14.com/catalog/products';
const FARNELL_DEFAULT_STORE = 'il.farnell.com';
const FARNELL_STORE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
function farnellStore(v) {
  const s = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return FARNELL_STORE_RE.test(s) ? s : FARNELL_DEFAULT_STORE;
}
function farnellIsMetre(p) {
  const u = `${p.unitOfMeasureCode || ''} ${p.unitOfMeasure || ''} ${p.packageName || ''}`.toUpperCase();
  return /(^|\W)(M|MTR|METER|METRE|METERS|METRES)(\W|$)/.test(u) && !/REEL OF|PACK OF/.test(u);
}
function readFarnellPart(p, qty, exact, store) {
  const metre = farnellIsMetre(p);
  const pack = metre ? 1 : Math.max(1, parseInt(p.packSize, 10) || 1);
  const list = Array.isArray(p.prices) ? p.prices : (p.prices ? [p.prices] : []);
  // A pack is bought whole: 5 pieces from a pack of 100 cost the whole pack.
  // So the per-piece price is what the packs needed for this quantity cost,
  // spread over the pieces actually wanted — never less than cost / pack.
  const want = qty > 0 ? qty : 1;
  const packs = Math.ceil(want / pack);
  const inPacks = list.map(b => ({ qty: parseInt(b.from, 10) || 1, price: numFrom(b.cost) }));
  const nb = pickNearestBreak(inPacks, packs);
  const best = nb ? { qty: nb.qty * pack, price: pack > 1 ? nb.price * packs / Math.max(want, 1) : nb.price } : null;
  const st = p.stock || {};
  const stock = parseInt(st.level != null ? st.level : p.inv, 10) || 0;
  const sheet = Array.isArray(p.datasheets) && p.datasheets.length ? p.datasheets[0].url : '';
  return {
    price: best ? +best.price.toFixed(6) : 0,
    currency: 'USD',
    breakQty: best ? best.qty : 0,
    stock: String(stock),
    mpn: p.translatedManufacturerPartNumber || '',
    exactMatch: exact,
    manufacturer: p.brandName || p.vendorName || '',
    url: String(p.productURL || '').replace(/[?#].*$/, '') || (p.sku ? `https://${store}/search?st=${encodeURIComponent(p.sku)}` : ''),
    sku: p.sku || '',
    datasheet: sheet || '',
    status: p.productStatus || '',
    uom: metre ? 'M' : 'EA',
    packSize: pack,
    moq: parseInt(p.translatedMinimumOrderQuality, 10) || 0,
  };
}
async function _farnellFetch(url) {
  // Default keys allow a couple of calls per second; a Check Price runs
  // several parts at once, so an "over QPS" answer is retried after a pause.
  for (let attempt = 0; ; attempt++) {
    let resp;
    try { resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw new Error('Farnell: ' + (e.name === 'TimeoutError' ? 'timed out' : 'network error')); }
    let data = null;
    try { data = await resp.json(); } catch { /* status below */ }
    const errMsg = data && data.error ? String(data.error.message || '') : '';
    const fault = data && data.Fault ? String((data.Fault.Reason && data.Fault.Reason.Text) || data.Fault.faultstring || '') : '';
    if ((resp.status === 403 || resp.status === 429) && /QPS|rate|over/i.test(errMsg) && !/Over Rate/i.test(errMsg) && attempt < 3) {
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      continue;
    }
    if (/Over Rate/i.test(errMsg)) throw new Error('Farnell daily call limit reached — try again tomorrow');
    if (resp.status === 401 || resp.status === 403) throw new Error(`Farnell auth failed (HTTP ${resp.status}${errMsg ? ': ' + errMsg : ''}) — check the API key`);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      // "Manufacturer Part Number is not valid" (200004) just means: no such part.
      if (/not valid|200004|200001/i.test(errMsg + ' ' + fault)) return null;
      throw new Error(`Farnell HTTP ${resp.status}${errMsg ? ': ' + errMsg : ''}`);
    }
    return data;
  }
}
async function lookupFarnell(pn, qty, apiKey, store, desc) {
  const st = farnellStore(store);
  const q = new URLSearchParams({
    versionNumber: '1.5',
    term: `manuPartNum:${pn}`,
    'storeInfo.id': st,
    'resultsSettings.offset': '0',
    'resultsSettings.numberOfResults': '20',
    'resultsSettings.responseGroup': 'large',
    'callInfo.responseDataFormat': 'JSON',
    'callInfo.apiKey': apiKey,
  });
  const data = await _farnellFetch(`${FARNELL_BASE}?${q}`);
  if (!data) return null;
  const ret = data.manufacturerPartNumberSearchReturn || data.keywordSearchReturn || data.premierFarnellPartNumberReturn || {};
  const parts = Array.isArray(ret.products) ? ret.products : (ret.products ? [ret.products] : []);
  const m = matchPart(parts, pn, p => p.translatedManufacturerPartNumber, desc, p => p.displayName || '', p => p.brandName || p.vendorName, p => p.sku);
  if (!m) return null;
  const pick = chooseCandidate(m.pool, it => readFarnellPart(it, qty, m.exact, st));
  return { ...pick.info,
           considered: m.considered, descScore: pick.score, desc: pick.desc,
           chosenBy: pick.chosenBy,
           candidates: m.pool.map(c => ({ pn: c.pn, mfr: c.mfr, desc: c.desc, score: c.score,
                                          price: (readFarnellPart(c.item, qty, m.exact, st) || {}).price || 0 })).slice(0, 8) };
}

/* Adhesive bottles — "which bottle fits best".
 * A glue is listed on the drawing in ml but bought by the bottle, and the same
 * product comes in several sizes (10 ml, 50 ml, 250 ml …), each its own part
 * number. With ?family=<product name>&need=<ml> the price function searches
 * every configured vendor by keyword for that product, keeps the listings that
 * name it AND state a bottle size, and prices each for the bottles needed:
 * bottles = ceil(need / size), cost = bottles × the price at that quantity.
 * The client picks the cheapest; ties go to the least left over. */
function parsePackMl(text) {
  const s = String(text || '');
  let m = /(\d+(?:[.,]\d+)?)\s*(?:ML|MILLILIT(?:ER|RE)S?|CC)\b/i.exec(s);
  if (m) return +parseFloat(m[1].replace(',', '.')).toFixed(3);
  m = /(\d+(?:[.,]\d+)?)\s*(?:L|LT|LTR|LIT(?:ER|RE)S?)\b/i.exec(s);
  if (m) return +(parseFloat(m[1].replace(',', '.')) * 1000).toFixed(3);
  m = /(\d+(?:[.,]\d+)?)\s*FL\.?\s*OZ\b/i.exec(s);
  if (m) return +(parseFloat(m[1].replace(',', '.')) * 29.5735).toFixed(1);
  return 0;
}
function familyTokens(family) {
  return String(family || '').toUpperCase()
    .replace(/\d+(?:[.,]\d+)?\s*(?:ML|CC|L|LT|LTR|G|GR|OZ)\b/g, ' ')
    .split(/[^A-Z0-9]+/).filter(t => t.length >= 2 && !/^(ML|THE|AND|FOR|OF)$/.test(t));
}
function namesFamily(hay, tokens) {
  const H = ' ' + String(hay || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
  return tokens.length > 0 && tokens.every(t => H.includes(' ' + t + ' '));
}
function bottleOffer(item, need, mpn, mfr, desc, read) {
  const ml = parsePackMl(`${desc} ${mpn}`);
  if (!(ml > 0)) return null;
  const bottles = Math.max(1, Math.ceil(need / ml - 1e-9));
  const info = read(item, bottles) || {};
  if (!(info.price > 0)) return null;
  return { mpn: mpn || info.mpn || '', manufacturer: mfr || info.manufacturer || '', desc: String(desc || '').slice(0, 140),
           ml, bottles, price: +(+info.price).toFixed(6), breakQty: info.breakQty || 0,
           total: +(info.price * bottles).toFixed(4), waste: +(ml * bottles - need).toFixed(3),
           stock: String(info.stock || '0'), url: info.url || '', uom: info.uom || '' };
}
function rankOffers(list) {
  return list.filter(Boolean)
    .sort((a, b) => a.total - b.total || a.waste - b.waste || ((+b.stock > 0) - (+a.stock > 0)))
    .slice(0, 8);
}
async function bottleOffersFor(vendor, family, need, creds) {
  const tokens = familyTokens(family);
  if (!tokens.length) return [];
  const keep = (hay) => namesFamily(hay, tokens);
  if (vendor === 'mouser') {
    const parts = await mouserPost('search/keyword', creds.mouser_api_key,
      { SearchByKeywordRequest: { keyword: family, records: 50, startingRecord: 0 } });
    return rankOffers(parts.filter(p => keep(`${p.Manufacturer} ${p.ManufacturerPartNumber} ${mouserDesc(p)}`))
      .map(p => bottleOffer(p, need, p.ManufacturerPartNumber, p.Manufacturer, mouserDesc(p), (it, q) => readMouserPart(it, q, false))));
  }
  if (vendor === 'digikey') {
    const token = await digikeyToken(creds.digikey_client_id, creds.digikey_client_secret);
    const resp = await fetch('https://api.digikey.com/products/v4/search/keyword', {
      method: 'POST', headers: digikeyHeaders(token, creds.digikey_client_id),
      body: JSON.stringify({ Keywords: family, Limit: 50, Offset: 0 }), signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error(`DigiKey HTTP ${resp.status}`);
    const data = await resp.json();
    const products = [...(data.ExactMatches || []), ...(data.Products || [])];
    const seen = new Set();
    return rankOffers(products.filter(p => {
      const k = p.ManufacturerProductNumber; if (seen.has(k)) return false; seen.add(k);
      return keep(`${digikeyMfr(p)} ${p.ManufacturerProductNumber} ${digikeyDesc(p)}`);
    }).map(p => bottleOffer(p, need, p.ManufacturerProductNumber, digikeyMfr(p), digikeyDesc(p), (it, q) => readDigiKeyProduct(it, q, false))));
  }
  if (vendor === 'onlinecomp') {
    const url = `${OC_BASE}/${encodeURIComponent(creds.onlinecomp_api_name || OC_DEFAULT_API_NAME)}/${encodeURIComponent(family)}/false/false/50/${encodeURIComponent(creds.onlinecomp_api_key)}`;
    let resp;
    try { resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw new Error('Online Components: network error'); }
    if (resp.status === 404) return [];
    if (!resp.ok) throw new Error(`Online Components HTTP ${resp.status}`);
    const data = await resp.json().catch(() => null);
    const parts = Array.isArray(data) ? data : [];
    return rankOffers(parts.filter(p => keep(`${p.manufacturer} ${p.partNumber} ${p.description}`))
      .map(p => bottleOffer(p, need, p.partNumber, p.manufacturer, p.description || '', (it, q) => readOnlineCompPart(it, q, false))));
  }
  if (vendor === 'farnell') {
    const st = farnellStore(creds.farnell_store);
    const q = new URLSearchParams({ versionNumber: '1.5', term: `any:${family}`, 'storeInfo.id': st,
      'resultsSettings.offset': '0', 'resultsSettings.numberOfResults': '25', 'resultsSettings.responseGroup': 'large',
      'callInfo.responseDataFormat': 'JSON', 'callInfo.apiKey': creds.farnell_api_key });
    const data = await _farnellFetch(`${FARNELL_BASE}?${q}`);
    if (!data) return [];
    const ret = data.keywordSearchReturn || data.manufacturerPartNumberSearchReturn || {};
    const parts = Array.isArray(ret.products) ? ret.products : (ret.products ? [ret.products] : []);
    return rankOffers(parts.filter(p => keep(`${p.brandName || ''} ${p.translatedManufacturerPartNumber || ''} ${p.displayName || ''}`))
      .map(p => bottleOffer(p, need, p.translatedManufacturerPartNumber, p.brandName || p.vendorName, p.displayName || '', (it, q2) => readFarnellPart(it, q2, false, st))));
  }
  return [];
}
async function bottleSearch(family, need, creds) {
  const out = { family, need, offers: {}, errors: [] };
  const have = {
    mouser: !!creds.mouser_api_key,
    digikey: !!(creds.digikey_client_id && creds.digikey_client_secret),
    onlinecomp: !!creds.onlinecomp_api_key,
    farnell: !!creds.farnell_api_key,
  };
  await Promise.all(Object.keys(have).filter(v => have[v]).map(async v => {
    try { out.offers[v] = await bottleOffersFor(v, family, need, creds); }
    catch (e) { out.errors.push(String(e.message || `${v} bottle search failed`)); }
  }));
  return out;
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

    // ── Auth: an enabled SpecPrice user — a sign-in account alone is not enough ──
    if (REQUIRE_AUTH) {
      try { const who = await requireMember(req); await enforceRate(who.uid, 'price'); }
      catch (e) { return void res.status(e.code || 401).json({ error: e.message }); }
    }

    const pn = String(req.query.pn || '').trim();
    const qty = parseInt(req.query.qty, 10) || 1;
    // The BOM description, used only to choose between several products that
    // share this part number (see matchPart). Capped: it's a tie-breaker, not
    // a search query.
    const desc = String(req.query.desc || '').slice(0, 300);
    // Bottle sizes of an adhesive (see bottleSearch): a different question, same door.
    const family = String(req.query.family || '').trim().slice(0, 80);
    if (family) {
      const need = Math.max(0, parseFloat(req.query.need) || 0);
      const out = await bottleSearch(family, need, await getCredentials());
      res.set('Cache-Control', 'private, max-age=900');
      return void res.status(200).json(out);
    }
    if (!pn) return void res.status(400).json({ error: 'Missing ?pn=' });

    const out = { pn, qty, mouser: null, digikey: null, onlinecomp: null, farnell: null, errors: [] };

    // Both vendors are queried in parallel and failures are isolated: a missing
    // key or a vendor outage must never take the other one down with it.
    const creds = await getCredentials();
    const mouserKey = creds.mouser_api_key;
    const dkId = creds.digikey_client_id;
    const dkSecret = creds.digikey_client_secret;
    const ocKey = creds.onlinecomp_api_key;
    const faKey = creds.farnell_api_key;

    await Promise.all([
      (async () => {
        // Not configured is not an error worth showing: most installs start with
        // Mouser / DigiKey only.
        if (!ocKey) return;
        try { out.onlinecomp = await lookupOnlineComp(pn, qty, ocKey, creds.onlinecomp_api_name, desc); }
        catch (e) { out.errors.push(e.message || 'Online Components lookup failed'); }
      })(),
      (async () => {
        if (!faKey) return;
        try { out.farnell = await lookupFarnell(pn, qty, faKey, creds.farnell_store, desc); }
        catch (e) { out.errors.push(e.message || 'Farnell lookup failed'); }
      })(),
      (async () => {
        if (!mouserKey) { out.errors.push('Mouser: no API key configured'); return; }
        try { out.mouser = await lookupMouser(pn, qty, mouserKey, desc); }
        catch (e) { out.errors.push(e.message || 'Mouser lookup failed'); }
      })(),
      (async () => {
        if (!dkId || !dkSecret) { out.errors.push('DigiKey: no credentials configured'); return; }
        try { out.digikey = await lookupDigiKey(pn, qty, dkId, dkSecret, desc); }
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
 * Mouser and DigiKey: only this Cloud Function ever talks to them, so the
 * credentials live server-side — and, critically, are NEVER readable by the
 * browser. The Anthropic key now follows the same path (see aiProxy below):
 * it used to sit in each admin's localStorage and in the company document,
 * where any signed-in user could read it.
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
const CRED_FIELDS = ['mouser_api_key', 'digikey_client_id', 'digikey_client_secret', 'onlinecomp_api_key', 'onlinecomp_api_name', 'farnell_api_key', 'farnell_store'];

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
    onlinecomp_api_key: (process.env.ONLINECOMP_API_KEY || '').trim(),
    onlinecomp_api_name: (process.env.ONLINECOMP_API_NAME || '').trim(),
    farnell_api_key: (process.env.FARNELL_API_KEY || '').trim(),
    farnell_store: (process.env.FARNELL_STORE || '').trim(),
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
  // checkRevoked: a disabled or deleted account is refused at once, not when
  // its last ID token expires an hour later.
  try { decoded = await admin.auth().verifyIdToken(token, true); }
  catch { throw Object.assign(new Error('Invalid auth token'), { code: 401 }); }

  const snap = await admin.firestore().doc(`users/${decoded.uid}`).get();
  const u = snap.exists ? (snap.data() || {}) : {};
  if (u.role !== 'admin' || u.disabled === true) {
    throw Object.assign(new Error('Admin role required'), { code: 403 });
  }
  decoded.profile = u;
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
          onlinecomp: {
            configured: !!creds.onlinecomp_api_key,
            hint: hint(creds.onlinecomp_api_key),
            // The API name is not a secret: shown in full so a typo is visible.
            apiName: creds.onlinecomp_api_name || OC_DEFAULT_API_NAME,
            source: meta.onlinecomp_api_key ? 'ui' : (creds.onlinecomp_api_key ? 'env-var' : null),
          },
          farnell: {
            configured: !!creds.farnell_api_key,
            hint: hint(creds.farnell_api_key),
            store: farnellStore(creds.farnell_store),
            source: meta.farnell_api_key ? 'ui' : (creds.farnell_api_key ? 'env-var' : null),
          },
          // Normally a Firestore Timestamp, but tolerate a plain Date or an
          // ISO string too — a stale field format must not 500 the whole panel
          // and hide the configured/not answer the admin actually came for.
          updatedAt: toIso(meta.updatedAt),
          updatedBy: meta.updatedBy || '',
          anthropic: await aiKeyStatus(),
        });
      }

      if (req.method !== 'POST') return void res.status(405).json({ error: 'Use GET or POST' });

      const body = req.body || {};

      // ── Live test of the AI key — one tiny request, a few tokens ──
      if (body.action === 'test_ai') {
        const key = await getAiKey();
        if (!key) return void res.status(200).json({ ok: false, skipped: true, message: 'Not configured' });
        try {
          const r = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
            body: JSON.stringify({ model: AI_TEST_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
            signal: AbortSignal.timeout(30000),
          });
          if (r.ok) return void res.status(200).json({ ok: true, message: 'Connected — the key works' });
          let m = `Anthropic error ${r.status}`;
          try { const e = await r.json(); m = (e.error && e.error.message) || m; } catch { /* keep status */ }
          return void res.status(200).json({ ok: false, message: m });
        } catch (e) {
          return void res.status(200).json({ ok: false, message: e.message || 'Request failed' });
        }
      }

      // ── Live test: prove the credentials actually work ──
      // Saving a typo'd key looks identical to saving a good one until the
      // next price check fails, so let the admin verify on the spot.
      // Tests the SAVED credentials — so click Save before Test.
      if (body.action === 'test') {
        const creds = await getCredentials();
        const pn = String(body.pn || '').trim() || '1-794610-2';
        const result = { pn, mouser: null, digikey: null, onlinecomp: null, farnell: null };

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

        result.onlinecomp = !creds.onlinecomp_api_key
          ? { ok: false, skipped: true, message: 'Not configured — skipped' }
          : await lookupOnlineComp(pn, 1, creds.onlinecomp_api_key, creds.onlinecomp_api_name).then(
              r => ({ ok: true, message: r ? `Found — $${r.price} @ qty ${r.breakQty}` : 'Connected, but this part was not found' }),
              e => ({ ok: false, message: e.message }));

        result.farnell = !creds.farnell_api_key
          ? { ok: false, skipped: true, message: 'Not configured — skipped' }
          : await lookupFarnell(pn, 1, creds.farnell_api_key, creds.farnell_store).then(
              r => ({ ok: true, message: r ? `Found — $${r.price} @ qty ${r.breakQty}` : 'Connected, but this part was not found' }),
              e => ({ ok: false, message: e.message }));

        return void res.status(200).json(result);
      }

      // ── Write ──
      const update = {};
      const changed = [];

      // The AI key has its own document: it is read by a different function,
      // and keeping it apart means a distributor save can never touch it.
      if ('anthropic_api_key' in body) {
        const v = String(body.anthropic_api_key == null ? '' : body.anthropic_api_key).trim();
        await admin.firestore().doc(AI_DOC).set({
          anthropic_api_key: v,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: user.email || user.uid,
        }, { merge: true });
        _aiKeyCache = null;
        changed.push('anthropic_api_key');
      }

      for (const f of CRED_FIELDS) {
        if (!(f in body)) continue;             // field omitted → leave as-is
        const v = String(body[f] == null ? '' : body[f]).trim();
        // An empty string is a deliberate "clear this credential", which is how
        // an admin revokes one. Blank fields the UI didn't submit never get here.
        update[f] = v;
        changed.push(f);
      }
      if (!changed.length) return void res.status(400).json({ error: 'Nothing to update' });

      if (Object.keys(update).length) {
        update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        update.updatedBy = user.email || user.uid;
        await admin.firestore().doc(CONFIG_DOC).set(update, { merge: true });
        _credCache = null; // force the next lookup to pick up the new values
      }

      // Deliberately logged without any credential material.
      console.log(`[apiConfig] ${user.email || user.uid} updated: ${changed.join(', ')}`);
      return void res.status(200).json({ ok: true, updated: changed });
    } catch (e) {
      console.error('[apiConfig]', e);
      return void res.status(500).json({ error: e.message || 'Internal error' });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
 * AI PROXY — every Claude request from the app goes through here
 * ---------------------------------------------------------------------------
 * The browser used to call api.anthropic.com itself, which meant the key had
 * to be IN the browser: in localStorage, and in the company document that any
 * signed-in user can read. Anyone who opened devtools could copy it and spend
 * the account's credit from anywhere.
 *
 * Now the browser sends the same request body here, with its Firebase ID
 * token instead of a key. This function checks the caller is a real, enabled
 * user, adds the key from secure_config/ai_api (denied to every client, like
 * the distributor credentials), forwards the request, and returns Anthropic's
 * status and JSON unchanged — so the app reads the answer, and every error,
 * exactly as it did before.
 *
 * Deliberately narrow: only the Messages API, only Claude models, only the
 * fields the app actually sends, and a cap on max_tokens. It is not a general
 * door to the account.
 *
 * GET returns { configured } so the app knows whether to use this path. While
 * the key is not set here, the app keeps working the old way (browser key).
 * ═══════════════════════════════════════════════════════════════════════════ */

const AI_DOC = 'secure_config/ai_api';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const AI_TEST_MODEL = 'claude-haiku-4-5-20251001';
const AI_MODEL_RE = /^claude-[a-z0-9.\-]+$/i;
const AI_MAX_TOKENS = 32000;
// The fields the app sends. Anything else (tools, streaming, metadata …) is
// dropped rather than forwarded: the proxy only has to do what the app does.
const AI_FIELDS = ['model', 'max_tokens', 'temperature', 'messages', 'system', 'stop_sequences', 'top_p', 'top_k'];
// The only tools a request may carry: Anthropic's own server-side web search
// and web fetch (used to look up a crimp contact's tool in the maker's product
// page or datasheet). They run at Anthropic and reach no system of ours.
// Anything else under "tools" — client tools, other server tools — is dropped;
// one of each at most, with the number of uses and the page size capped.
const AI_WEB_TOOLS = {
  web_search: { re: /^web_search_\d{8}$/, max: 12 },
  web_fetch:  { re: /^web_fetch_\d{8}$/,  max: 8 },
};
const AI_WEB_SEARCH_MAX_USES = AI_WEB_TOOLS.web_search.max;
const AI_WEB_FETCH_MAX_CONTENT = 40000;
function aiSafeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = [];
  for (const [name, rule] of Object.entries(AI_WEB_TOOLS)) {
    const t = tools.find(x => x && typeof x === 'object' && x.name === name && rule.re.test(String(x.type || '')));
    if (!t) continue;
    const safe = { type: t.type, name, max_uses: Math.max(1, Math.min(rule.max, parseInt(t.max_uses, 10) || 5)) };
    if (name === 'web_fetch')
      safe.max_content_tokens = Math.max(1000, Math.min(AI_WEB_FETCH_MAX_CONTENT, parseInt(t.max_content_tokens, 10) || AI_WEB_FETCH_MAX_CONTENT));
    out.push(safe);
  }
  return out.length ? out : undefined;
}
// Under the function's own 540s limit, above the app's longest wait (300s).
const AI_UPSTREAM_TIMEOUT_MS = 520000;

let _aiKeyCache = null, _aiKeyCacheExp = 0;
async function getAiKey() {
  if (_aiKeyCache !== null && Date.now() < _aiKeyCacheExp) return _aiKeyCache;
  let key = (process.env.ANTHROPIC_API_KEY || '').trim();
  try {
    const snap = await admin.firestore().doc(AI_DOC).get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.anthropic_api_key) key = String(d.anthropic_api_key).trim();
    }
  } catch (e) {
    console.warn('[aiKey] Firestore read failed, using env only:', e.message);
  }
  _aiKeyCache = key;
  _aiKeyCacheExp = Date.now() + 60000;
  return key;
}

async function aiKeyStatus() {
  const key = await getAiKey();
  let meta = {};
  try {
    const snap = await admin.firestore().doc(AI_DOC).get();
    if (snap.exists) meta = snap.data() || {};
  } catch { /* status still useful without metadata */ }
  return {
    configured: !!key,
    hint: hint(key),
    source: meta.anthropic_api_key ? 'ui' : (key ? 'env-var' : null),
    updatedAt: toIso(meta.updatedAt),
    updatedBy: meta.updatedBy || '',
  };
}

// A signed-in account is not quite enough: the same users/{uid} document the
// app reads at login must exist and must not be disabled — the AI costs money.
async function requireMember(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Missing auth token'), { code: 401 });
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token, true); }
  catch { throw Object.assign(new Error('Invalid auth token — sign in again'), { code: 401 }); }
  const snap = await admin.firestore().doc(`users/${decoded.uid}`).get();
  const u = snap.exists ? (snap.data() || {}) : null;
  if (!u) throw Object.assign(new Error('No user profile for this account'), { code: 403 });
  if (u.disabled === true) throw Object.assign(new Error('This account has been disabled'), { code: 403 });
  return decoded;
}

// Errors in Anthropic's own shape, so the app's existing `e.error.message`
// reading shows them without any special case.
function aiError(res, status, message) {
  return void res.status(status).json({ type: 'error', error: { type: 'proxy_error', message } });
}

exports.aiProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
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
    if (!originAllowed) return aiError(res, 403, `Origin not allowed: ${origin}`);

    let user;
    try { user = await requireMember(req); }
    catch (e) { return aiError(res, e.code || 401, e.message); }

    if (req.method === 'GET') {
      return void res.status(200).json({ configured: !!(await getAiKey()) });
    }
    if (req.method !== 'POST') return aiError(res, 405, 'Use GET or POST');

    try { await enforceRate(user.uid, 'ai'); }
    catch (e) { return aiError(res, e.code || 429, e.message); }

    const key = await getAiKey();
    if (!key) {
      return aiError(res, 503,
        'No Anthropic key is configured on the server — an admin can add one in Admin → AI API Keys.');
    }

    const src = (req.body && typeof req.body === 'object') ? req.body : null;
    if (!src) return aiError(res, 400, 'Request body must be JSON');
    if (!AI_MODEL_RE.test(String(src.model || ''))) return aiError(res, 400, `Model not allowed: ${src.model}`);
    if (!Array.isArray(src.messages) || !src.messages.length) return aiError(res, 400, 'messages is required');
    const maxTok = Number(src.max_tokens);
    if (!(maxTok > 0) || maxTok > AI_MAX_TOKENS) return aiError(res, 400, `max_tokens must be 1–${AI_MAX_TOKENS}`);

    const body = {};
    for (const f of AI_FIELDS) if (src[f] !== undefined) body[f] = src[f];
    const tools = aiSafeTools(src.tools);
    if (tools) body.tools = tools;

    const t0 = Date.now();
    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      console.error('[aiProxy] upstream failed:', e.message);
      return aiError(res, 502, `Could not reach Anthropic: ${e.message}`);
    }
    const text = await upstream.text();
    // Who, which model, how big, how it went — never the content.
    console.log(`[aiProxy] ${user.email || user.uid} ${body.model} max=${maxTok} ` +
                `→ ${upstream.status} in ${Date.now() - t0}ms (${text.length} chars)`);
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return void res.send(text);
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
 * USER ADMINISTRATION — create / change / disable / delete a user
 * ---------------------------------------------------------------------------
 * Who may sign in, with which role and for which company, is decided here and
 * only here. The browser used to do it: it called Firebase's public sign-up
 * endpoint and wrote users/{uid} itself, which meant (a) anyone with the web
 * API key could open an account, and (b) the profile — role included — was a
 * document its owner could write. Now the Firestore rules let nobody but an
 * admin write a profile, sign-up can be switched off in the Firebase console,
 * and this function does the work with the Admin SDK:
 *   • create  — the sign-in account and the profile together (rolled back if
 *               the profile cannot be written);
 *   • update  — role / company / name / disabled. Disabling also disables the
 *               sign-in account and revokes its sessions, so it takes effect
 *               at once on every device;
 *   • delete  — the sign-in account AND the profile; the old account can no
 *               longer sign in or re-create anything.
 * An admin cannot demote, disable or delete themselves, and the last active
 * admin cannot be removed — either would lock everyone out of Settings.
 * Every action is written to the acting admin's company audit log from the
 * server, under the admin's real email.
 * ═══════════════════════════════════════════════════════════════════════════ */
const SEED_ROLES = ['admin', 'agent', 'sales', 'viewer'];
const ROLE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

function userAdminError(code, message) { return Object.assign(new Error(message), { code }); }

async function validRole(role) {
  if (!ROLE_RE.test(String(role || ''))) return false;
  if (SEED_ROLES.includes(role)) return true;
  const snap = await admin.firestore().doc(`roles/${role}`).get();
  return snap.exists;
}
async function validCompany(cid) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(String(cid || ''))) return false;
  return (await admin.firestore().doc(`companies/${cid}`).get()).exists;
}
// How many enabled admins the company has, not counting `exceptUid`.
async function otherActiveAdmins(exceptUid, cid) {
  const snap = await admin.firestore().collection('users').where('role', '==', 'admin').get();
  return snap.docs.filter(d => d.id !== exceptUid && (d.data() || {}).disabled !== true
                            && (d.data() || {}).company_id === cid).length;
}
async function serverAudit(actor, action, details, success) {
  const cid = actor && actor.profile && actor.profile.company_id;
  if (!cid) return;
  try {
    await admin.firestore().collection(`companies/${cid}/audit_logs`).add({
      user: actor.email || actor.uid, userId: actor.uid, action, details, success: !!success,
      source: 'server', timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.warn('[userAdmin] audit write failed:', e.message); }
}

async function userAdminAction(actor, body) {
  const action = String(body.action || '');
  const fsUsers = admin.firestore().collection('users');
  // An admin manages the users of THEIR company only (same rule as Firestore).
  const myCid = String((actor.profile && actor.profile.company_id) || '');
  if (!myCid) throw userAdminError(403, 'Your admin profile has no company');

  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 100);
    const role = String(body.role || '').trim();
    const company_id = String(body.company_id || '').trim();
    if (!EMAIL_RE.test(email)) throw userAdminError(400, 'Enter a valid email address');
    if (!displayName) throw userAdminError(400, 'Name is required');
    if (password.length < MIN_PASSWORD) throw userAdminError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    if (!(await validRole(role))) throw userAdminError(400, `Unknown role: ${role}`);
    if (!(await validCompany(company_id))) throw userAdminError(400, 'Unknown company');
    if (company_id !== myCid) throw userAdminError(403, 'You can only add users to your own company');
    let rec;
    try { rec = await admin.auth().createUser({ email, password, displayName, disabled: false }); }
    catch (e) {
      if (e.code === 'auth/email-already-exists') throw userAdminError(409, 'A user with this email already exists');
      if (e.code === 'auth/invalid-password') throw userAdminError(400, `Password must be at least ${MIN_PASSWORD} characters`);
      throw userAdminError(400, e.message || 'Could not create the sign-in account');
    }
    try {
      await fsUsers.doc(rec.uid).set({
        email, displayName, company_id, role, disabled: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: actor.email || actor.uid,
      });
    } catch (e) {
      // No half-made users: an account without a profile is removed again.
      await admin.auth().deleteUser(rec.uid).catch(() => {});
      throw userAdminError(500, 'Could not save the user profile — nothing was created');
    }
    return { ok: true, uid: rec.uid, audit: ['user_created', { email, role }] };
  }

  const uid = String(body.uid || '').trim();
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) throw userAdminError(400, 'Missing user');
  const ref = fsUsers.doc(uid);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() || {}) : null;
  const self = uid === actor.uid;
  // A profile from before companies were assigned (no company_id) is adopted.
  if (cur && cur.company_id && cur.company_id !== myCid) throw userAdminError(403, 'This user belongs to another company');

  if (action === 'update') {
    if (!cur) throw userAdminError(404, 'No such user');
    const patch = {};
    if ('role' in body) {
      const role = String(body.role || '').trim();
      if (!(await validRole(role))) throw userAdminError(400, `Unknown role: ${role}`);
      patch.role = role;
    }
    if ('company_id' in body) {
      const cid = String(body.company_id || '').trim();
      if (!(await validCompany(cid))) throw userAdminError(400, 'Unknown company');
      if (cid !== myCid) throw userAdminError(403, 'You can only keep users in your own company');
      patch.company_id = cid;
    }
    if ('displayName' in body) {
      const n = String(body.displayName || '').trim().slice(0, 100);
      if (n) patch.displayName = n;
    }
    if ('disabled' in body) patch.disabled = body.disabled === true;
    const losesAdmin = cur.role === 'admin' && cur.disabled !== true &&
      ((patch.role && patch.role !== 'admin') || patch.disabled === true);
    if (self && losesAdmin) throw userAdminError(400, 'You cannot remove your own admin role or disable yourself');
    if (losesAdmin && (await otherActiveAdmins(uid, myCid)) === 0) throw userAdminError(400, 'This is the last active admin — make someone else admin first');
    if (!Object.keys(patch).length) throw userAdminError(400, 'Nothing to change');
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(patch);
    // The sign-in account follows the profile: disabled means no sign-in at
    // all, and every open session is ended now rather than within the hour.
    if ('disabled' in patch) {
      try {
        await admin.auth().updateUser(uid, { disabled: patch.disabled });
        if (patch.disabled) await admin.auth().revokeRefreshTokens(uid);
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw userAdminError(500, 'Profile saved, but the sign-in account could not be updated: ' + e.message);
      }
    }
    if ('displayName' in patch) await admin.auth().updateUser(uid, { displayName: patch.displayName }).catch(() => {});
    const { updatedAt, ...shown } = patch;
    return { ok: true, uid, audit: ['user_updated', { email: cur.email || uid, ...shown }] };
  }

  if (action === 'delete') {
    if (self) throw userAdminError(400, 'You cannot delete your own account');
    if (cur && cur.role === 'admin' && cur.disabled !== true && (await otherActiveAdmins(uid, myCid)) === 0)
      throw userAdminError(400, 'This is the last active admin — make someone else admin first');
    try { await admin.auth().deleteUser(uid); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw userAdminError(500, 'Could not delete the sign-in account: ' + e.message); }
    if (snap.exists) await ref.delete();
    return { ok: true, uid, audit: ['user_deleted', { email: (cur && cur.email) || uid }] };
  }

  throw userAdminError(400, `Unknown action: ${action}`);
}

exports.userAdmin = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB', cors: false },
  async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = !origin || ALLOWED_ORIGINS.some(re => re.test(origin));
    if (origin && originAllowed) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return void res.status(204).send('');
    if (!originAllowed) return void res.status(403).json({ error: `Origin not allowed: ${origin}` });
    if (req.method !== 'POST') return void res.status(405).json({ error: 'Use POST' });

    let actor;
    try { actor = await requireAdmin(req); }
    catch (e) { return void res.status(e.code || 401).json({ error: e.message }); }

    const body = req.body || {};
    try {
      const out = await userAdminAction(actor, body);
      const [act, details] = out.audit; delete out.audit;
      await serverAudit(actor, act, details, true);
      // Logged without any password.
      console.log(`[userAdmin] ${actor.email || actor.uid}: ${act} ${out.uid}`);
      return void res.status(200).json(out);
    } catch (e) {
      await serverAudit(actor, `user_${String(body.action || 'admin')}`, { error: e.message, uid: body.uid || '', email: body.email || '' }, false);
      return void res.status(e.code && e.code < 600 ? e.code : 500).json({ error: e.message || 'Failed' });
    }
  }
);
