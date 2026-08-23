/**
 * SpecPrice — price-check proxy (Cloud Function)
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * findchips.com serves normal web pages, not an API, so it never sends the
 * `Access-Control-Allow-Origin` header. Browsers therefore refuse to hand the
 * response to our JavaScript (Same-Origin Policy) even though the server
 * answered perfectly well. Server-to-server calls have no such restriction —
 * so this function fetches the page for us and returns it WITH the CORS header
 * the browser wants.
 *
 * It replaces the free public CORS proxies the app used to depend on, which
 * kept dying (corsproxy.io started returning HTTP 403, the rest timed out) and
 * took every price check down with them.
 *
 * THIS IS NOT AN OPEN PROXY — deliberately:
 *   • only the hosts in ALLOWED_HOSTS can be fetched;
 *   • only our own web origins get a CORS grant;
 *   • a valid Firebase ID token is required (REQUIRE_AUTH).
 * An unrestricted proxy would let anyone on the internet route traffic through
 * your Google project, on your quota and under your IP's reputation.
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

// Only these upstreams may be fetched. findchips = part pricing,
// iw.coinmill.com = the currency-conversion rates the Priority import uses.
const ALLOWED_HOSTS = new Set([
  'www.findchips.com',
  'findchips.com',
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

// findchips serves a bot-challenge page to anything that doesn't look like a
// real browser, and a request from a Google datacenter IP is already suspect —
// so send the FULL header set a current Chrome sends, not just a User-Agent.
// Missing client hints (sec-ch-ua / sec-fetch-*) are a common tell.
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

// Signatures of an anti-bot interstitial. Such a page is a perfectly valid HTTP
// 200 of decent length, so without this check it sails through and the app just
// reports a baffling "Not found" — the part is fine, we were simply blocked.
const BLOCK_SIGNATURES = [
  /just a moment/i,
  /checking your browser/i,
  /cf-browser-verification|cf_chl_|challenge-platform/i,
  /captcha/i,
  /access denied|permission denied|forbidden/i,
  /unusual traffic|automated (requests|queries)|are you a robot/i,
  /enable javascript (and cookies )?to continue/i,
];

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

      // A FindChips results page is ~650 KB, and the great majority of that is
      // inline <script>/<style> the app never looks at — it only reads the
      // distributor tables. Dropping them before relaying typically cuts the
      // payload by more than half, which is the difference between a snappy
      // price check and one that trips the browser's timeout.
      const before = body.length;
      body = body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      res.set('X-Original-Size', String(before));
      res.set('X-Stripped-Size', String(body.length));

      // Distinguish "blocked" from "genuinely no results". Both arrive as a
      // 200, but only one is a problem we can act on — and calling it out by
      // name saves hours of chasing a parser bug that doesn't exist.
      const looksBlocked = BLOCK_SIGNATURES.some(re => re.test(body));
      const hasResults = /distributor-results/i.test(body);
      if (looksBlocked || !hasResults) {
        const which = BLOCK_SIGNATURES.find(re => re.test(body));
        return void res.status(502).json({
          error: looksBlocked
            ? `FindChips served an anti-bot page to our server (matched ${which}). ` +
              'The part number is fine — the request was blocked, not the parsing.'
            : 'FindChips returned a page with no distributor results — most likely a ' +
              'block or an empty search, not a parsing problem.',
          upstreamStatus: upstream.status,
          bytes: body.length,
          snippet: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
        });
      }

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
