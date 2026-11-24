'use strict';
// Talks to IPTV servers chosen by users without becoming an SSRF vector:
// only http(s) origins, only GET /player_api.php, public addresses only (pinned after DNS),
// no redirects, hard timeout and response size limit.
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8]
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

// IPv4-mapped / IPv4-compatible IPv6 literals: kept apart because BlockList also matches plain IPv4
// against these prefixes. A real IPTV server never needs them, so they are always refused.
const embedded = new net.BlockList();
embedded.addSubnet('::ffff:0:0', 96, 'ipv6');
embedded.addSubnet('::', 96, 'ipv6');

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 6 && embedded.check(address, 'ipv6')) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Same normalization as the app's Api.configure, then reduced to an origin. null = not acceptable.
function normalizeServer(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\/+$/, '');
  if (!s || s.length > 255) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return null;
  if (!u.hostname) return null;
  return u.origin;
}

class AccountError extends Error {}

// Resolves `host` and returns one address, refusing internal ones unless allowed.
async function resolvePublic(host, allowPrivate) {
  const literal = host.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(literal)
    ? [{ address: literal, family: net.isIP(literal) }]
    : await dns.promises.lookup(literal, { all: true, verbatim: true });
  if (!addrs.length) throw new AccountError('no address');
  if (!allowPrivate && addrs.some((a) => isBlockedAddress(a.address))) throw new AccountError('blocked address');
  return addrs[0];
}

// GET <origin>/player_api.php?username&password connected to `pinned` (or normal DNS when null).
function getJson(origin, query, pinned, timeoutMs = TIMEOUT_MS) {
  const u = new URL('/player_api.php', origin);
  u.search = new URLSearchParams(query).toString();
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(val); };
    const opts = {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'iptv-sync' },
      agent: false
    };
    if (pinned) {
      // Connect to the address that was checked, keeping the hostname for Host/SNI (no DNS rebinding).
      opts.lookup = (hostname, options, cb) => {
        if (options && options.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
        else cb(null, pinned.address, pinned.family);
      };
    }
    const req = mod.request(u, opts, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(new AccountError('status')); }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); return finish(new AccountError('too large')); }
        chunks.push(c);
      });
      res.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { finish(new AccountError('invalid json')); }
      });
      res.on('error', () => finish(new AccountError('response')));
    });
    const timer = setTimeout(() => { req.destroy(); finish(new AccountError('timeout')); }, timeoutMs);
    req.on('error', () => finish(new AccountError('request')));
    req.end();
  });
}

// true when the IPTV server accepts the credentials. `trusted` skips the address filter (IPTV_UPSTREAM).
async function checkAccount(origin, user, pass, { trusted, allowPrivate, allowedHosts, timeoutMs }) {
  const u = new URL(origin);
  let pinned = null;
  if (!trusted) {
    if (allowedHosts && allowedHosts.length && !allowedHosts.includes(u.hostname.toLowerCase())) {
      throw new AccountError('host not allowed');
    }
    pinned = await resolvePublic(u.hostname, allowPrivate);
  }
  const data = await getJson(origin, { username: user, password: pass }, pinned, timeoutMs);
  const info = data && data.user_info;
  if (!info || Number(info.auth) !== 1) return false;
  if (info.status && info.status !== 'Active') return false;
  return true;
}

module.exports = { normalizeServer, isBlockedAddress, resolvePublic, checkAccount, AccountError, TIMEOUT_MS, MAX_BYTES };
