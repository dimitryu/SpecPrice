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
const fakeAdmin = {
  initializeApp() {},
  auth: () => ({ verifyIdToken: async t => { if (tokens[t]) return tokens[t]; throw new Error('bad'); } }),
  firestore: Object.assign(() => ({
    doc: p => ({
      get: async () => ({ exists: p in store, data: () => store[p] }),
      set: async (d, o) => { store[p] = (o && o.merge) ? { ...(store[p] || {}), ...d } : d; },
    }),
  }), { FieldValue: { serverTimestamp: () => new Date('2026-10-29T10:00:00Z') } }),
};
const fakeFunctions = { onRequest: (opts, fn) => { fn._opts = opts; return fn; } };
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'firebase-functions/v2/https') return fakeFunctions;
  return origLoad.call(this, req, ...rest);
};

let upstreamCalls = [];
let upstreamReply = { status: 200, body: '{"content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn"}' };
global.fetch = async (url, init) => {
  upstreamCalls.push({ url, init });
  return {
    ok: upstreamReply.status < 300, status: upstreamReply.status,
    headers: { get: () => 'application/json' },
    text: async () => upstreamReply.body,
    json: async () => JSON.parse(upstreamReply.body),
  };
};

const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));

function call(fn, { method = 'POST', origin = 'https://dimitryu.github.io', token, body } = {}) {
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
    Promise.resolve(fn({ method, headers, body, query: {} }, res)).catch(e => resolve({ status: 'threw', error: e }));
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

  upstreamReply = { status: 529, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' };
  r = await call(P, { token: 'tUser', body: req });
  ok(r.status === 529 && r.json.error.message === 'Overloaded', 'Anthropic error status + message passed through');
  upstreamReply = { status: 200, body: '{"content":[]}' };

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

  console.log(`functions harness: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
