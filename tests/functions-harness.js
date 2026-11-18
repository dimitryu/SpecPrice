// Cloud Functions harness — runs functions/index.js with firebase-admin,
// firebase-functions and the network replaced by fakes, and checks the parts
// that guard money and secrets: aiProxy (who may call it, what it forwards,
// that Anthropic's answer comes back unchanged) and apiConfig's AI key
// handling (stored apart from the distributor keys, never returned).
//
//   node functions-harness.js
'use strict';
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }

// ── fakes ────────────────────────────────────────────────────────────────────
const store = {};                     // 'col/doc' → data
const tokens = {};                    // idToken → decoded
const handlers = {};
const authUsers = {};                 // uid → {email, disabled, revoked}
const authCalls = [];
let authSeq = 0;
const fakeAuth = {
  verifyIdToken: async t => { if (tokens[t]) return tokens[t]; throw new Error('bad'); },
  createUser: async u => { authCalls.push(['create', u.email]);
    if (Object.values(authUsers).some(x => x.email === u.email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
    const uid = 'new' + (++authSeq); authUsers[uid] = { ...u }; return { uid }; },
  updateUser: async (uid, p) => { authCalls.push(['update', uid, p]); if (!authUsers[uid]) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); Object.assign(authUsers[uid], p); },
  revokeRefreshTokens: async uid => { authCalls.push(['revoke', uid]); if (authUsers[uid]) authUsers[uid].revoked = true; },
  deleteUser: async uid => { authCalls.push(['delete', uid]); if (!authUsers[uid]) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); delete authUsers[uid]; },
};
let addSeq = 0;
const docRef = p => ({
  get: async () => ({ exists: p in store, data: () => store[p] }),
  set: async (d, o) => {
    const base = (o && o.merge) ? { ...(store[p] || {}) } : {};
    for (const [k, v] of Object.entries(d)) base[k] = (v && v.__inc !== undefined) ? (base[k] || 0) + v.__inc : v;
    store[p] = base;
  },
  update: async d => { if (!(p in store)) throw new Error('no doc'); store[p] = { ...store[p], ...d }; },
  delete: async () => { delete store[p]; },
});
const collRef = c => ({
  doc: id => docRef(`${c}/${id}`),
  add: async d => { const id = 'auto' + (++addSeq); store[`${c}/${id}`] = d; return { id }; },
  where: (f, op, v) => ({ get: async () => ({ docs: Object.keys(store)
    .filter(k => k.startsWith(c + '/') && k.split('/').length === c.split('/').length + 1 && store[k][f] === v)
    .map(k => ({ id: k.slice(c.length + 1), data: () => store[k] })) }) }),
});
const fakeAdmin = {
  initializeApp() {},
  auth: () => fakeAuth,
  firestore: Object.assign(() => ({ doc: docRef, collection: collRef }),
    { FieldValue: { serverTimestamp: () => new Date('2026-10-29T10:00:00Z'), increment: n => ({ __inc: n }) } }),
};
const fakeFunctions = { onRequest: (opts, fn) => { fn._opts = opts; return fn; } };
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'firebase-functions/v2/https') return fakeFunctions;
  return origLoad.call(this, req, ...rest);
};

let upstreamCalls = [];
let upstreamReplyAt = null;
let upstreamReplyDefault = { status: 200, body: '{"content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn"}' };
global.fetch = async (url, init) => {
  upstreamCalls.push({ url, init });
  const upstreamReply = typeof upstreamReplyAt === 'function' ? (upstreamReplyAt(url, upstreamCalls.length) || upstreamReplyDefault) : upstreamReplyDefault;
  return {
    ok: upstreamReply.status < 300, status: upstreamReply.status,
    headers: { get: () => 'application/json' },
    text: async () => upstreamReply.body,
    json: async () => JSON.parse(upstreamReply.body),
  };
};

const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));

function call(fn, { method = 'POST', origin = 'https://dimitryu.github.io', token, body, query = {} } = {}) {
  return new Promise(resolve => {
    const res = {
      _status: 200, _headers: {},
      status(c) { this._status = c; return this; },
      set(k, v) { this._headers[k] = v; return this; },
      json(o) { resolve({ status: this._status, json: o, headers: this._headers }); },
      send(t) { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: this._status, text: t, json: j, headers: this._headers }); },
    };
    const headers = { origin };
    if (token) headers.authorization = 'Bearer ' + token;
    Promise.resolve(fn({ method, headers, body, query }, res)).catch(e => resolve({ status: 'threw', error: e }));
  });
}

