'use strict';
// File storage: one JSON document per namespace and a sessions file holding token hashes only.
// Writes are atomic (temp file + rename) and serialized per file.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { merge, empty } = require('./merge');

const MAX_SESSIONS_PER_NS = 20;
const MAX_SESSIONS = 20000;

function hmac(secret, value) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }

class Store {
  constructor(dir, secret) {
    this.dir = dir;
    this.secret = secret;
    this.libDir = path.join(dir, 'lib');
    this.sessionsFile = path.join(dir, 'sessions.json');
    this.queues = new Map();
    fs.mkdirSync(this.libDir, { recursive: true, mode: 0o700 });
    this.sessions = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
      Object.keys(raw).forEach((k) => this.sessions.set(k, raw[k]));
    } catch (e) { /* no sessions yet */ }
    this.pruneSessions();
  }

  namespace(target, user) { return hmac(this.secret, target + '\n' + user); }

  // Serialize async work per key.
  queue(key, fn) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    return next;
  }

  async writeAtomic(file, data) {
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fs.promises.writeFile(tmp, data, { mode: 0o600 });
    await fs.promises.rename(tmp, file);
  }

  libFile(ns) {
    if (!/^[0-9a-f]{64}$/.test(ns)) throw new Error('bad namespace');
    return path.join(this.libDir, ns + '.json');
  }

  async read(ns) {
    try { return merge(empty(), JSON.parse(await fs.promises.readFile(this.libFile(ns), 'utf8'))); }
    catch (e) { return empty(); }
  }

  // Merges `changes` into the stored document and returns the result.
  apply(ns, changes) {
    return this.queue(ns, async () => {
      const doc = merge(await this.read(ns), changes);
      await this.writeAtomic(this.libFile(ns), JSON.stringify(doc));
      return doc;
    });
  }

  // ---- sessions ----
  pruneSessions(now = Date.now()) {
    for (const [k, s] of this.sessions) if (s.exp <= now) this.sessions.delete(k);
  }

  saveSessions() {
    return this.queue('\0sessions', () => {
      const obj = {};
      for (const [k, s] of this.sessions) obj[k] = s;
      return this.writeAtomic(this.sessionsFile, JSON.stringify(obj));
    });
  }

  async createSession(ns, ttlMs) {
    const now = Date.now();
    this.pruneSessions(now);
    const mine = [...this.sessions].filter(([, s]) => s.ns === ns).sort((a, b) => a[1].exp - b[1].exp);
    while (mine.length >= MAX_SESSIONS_PER_NS) this.sessions.delete(mine.shift()[0]);
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions].sort((a, b) => a[1].exp - b[1].exp)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const exp = now + ttlMs;
    this.sessions.set(hmac(this.secret, token), { ns, exp });
    await this.saveSessions();
    return { token, expiresAt: exp };
  }

  // Namespace for a bearer token, or null. Lookup is by keyed hash, so no secret comparison happens here.
  session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const s = this.sessions.get(hmac(this.secret, token));
    if (!s || s.exp <= Date.now()) return null;
    return s.ns;
  }

  async revoke(token) {
    if (typeof token !== 'string') return;
    if (this.sessions.delete(hmac(this.secret, token))) await this.saveSessions();
  }
}

module.exports = { Store, hmac };
