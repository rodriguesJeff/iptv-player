'use strict';
// Sync service for favorites and series progress. No dependencies.
//   POST   /sync/session   {server, user, pass} -> {token, expiresAt}   (validates on the IPTV server)
//   DELETE /sync/session   Authorization: Bearer <token>
//   GET    /sync/library   Authorization: Bearer <token>              -> {doc}
//   POST   /sync/library   Authorization: Bearer <token> {changes}    -> {doc} (merged)
//   GET    /sync/health
// Logs carry method, path, status and duration only: never bodies, query strings, tokens or passwords.
const http = require('http');
const config = require('./lib/config');
const { normalizeServer, checkAccount } = require('./lib/net');
const validate = require('./lib/validate');
const { Store } = require('./lib/store');

const BODY_LIMIT = 256 * 1024;
const SESSION_BODY_LIMIT = 4 * 1024;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 10;
const TOKEN_RATE = { windowMs: 60 * 1000, max: 120 };
const MAX_UPSTREAM_CHECKS = 20;

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function createServer(cfg, store, deps = {}) {
  const check = deps.checkAccount || checkAccount;
  const failures = new Map();   // ip -> {n, reset}
  const tokenHits = new Map();  // ns -> {n, reset}
  let checking = 0;

  function bump(map, key, windowMs) {
    const now = Date.now();
    let e = map.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; map.set(key, e); }
    e.n++;
    return e.n;
  }
  function count(map, key) {
    const e = map.get(key);
    return e && e.reset > Date.now() ? e.n : 0;
  }
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const m of [failures, tokenHits]) for (const [k, e] of m) if (e.reset <= now) m.delete(k);
    store.pruneSessions(now);
  }, 60 * 1000);
  sweeper.unref();

  // Client address: with N trusted proxies appending to X-Forwarded-For, the client is N entries from the end.
  function clientIp(req) {
    if (cfg.proxyHops > 0) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length >= cfg.proxyHops) return xff[xff.length - cfg.proxyHops];
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return reject(new HttpError(415, 'unsupported media type'));
      const declared = Number(req.headers['content-length']);
      if (declared > limit) return reject(new HttpError(413, 'too large'));
      let size = 0;
      let over = false;
      const chunks = [];
      req.on('data', (c) => {
        if (over) return;
        size += c.length;
        if (size > limit) { over = true; chunks.length = 0; reject(new HttpError(413, 'too large')); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (over) return;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new HttpError(400, 'invalid json')); }
      });
      req.on('error', () => reject(new HttpError(400, 'bad request')));
    });
  }

  function bearer(req) {
    const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ''));
    return m ? m[1] : null;
  }

  function auth(req) {
    const ns = store.session(bearer(req));
    if (!ns) throw new HttpError(401, 'unauthorized');
    if (bump(tokenHits, ns, TOKEN_RATE.windowMs) > TOKEN_RATE.max) throw new HttpError(429, 'too many requests');
    return ns;
  }

  // The IPTV server to validate against: the one the user typed; IPTV_UPSTREAM only for empty input
  // or the web deploy's own origin.
  function resolveTarget(server) {
    if (!server || !server.trim()) {
      if (!cfg.upstream) throw new HttpError(400, 'server required');
      return { origin: cfg.upstream, trusted: true };
    }
    const origin = normalizeServer(server);
    if (!origin) throw new HttpError(400, 'invalid server');
    if ((cfg.publicOrigin && origin === cfg.publicOrigin) || (cfg.upstream && origin === cfg.upstream)) {
      if (!cfg.upstream) throw new HttpError(400, 'server required');
      return { origin: cfg.upstream, trusted: true };
    }
    return { origin, trusted: false };
  }

  async function createSession(req) {
    const ip = clientIp(req);
    if (count(failures, ip) >= FAIL_MAX) throw new HttpError(429, 'too many attempts');
    let creds;
    try { creds = validate.credentials(await readJson(req, SESSION_BODY_LIMIT)); }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'bad request'); }
    const target = resolveTarget(creds.server);
    if (checking >= MAX_UPSTREAM_CHECKS) throw new HttpError(503, 'busy');
    let ok = false;
    checking++;
    try {
      ok = await check(target.origin, creds.user, creds.pass, {
        trusted: target.trusted, allowPrivate: cfg.allowPrivate, allowedHosts: cfg.allowedHosts
      });
    } catch (e) {
      ok = false; // network, blocked address, timeout...: same answer as bad credentials
    } finally {
      checking--;
    }
    if (!ok) {
      bump(failures, ip, FAIL_WINDOW_MS);
      throw new HttpError(401, 'account not validated');
    }
    return store.createSession(store.namespace(target.origin, creds.user), cfg.sessionTtlMs);
  }

  async function route(req) {
    const path = new URL(req.url, 'http://x').pathname;
    const key = req.method + ' ' + path;
    switch (key) {
      case 'GET /sync/health': return { ok: true };
      case 'POST /sync/session': return createSession(req);
      case 'DELETE /sync/session': await store.revoke(bearer(req)); return { ok: true };
      case 'GET /sync/library': return { doc: await store.read(auth(req)) };
      case 'POST /sync/library': {
        const ns = auth(req);
        let changes;
        try { changes = validate.changes((await readJson(req, BODY_LIMIT)).changes); }
        catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'bad request'); }
        return { doc: await store.apply(ns, changes) };
      }
    }
    if (['/sync/health', '/sync/session', '/sync/library'].includes(path)) throw new HttpError(405, 'method not allowed');
    throw new HttpError(404, 'not found');
  }

  const MESSAGES = {
    400: 'Requisição inválida', 401: 'Não autorizado', 404: 'Não encontrado', 405: 'Método não permitido',
    413: 'Dados grandes demais', 415: 'Use application/json', 429: 'Muitas tentativas, tente mais tarde',
    500: 'Erro interno', 503: 'Servidor ocupado, tente de novo'
  };

  function send(res, status, body) {
    const data = JSON.stringify(body);
    // Do not keep reading an oversized upload: answer and drop the connection.
    if (status === 413) {
      res.setHeader('Connection', 'close');
      res.on('finish', () => res.socket && res.socket.destroy());
    }
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    });
    res.end(data);
  }

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const path = (req.url || '').split('?')[0].slice(0, 64);
    route(req).then((body) => send(res, 200, body), (e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('internal error:', e && e.name);
      send(res, status, { error: MESSAGES[status] || 'Erro' });
    }).finally(() => {
      if (!deps.quiet) console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - t0}ms`);
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}

if (require.main === module) {
  let cfg;
  try { cfg = config.load(); } catch (e) {
    console.error('config error: ' + (e instanceof config.ConfigError ? e.message : 'unexpected'));
    process.exit(1);
  }
  const store = new Store(cfg.dataDir, cfg.secret);
  createServer(cfg, store).listen(cfg.port, () => console.log(`sync listening on :${cfg.port}`));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { createServer };
