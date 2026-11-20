'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server');
const { Store } = require('../lib/store');
const config = require('../lib/config');

const SECRET = 'x'.repeat(40);

async function setup(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  const cfg = config.load({ SYNC_SECRET: SECRET, IPTV_UPSTREAM: 'http://upstream.internal:80', PUBLIC_ORIGIN: 'https://tv.example',
    SYNC_DATA_DIR: dir, TRUSTED_PROXY_HOPS: '2', ...extra });
  const calls = [];
  const logs = [];
  const store = new Store(cfg.dataDir, cfg.secret);
  const server = createServer(cfg, store, {
    checkAccount: async (origin, user, pass, opts) => { calls.push({ origin, user, opts }); return pass === 'right'; },
    quiet: true
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = async (method, p, { body, token, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (body !== undefined || raw !== undefined) h['Content-Type'] = h['Content-Type'] || 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    const res = await fetch(base + p, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty */ }
    return { status: res.status, json, headers: res.headers };
  };
  return { req, calls, dir, logs };
}

test('target resolution: typed server wins over IPTV_UPSTREAM', async (t) => {
  const { req, calls } = await setup(t);
  await req('POST', '/sync/session', { body: { server: 'provedor-b.example:8080', user: 'u', pass: 'right' } });
  await req('POST', '/sync/session', { body: { server: '', user: 'u', pass: 'right' } });
  await req('POST', '/sync/session', { body: { server: 'https://tv.example/', user: 'u', pass: 'right' } });
  await req('POST', '/sync/session', { body: { server: 'http://upstream.internal', user: 'u', pass: 'right' } });
  assert.deepStrictEqual(calls.map((c) => [c.origin, c.opts.trusted]), [
    ['http://provedor-b.example:8080', false],
    ['http://upstream.internal', true],
    ['http://upstream.internal', true],
    ['http://upstream.internal', true]
  ]);
  const bad = await req('POST', '/sync/session', { body: { server: 'file:///etc/passwd', user: 'u', pass: 'right' } });
  assert.strictEqual(bad.status, 400);
});

test('session + library roundtrip, isolation by server, tombstones', async (t) => {
  const { req, dir } = await setup(t);
  const a = (await req('POST', '/sync/session', { body: { server: 'http://a.example', user: 'u', pass: 'right' } })).json;
  const a2 = (await req('POST', '/sync/session', { body: { server: 'a.example/', user: 'u', pass: 'right' } })).json;
  const b = (await req('POST', '/sync/session', { body: { server: 'http://b.example', user: 'u', pass: 'right' } })).json;
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(a.expiresAt > Date.now());

  const now = Date.now();
  const put = await req('POST', '/sync/library', { token: a.token, body: { changes: {
    favs: { 'vod:1': { kind: 'vod', id: '1', name: 'Filme', img: '', ext: 'mp4', cat: '', at: now } } } } });
  assert.strictEqual(put.status, 200);
  assert.ok(put.json.doc.favs['vod:1']);

  const fromOtherDevice = await req('GET', '/sync/library', { token: a2.token });
  assert.ok(fromOtherDevice.json.doc.favs['vod:1'], 'same server+user shares data');
  const otherServer = await req('GET', '/sync/library', { token: b.token });
  assert.deepStrictEqual(otherServer.json.doc.favs, {}, 'other server isolated');

  await req('POST', '/sync/library', { token: a2.token, body: { changes: { favs: { 'vod:1': { deleted: true, at: now + 1 } } } } });
  const stale = await req('POST', '/sync/library', { token: a.token, body: { changes: {
    favs: { 'vod:1': { kind: 'vod', id: '1', name: 'Filme', img: '', ext: 'mp4', cat: '', at: now } } } } });
  assert.strictEqual(stale.json.doc.favs['vod:1'].deleted, true);

  // Nothing secret on disk.
  const files = fs.readdirSync(path.join(dir, 'lib'));
  files.forEach((f) => assert.match(f, /^[0-9a-f]{64}\.json$/));
  const disk = fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8') + files.map((f) => fs.readFileSync(path.join(dir, 'lib', f), 'utf8')).join('');
  for (const s of [a.token, b.token, 'right', 'a.example', '"u"']) assert.ok(!disk.includes(s), 'disk leaks ' + s);

  await req('DELETE', '/sync/session', { token: a.token });
  assert.strictEqual((await req('GET', '/sync/library', { token: a.token })).status, 401);
});

test('auth failures, rate limit by forwarded client IP', async (t) => {
  const { req } = await setup(t);
  assert.strictEqual((await req('GET', '/sync/library')).status, 401);
  assert.strictEqual((await req('GET', '/sync/library', { token: 'A'.repeat(43) })).status, 401);
  const xff = (ip) => ({ 'X-Forwarded-For': `${ip}, 10.0.0.2` });
  for (let i = 0; i < 10; i++) {
    const r = await req('POST', '/sync/session', { headers: xff('1.2.3.4'), body: { server: 'x.example', user: 'u', pass: 'wrong' } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.json.error, 'Não autorizado');
  }
  const blocked = await req('POST', '/sync/session', { headers: xff('1.2.3.4'), body: { server: 'x.example', user: 'u', pass: 'right' } });
  assert.strictEqual(blocked.status, 429);
  // Spoofed left-most entry does not dodge the limit; another real client is unaffected.
  const spoof = await req('POST', '/sync/session', { headers: { 'X-Forwarded-For': '9.9.9.9, 1.2.3.4, 10.0.0.2' },
    body: { server: 'x.example', user: 'u', pass: 'right' } });
  assert.strictEqual(spoof.status, 429);
  const other = await req('POST', '/sync/session', { headers: xff('5.6.7.8'), body: { server: 'x.example', user: 'u', pass: 'right' } });
  assert.strictEqual(other.status, 200);
});

test('body limits, content type, bad shapes, headers, unknown routes', async (t) => {
  const { req } = await setup(t);
  const { token } = (await req('POST', '/sync/session', { body: { server: 'a.example', user: 'u', pass: 'right' } })).json;
  const big = await req('POST', '/sync/library', { token, raw: JSON.stringify({ changes: { favs: {}, pad: 'x'.repeat(300 * 1024) } }) });
  assert.strictEqual(big.status, 413);
  assert.strictEqual((await req('POST', '/sync/library', { token, raw: '{nope' })).status, 400);
  assert.strictEqual((await req('POST', '/sync/library', { token, body: { changes: { favs: { 'live:1': {} } } } })).status, 400);
  assert.strictEqual((await req('POST', '/sync/library', { token, raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const after = await req('GET', '/sync/library', { token });
  assert.deepStrictEqual(after.json.doc, { favs: {}, series: {} }, 'rejected requests change nothing');
  assert.strictEqual(after.headers.get('cache-control'), 'no-store');
  assert.strictEqual(after.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(after.headers.get('access-control-allow-origin'), null, 'no CORS');
  assert.strictEqual((await req('GET', '/sync/nope')).status, 404);
  assert.strictEqual((await req('PUT', '/sync/library', { token })).status, 405);
});

test('config refuses weak or unsafe settings without printing values', () => {
  assert.throws(() => config.load({}), /SYNC_SECRET/);
  assert.throws(() => config.load({ SYNC_SECRET: 'short' }), /SYNC_SECRET/);
  assert.throws(() => config.load({ SYNC_SECRET: SECRET, SYNC_ALLOW_PRIVATE: '1', NODE_ENV: 'production' }), /SYNC_ALLOW_PRIVATE/);
  try { config.load({ SYNC_SECRET: SECRET, IPTV_UPSTREAM: 'ftp://secret-host' }); assert.fail(); }
  catch (e) { assert.ok(!e.message.includes('secret-host')); }
});