(async () => {
  tokens.tUser = { uid: 'u1', email: 'user@x.com' };
  tokens.tAdmin = { uid: 'a1', email: 'admin@x.com' };
  tokens.tOff = { uid: 'u2', email: 'off@x.com' };
  tokens.tGhost = { uid: 'u3', email: 'ghost@x.com' };
  store['users/u1'] = { role: 'sales', company_id: 'c1' };
  store['users/a1'] = { role: 'admin', company_id: 'c1' };
  store['users/u2'] = { role: 'sales', disabled: true };

  const P = fns.aiProxy, C = fns.apiConfig;
  const req = { model: 'claude-sonnet-5', max_tokens: 16000, temperature: 0, messages: [{ role: 'user', content: 'x' }] };

  ok(P._opts.timeoutSeconds >= 520, 'aiProxy timeout covers the 300s analysis');

  // ── access ──
  let r = await call(P, { method: 'OPTIONS' });
  ok(r.status === 204, 'preflight 204');
  r = await call(P, { origin: 'https://evil.example', token: 'tUser', body: req });
  ok(r.status === 403, 'foreign origin refused');
  r = await call(P, { body: req });
  ok(r.status === 401 && r.json.error.message.includes('Missing'), 'no token → 401 in Anthropic error shape');
  r = await call(P, { token: 'nope', body: req });
  ok(r.status === 401, 'bad token → 401');
  r = await call(P, { token: 'tOff', body: req });
  ok(r.status === 403 && /disabled/.test(r.json.error.message), 'disabled user refused');
  r = await call(P, { token: 'tGhost', body: req });
  ok(r.status === 403, 'user without profile refused');

  // ── not configured ──
  r = await call(P, { method: 'GET', token: 'tUser' });
  ok(r.status === 200 && r.json.configured === false, 'GET reports not configured');
  r = await call(P, { token: 'tUser', body: req });
  ok(r.status === 503 && /Admin → AI API Keys/.test(r.json.error.message), 'no key → 503 with instructions');
  ok(upstreamCalls.length === 0, 'nothing forwarded without a key');

  // ── admin stores the key ──
  r = await call(C, { token: 'tUser', body: { anthropic_api_key: 'fake-ai-key-1234' } });
  ok(r.status === 403, 'non-admin cannot store the AI key');
  r = await call(C, { token: 'tAdmin', body: { anthropic_api_key: 'fake-ai-key-1234' } });
  ok(r.status === 200 && r.json.updated.includes('anthropic_api_key'), 'admin stores the AI key');
  ok(store['secure_config/ai_api'].anthropic_api_key === 'fake-ai-key-1234', 'kept in secure_config/ai_api');
  ok(!('secure_config/distributor_api' in store), 'distributor document untouched');
  r = await call(C, { method: 'GET', token: 'tAdmin' });
  ok(r.json.anthropic.configured && r.json.anthropic.hint === '…1234' && r.json.anthropic.source === 'ui', 'status shows hint only');
  ok(!JSON.stringify(r.json).includes("fake-ai-key"), 'status never returns the key');

  // ── forwarding ──
  r = await call(P, { method: 'GET', token: 'tUser' });
  ok(r.json.configured === true, 'GET reports configured');
  r = await call(P, { token: 'tUser', body: { ...req, stream: true, tools: [{}] } });
  ok(r.status === 200 && r.json.content[0].text === 'hi', 'answer returned unchanged');
  const up = upstreamCalls.pop();
  ok(up.url === 'https://api.anthropic.com/v1/messages', 'forwards to the Messages API');
  ok(up.init.headers['x-api-key'] === 'fake-ai-key-1234', 'server adds the key');
  const sent = JSON.parse(up.init.body);
  ok(sent.model === req.model && sent.max_tokens === 16000 && sent.temperature === 0 && sent.messages[0].content === 'x', 'body forwarded');
  ok(!('stream' in sent) && !('tools' in sent), 'unexpected fields dropped');

  // web search is the one tool allowed through, capped; anything else is dropped
  r = await call(P, { token: 'tUser', body: { ...req, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 99, allowed_domains: ['x'] }, { type: 'computer_20250124', name: 'computer' }] } });
  const sentWs = JSON.parse(upstreamCalls.pop().init.body);
  ok(sentWs.tools.length === 1 && sentWs.tools[0].type === 'web_search_20250305' && sentWs.tools[0].max_uses === 12 && !('allowed_domains' in sentWs.tools[0]), 'web search forwarded, capped, nothing else');
  r = await call(P, { token: 'tUser', body: { ...req, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 50, max_content_tokens: 999999, allowed_domains: ['x'] }, { type: 'web_fetch_20250910', name: 'web_fetch' }] } });
  const sentWf = JSON.parse(upstreamCalls.pop().init.body);
  ok(sentWf.tools.length === 2 && sentWf.tools[1].type === 'web_fetch_20250910' && sentWf.tools[1].max_uses === 8 && sentWf.tools[1].max_content_tokens === 40000 && !('allowed_domains' in sentWf.tools[1]), 'web fetch forwarded once, capped');
  r = await call(P, { token: 'tUser', body: { ...req, tools: [{ type: 'bash_20250124', name: 'bash' }, { name: 'my_fn', input_schema: {} }] } });
  ok(!('tools' in JSON.parse(upstreamCalls.pop().init.body)), 'other tools are not forwarded');

  upstreamReplyDefault = { status: 529, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' };
  r = await call(P, { token: 'tUser', body: req });
  ok(r.status === 529 && r.json.error.message === 'Overloaded', 'Anthropic error status + message passed through');
  upstreamReplyDefault = { status: 200, body: '{"content":[]}' };

  // ── limits ──
  r = await call(P, { token: 'tUser', body: { ...req, model: 'gpt-4o' } });
  ok(r.status === 400, 'non-Claude model refused');
  r = await call(P, { token: 'tUser', body: { ...req, max_tokens: 200000 } });
  ok(r.status === 400, 'oversized max_tokens refused');
  r = await call(P, { token: 'tUser', body: { ...req, messages: [] } });
  ok(r.status === 400, 'empty messages refused');

  // ── distributor save still works and does not touch the AI key ──
  r = await call(C, { token: 'tAdmin', body: { mouser_api_key: 'M-KEY-9999' } });
  ok(r.status === 200 && store['secure_config/distributor_api'].mouser_api_key === 'M-KEY-9999', 'distributor save works');
  ok(store['secure_config/ai_api'].anthropic_api_key === 'fake-ai-key-1234', 'AI key untouched by distributor save');
  r = await call(C, { token: 'tAdmin', body: {} });
  ok(r.status === 400, 'empty save → Nothing to update');

  // ── test_ai ──
  r = await call(C, { token: 'tAdmin', body: { action: 'test_ai' } });
  ok(r.json.ok === true, 'test_ai ok');
  ok(JSON.parse(upstreamCalls.pop().init.body).max_tokens === 5, 'test_ai is a tiny request');

  // ── Online Components: key saved like Mouser's, never returned; lookup by part number ──
  r = await call(C, { token: 'tAdmin', body: { onlinecomp_api_key: 'oc-secret-key-7777', onlinecomp_api_name: 'cgpriceavailability' } });
  ok(r.status === 200 && store['secure_config/distributor_api'].onlinecomp_api_key === 'oc-secret-key-7777', 'Online Components key saved');
  await new Promise(res => setTimeout(res, 0));
  upstreamReplyDefault = { status: 200, body: JSON.stringify([
    { partNumber: 'D38999/26WC35SN', manufacturer: 'TE Connectivity / Deutsch', description: 'Circular plug', quantityAvailable: '36', unitOfMeasure: 'EA',
      productUrl: 'https://www.onlinecomponents.com/en/productdetail/te/d38999-1.html?utm_source=Radion', currency: 'USD',
      price_breaks: [{ pricebreak: '1', pricelist: '185.27' }, { pricebreak: '5', pricelist: '182.24' }] },
    { partNumber: 'D38999/26WC35SN', manufacturer: 'Aero-Electric', description: 'Circular plug', quantityAvailable: '0', unitOfMeasure: 'EA',
      productUrl: 'https://www.onlinecomponents.com/en/productdetail/ae/d38999-2.html', price_breaks: [{ pricebreak: '1', pricelist: '42.55' }] },
    { partNumber: 'D38999/26WC35SA', manufacturer: 'X', price_breaks: [{ pricebreak: '1', pricelist: '1.00' }] }]) };
  upstreamCalls = [];
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { pn: 'D38999/26WC-35SN', qty: '1', desc: 'plug' } });
  const ocCall = upstreamCalls.find(c => /onlinecomponents/.test(c.url));
  ok(ocCall && /\/wapi\/v1\/cgpriceavailability\/D38999%2F26WC-35SN\/false\/false\/50\/oc-secret-key-7777$/.test(ocCall.url), 'Online Components: documented path, part number encoded');
  ok(r.json.onlinecomp && r.json.onlinecomp.price === 42.55 && r.json.onlinecomp.manufacturer === 'Aero-Electric', 'Online Components: the cheapest of the matching parts, a different part number left out');
  ok(r.json.onlinecomp && r.json.onlinecomp.url === 'https://www.onlinecomponents.com/en/productdetail/ae/d38999-2.html' && r.json.onlinecomp.uom === 'EA', 'Online Components: product page without referral tags, unit kept');
  r = await call(C, { method: 'GET', token: 'tAdmin' });
  ok(r.json.onlinecomp && r.json.onlinecomp.configured && r.json.onlinecomp.hint === '…7777' && !JSON.stringify(r.json).includes('oc-secret-key-7777'), 'Online Components: status shows a hint, never the key');

  // ── Farnell (element14 Product Search API): key + store saved, lookup by manufacturer P/N ──
  r = await call(C, { token: 'tAdmin', body: { farnell_api_key: 'fa-secret-key-4321', farnell_store: 'il.farnell.com' } });
  ok(r.status === 200 && store['secure_config/distributor_api'].farnell_api_key === 'fa-secret-key-4321', 'Farnell key saved');
  await new Promise(res => setTimeout(res, 0));
  const FA_BODY = JSON.stringify({ manufacturerPartNumberSearchReturn: { numberOfResults: 3, products: [
    { sku: '1012345', displayName: 'MOLEX - 39-00-0047 - CONTACT, SOCKET, CRIMP', productURL: 'https://il.farnell.com/molex/39-00-0047/contact/dp/1012345?ost=x',
      packSize: 100, unitOfMeasure: 'EACH', unitOfMeasureCode: 'EA', packageName: 'Pack of 100', brandName: 'MOLEX',
      translatedManufacturerPartNumber: '39-00-0047', prices: [{ from: 1, to: 9, cost: 25.0 }, { from: 10, to: 99999, cost: 20.0 }],
      stock: { level: 4200 }, datasheets: [{ url: 'http://www.farnell.com/datasheets/1.pdf' }] },
    { sku: '1012346', displayName: 'MOLEX - 39-00-0047 - CONTACT, SOCKET, CRIMP, REEL', packSize: 1, unitOfMeasure: 'EACH', brandName: 'MOLEX',
      translatedManufacturerPartNumber: '39-00-0047', prices: { from: 1, to: 999999, cost: 0.31 }, inv: 0 },
    { sku: '9', displayName: 'other', translatedManufacturerPartNumber: '39-00-0048', prices: { from: 1, cost: 0.01 } }] } });
  let faCalls = 0;
  upstreamReplyAt = url => {
    if (!/api\.element14\.com/.test(url)) return null;
    faCalls++;
    return faCalls === 1 ? { status: 403, body: '{"error":{"code":403,"message":"Developer Over Qps"}}' } : { status: 200, body: FA_BODY };
  };
  upstreamCalls = [];
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { pn: '39-00-0047', qty: '100', desc: 'contact socket crimp' } });
  const faCall = upstreamCalls.filter(c => /element14/.test(c.url)).pop();
  const faQ = faCall ? new URL(faCall.url).searchParams : new URLSearchParams();
  ok(faCall && faQ.get('term') === 'manuPartNum:39-00-0047' && faQ.get('storeInfo.id') === 'il.farnell.com' && faQ.get('callInfo.responseDataFormat') === 'JSON' && faQ.get('callInfo.apiKey') === 'fa-secret-key-4321', 'Farnell: documented query (manuPartNum, store, JSON, key)');
  ok(faCalls === 2, 'Farnell: "over QPS" is retried, not reported');
  ok(r.json.farnell && Math.abs(r.json.farnell.price - 0.25) < 1e-9 && r.json.farnell.breakQty === 100, 'Farnell: a pack of 100 is priced per piece, the break counted in pieces');
  ok(r.json.farnell && r.json.farnell.url === 'https://il.farnell.com/molex/39-00-0047/contact/dp/1012345' && r.json.farnell.stock === '4200' && r.json.farnell.uom === 'EA', 'Farnell: product page, stock and unit');
  ok(r.json.farnell && r.json.farnell.candidates.length === 2, 'Farnell: a different part number is left out');
  faCalls = 1;
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { pn: '39-00-0047', qty: '5', desc: 'contact socket crimp' } });
  ok(r.json.farnell && r.json.farnell.price === 0.31, 'Farnell: 5 pieces — the single pieces win over a whole pack of 100');
  upstreamReplyAt = url => /element14/.test(url) ? { status: 403, body: '{"error":{"code":403,"message":"Developer Inactive"}}' } : null;
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { pn: '39-00-0047', qty: '1' } });
  ok(!r.json.farnell && r.json.errors.some(e => /Farnell auth failed/.test(e)) && !r.json.errors.join(' ').includes('fa-secret-key-4321'), 'Farnell: a bad key is reported without the key');
  upstreamReplyAt = url => /element14/.test(url) ? { status: 200, body: JSON.stringify({ manufacturerPartNumberSearchReturn: { numberOfResults: 1, products: [
    { sku: '7', displayName: 'CABLE 14AWG', unitOfMeasure: 'METER', unitOfMeasureCode: 'M', packSize: 1, translatedManufacturerPartNumber: 'WL-14-3C', brandName: 'W', prices: [{ from: 1, cost: 2.5 }] }] } }) } : null;
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { pn: 'WL-14-3C', qty: '1' } });
  ok(r.json.farnell && r.json.farnell.uom === 'M' && r.json.farnell.price === 2.5, 'Farnell: cable sold by the metre keeps its per-metre price');
  // ── Adhesive bottles: every size of the product, priced for the ml needed ──
  upstreamReplyAt = url => {
    if (/mouser\.com/.test(url)) return { status: 200, body: JSON.stringify({ Errors: [], SearchResults: { Parts: [
      { ManufacturerPartNumber: '243-10ML', Manufacturer: 'Loctite', Description: 'Threadlocker 243 medium strength 10ML bottle', PriceBreaks: [{ Quantity: 1, Price: '$12.00' }, { Quantity: 10, Price: '$10.00' }], Availability: '50 In Stock', ProductDetailUrl: 'https://www.mouser.com/p/1' },
      { ManufacturerPartNumber: '243-50ML', Manufacturer: 'Loctite', Description: 'Threadlocker 243 medium strength 50ML bottle', PriceBreaks: [{ Quantity: 1, Price: '$30.00' }], Availability: '12 In Stock', ProductDetailUrl: 'https://www.mouser.com/p/2' },
      { ManufacturerPartNumber: '243-250ML', Manufacturer: 'Loctite', Description: 'Threadlocker 243 250ML', PriceBreaks: [{ Quantity: 1, Price: '$95.00' }], Availability: '3 In Stock' },
      { ManufacturerPartNumber: '2430-50ML', Manufacturer: 'Loctite', Description: 'Threadlocker 2430 50ML', PriceBreaks: [{ Quantity: 1, Price: '$1.00' }] },
      { ManufacturerPartNumber: '243-KIT', Manufacturer: 'Loctite', Description: 'Threadlocker 243 dispenser', PriceBreaks: [{ Quantity: 1, Price: '$5.00' }] }] } }) };
    return { status: 200, body: '[]' };
  };
  r = await call(fns.priceLookup, { method: 'GET', token: 'tUser', query: { family: 'LOCTITE 243', need: '75' } });
  const mo = (r.json.offers || {}).mouser || [];
  ok(r.status === 200 && mo.length === 3, 'bottles: only listings that name the product and state a size (2430 and the kit left out)');
  ok(mo[0] && mo[0].mpn === '243-50ML' && mo[0].bottles === 2 && mo[0].total === 60, 'bottles: 75 ml → 2 × 50 ml is the cheapest fit');
  ok(mo[1] && mo[1].mpn === '243-10ML' && mo[1].bottles === 8 && mo[1].price === 10 && mo[1].total === 80, 'bottles: 8 × 10 ml priced at the 10+ break');
  ok(mo[2] && mo[2].mpn === '243-250ML' && mo[2].waste === 175, 'bottles: what is left over is reported');
  upstreamReplyAt = null;
  r = await call(C, { method: 'GET', token: 'tAdmin' });
  ok(r.json.farnell && r.json.farnell.configured && r.json.farnell.hint === '…4321' && r.json.farnell.store === 'il.farnell.com' && !JSON.stringify(r.json).includes('fa-secret-key-4321'), 'Farnell: status shows a hint and the store, never the key');

  // ── userAdmin: only an admin manages users; the sign-in account follows the profile ──
  {
    const U = fns.userAdmin;
    store['companies/c1'] = { name: 'Demo' };
    store['users/a2'] = { role: 'admin', company_id: 'c1' };
    tokens.tAdmin2 = { uid: 'a2', email: 'admin2@x.com' };
    authUsers.u1 = { email: 'user@x.com' }; authUsers.a1 = { email: 'admin@x.com' }; authUsers.a2 = { email: 'admin2@x.com' };
    r = await call(U, { token: 'tUser', body: { action: 'update', uid: 'u1', role: 'admin' } });
    ok(r.status === 403 && store['users/u1'].role === 'sales', 'userAdmin: a non-admin cannot promote anyone, themselves included');
    r = await call(U, { token: 'tOff', body: { action: 'create', email: 'x@y.com', password: 'longpass1', displayName: 'X', role: 'admin', company_id: 'c1' } });
    ok(r.status === 403, 'userAdmin: a disabled user is refused');
    r = await call(U, { token: 'tGhost', body: { action: 'create', email: 'x@y.com', password: 'longpass1', displayName: 'X', role: 'admin', company_id: 'c1' } });
    ok(r.status === 403, 'userAdmin: an account with no profile is refused');
    r = await call(U, { method: 'GET', token: 'tAdmin' });
    ok(r.status === 405, 'userAdmin: POST only');

    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'New@Demo.com', password: 'short', displayName: 'New', role: 'sales', company_id: 'c1' } });
    ok(r.status === 400 && /at least 8/.test(r.json.error), 'create: password of 8+ characters');
    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'new@demo.com', password: 'longpass1', displayName: 'New', role: 'owner', company_id: 'c1' } });
    ok(r.status === 400 && /Unknown role/.test(r.json.error), 'create: unknown role refused');
    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'new@demo.com', password: 'longpass1', displayName: 'New', role: 'sales', company_id: 'nope' } });
    ok(r.status === 400 && /Unknown company/.test(r.json.error), 'create: unknown company refused');
    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'New@Demo.com', password: 'longpass1', displayName: 'New', role: 'sales', company_id: 'c1' } });
    const nu = r.json && r.json.uid;
    ok(r.status === 200 && nu && authUsers[nu] && authUsers[nu].email === 'new@demo.com' && store[`users/${nu}`].role === 'sales' && store[`users/${nu}`].company_id === 'c1', 'create: sign-in account + profile together');
    const log = Object.entries(store).find(([k, v]) => k.startsWith('companies/c1/audit_logs/') && v.action === 'user_created');
    ok(log && log[1].user === 'admin@x.com' && log[1].source === 'server' && !JSON.stringify(log[1]).includes('longpass1'), 'create: logged by the server under the real admin, no password');
    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'new@demo.com', password: 'longpass1', displayName: 'New', role: 'sales', company_id: 'c1' } });
    ok(r.status === 409, 'create: an email already in use');

    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: nu, disabled: true } });
    ok(r.status === 200 && store[`users/${nu}`].disabled === true && authUsers[nu].disabled === true && authUsers[nu].revoked === true, 'disable: profile, sign-in account and open sessions');
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: nu, disabled: false, role: 'viewer' } });
    ok(r.status === 200 && authUsers[nu].disabled === false && store[`users/${nu}`].role === 'viewer', 'enable + change role');
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'a1', role: 'sales' } });
    ok(r.status === 400 && store['users/a1'].role === 'admin', 'an admin cannot demote themselves');
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'a1', disabled: true } });
    ok(r.status === 400 && store['users/a1'].disabled !== true, 'an admin cannot disable themselves');
    r = await call(U, { token: 'tAdmin', body: { action: 'delete', uid: 'a1' } });
    ok(r.status === 400 && 'users/a1' in store, 'an admin cannot delete themselves');
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'a2', role: 'sales' } });
    ok(r.status === 200 && store['users/a2'].role === 'sales', 'another admin can be demoted while one admin remains');
    store['users/a2'].role = 'admin';
    store['users/a1'].disabled = true;             // a1 is now the only other admin, and disabled
    r = await call(U, { token: 'tAdmin2', body: { action: 'delete', uid: 'a1' } });
    ok(r.status === 200, 'a disabled admin can be deleted');
    store['users/a1'] = { role: 'admin', company_id: 'c1' }; authUsers.a1 = { email: 'admin@x.com' };
    store['users/a2'].disabled = true;
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'a1', role: 'sales' } });
    ok(r.status === 400, 'the last active admin cannot be removed');
    delete store['users/a2'].disabled;

    r = await call(U, { token: 'tAdmin', body: { action: 'delete', uid: nu } });
    ok(r.status === 200 && !authUsers[nu] && !(`users/${nu}` in store), 'delete: the sign-in account and the profile');
    r = await call(U, { token: 'tAdmin', body: { action: 'drop_tables', uid: 'u1' } });
    ok(r.status === 400, 'unknown action refused');
    // H5 — an admin manages only their own company's users
    store['companies/c2'] = { name: 'Other' };
    store['users/x2'] = { role: 'sales', company_id: 'c2' }; authUsers.x2 = { email: 'x2@o.com' };
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'x2', role: 'viewer' } });
    ok(r.status === 403 && store['users/x2'].role === 'sales', 'an admin cannot change a user of another company');
    r = await call(U, { token: 'tAdmin', body: { action: 'delete', uid: 'x2' } });
    ok(r.status === 403 && 'users/x2' in store && authUsers.x2, 'an admin cannot delete a user of another company');
    r = await call(U, { token: 'tAdmin', body: { action: 'create', email: 'c2@demo.com', password: 'longpass1', displayName: 'C2', role: 'sales', company_id: 'c2' } });
    ok(r.status === 403, 'an admin cannot create users in another company');
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'u1', company_id: 'c2' } });
    ok(r.status === 403 && store['users/u1'].company_id === 'c1', 'an admin cannot move a user to another company');
    store['users/legacy'] = { role: 'sales' }; authUsers.legacy = { email: 'l@x.com' };
    r = await call(U, { token: 'tAdmin', body: { action: 'update', uid: 'legacy', company_id: 'c1', role: 'sales' } });
    ok(r.status === 200 && store['users/legacy'].company_id === 'c1', 'a profile with no company is adopted into the admin\'s company');
  }
  // ── M1: per-user limits ──
  {
    tokens.tBurst = { uid: 'ub', email: 'burst@x.com' };
    store['users/ub'] = { role: 'sales', company_id: 'c1' };
    upstreamReplyDefault = { status: 200, body: '<html>' + 'x'.repeat(300) + '</html>' };
    let last;
    for (let i = 0; i < 61; i++) last = await call(fns.priceProxy, { method: 'GET', token: 'tBurst', query: { url: 'https://iw.coinmill.com/ILS_USD.html' } });
    ok(last.status === 429 && /a minute/.test(last.json.error), 'rate: the 61st currency lookup in a minute is refused');
    const today = new Date().toISOString().slice(0, 10);
    ok(store[`usage/ub_proxy_${today}`] && store[`usage/ub_proxy_${today}`].count === 60, 'rate: the day\'s count is kept on the server (the refused one not counted)');
    store[`usage/u1_ai_${today}`] = { count: 2000 };
    const rAi = await call(fns.aiProxy, { token: 'tUser', body: { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] } });
    ok(rAi.status === 429 && /Daily limit/.test(rAi.json.error.message), 'rate: over the daily AI limit → 429 in Anthropic\'s error shape');
    delete store[`usage/u1_ai_${today}`];
  }

  // ── a profile is required for the price and proxy functions, not only a sign-in ──
  r = await call(fns.priceLookup, { method: 'GET', token: 'tGhost', query: { pn: 'X' } });
  ok(r.status === 403, 'priceLookup: an account with no profile is refused');
  r = await call(fns.priceLookup, { method: 'GET', token: 'tOff', query: { pn: 'X' } });
  ok(r.status === 403, 'priceLookup: a disabled user is refused');
  r = await call(fns.priceProxy, { method: 'GET', token: 'tOff', query: { url: 'https://iw.coinmill.com/ILS_USD.html' } });
  ok(r.status === 403, 'priceProxy: a disabled user is refused');

  console.log(`functions harness: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
