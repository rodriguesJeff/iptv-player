'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { normalizeServer, isBlockedAddress, resolvePublic, checkAccount } = require('../lib/net');

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}
const origin = (s) => 'http://127.0.0.1:' + s.address().port;

test('normalizeServer mirrors the app and rejects non-origins', () => {
  assert.strictEqual(normalizeServer(' provedor.example:8080/ '), 'http://provedor.example:8080');
  assert.strictEqual(normalizeServer('HTTPS://Provedor.Example'), 'https://provedor.example');
  for (const bad of ['', 'ftp://x', 'file:///etc/passwd', 'http://u:p@x', 'http://x/path', 'http://x?a=1',
    'http://x#f', 'javascript:alert(1)', 'gopher://x', null, 42, 'a'.repeat(300)]) {
    assert.strictEqual(normalizeServer(bad), null, String(bad));
  }
});

test('internal addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', '::ffff:10.0.0.1', '::ffff:a00:1', 'fe80::1',
    'fd00::1', 'ff02::1', '64:ff9b::a00:1', '2002:a00:1::', 'not-an-ip']) {
    assert.strictEqual(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.strictEqual(isBlockedAddress(ip), false, ip);
});

test('resolvePublic refuses literals and hostnames that resolve internally', async () => {
  await assert.rejects(resolvePublic('127.0.0.1', false));
  await assert.rejects(resolvePublic('[::1]', false));
  await assert.rejects(resolvePublic('[::ffff:a00:1]', false));
  await assert.rejects(resolvePublic('localhost', false));
  const ok = await resolvePublic('127.0.0.1', true);
  assert.strictEqual(ok.address, '127.0.0.1');
});

test('checkAccount: valid, invalid, blocked, redirect, oversized, slow, allow-list', async (t) => {
  let hits = 0;
  const s = await serve((req, res) => {
    hits++;
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/player_api.php') { res.writeHead(404); return res.end(); }
    const user = u.searchParams.get('username');
    if (user === 'redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end(); }
    if (user === 'big') { res.writeHead(200); return res.end('{"x":"' + 'a'.repeat(70 * 1024) + '"}'); }
    if (user === 'slow') return setTimeout(() => res.end('{}'), 1500);
    const ok = user === 'test' && u.searchParams.get('password') === 'pw';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user_info: { auth: ok ? 1 : 0, status: 'Active' } }));
  });
  t.after(() => s.close());
  const o = origin(s);
  const dev = { trusted: false, allowPrivate: true };

  assert.strictEqual(await checkAccount(o, 'test', 'pw', dev), true);
  assert.strictEqual(await checkAccount(o, 'test', 'nope', dev), false);

  hits = 0;
  await assert.rejects(checkAccount(o, 'test', 'pw', { trusted: false, allowPrivate: false }));
  assert.strictEqual(hits, 0, 'no connection to a blocked address');

  // Trusted upstream (IPTV_UPSTREAM) may be internal.
  assert.strictEqual(await checkAccount(o, 'test', 'pw', { trusted: true, allowPrivate: false }), true);

  await assert.rejects(checkAccount(o, 'redirect', 'pw', dev));
  await assert.rejects(checkAccount(o, 'big', 'pw', dev));
  await assert.rejects(checkAccount(o, 'slow', 'pw', { ...dev, timeoutMs: 300 }));
  await assert.rejects(checkAccount(o, 'test', 'pw', { ...dev, allowedHosts: ['provedor.example'] }));
  assert.strictEqual(await checkAccount(o, 'test', 'pw', { ...dev, allowedHosts: ['127.0.0.1'] }), true);
});
