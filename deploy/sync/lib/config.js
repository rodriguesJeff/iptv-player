'use strict';
// Reads configuration from the environment. Never prints values: errors name the variable only.
const { normalizeServer } = require('./net');

class ConfigError extends Error {}

function int(env, name, def, min, max) {
  if (env[name] === undefined || env[name] === '') return def;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function load(env = process.env) {
  const secret = env.SYNC_SECRET || '';
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new ConfigError('SYNC_SECRET is missing or shorter than 32 bytes');

  const allowPrivate = env.SYNC_ALLOW_PRIVATE === '1';
  if (allowPrivate && env.NODE_ENV === 'production') throw new ConfigError('SYNC_ALLOW_PRIVATE cannot be used with NODE_ENV=production');

  let upstream = null;
  if (env.IPTV_UPSTREAM) {
    upstream = normalizeServer(env.IPTV_UPSTREAM);
    if (!upstream) throw new ConfigError('IPTV_UPSTREAM is not a valid http(s) origin');
  }
  let publicOrigin = null;
  if (env.PUBLIC_ORIGIN) {
    publicOrigin = normalizeServer(env.PUBLIC_ORIGIN);
    if (!publicOrigin) throw new ConfigError('PUBLIC_ORIGIN is not a valid http(s) origin');
  }
  const allowedHosts = (env.SYNC_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

  return {
    secret: Buffer.from(secret, 'utf8'),
    upstream,
    publicOrigin,
    allowedHosts,
    allowPrivate,
    dataDir: env.SYNC_DATA_DIR || '/data',
    port: int(env, 'PORT', 8790, 1, 65535),
    sessionTtlMs: int(env, 'SESSION_TTL_HOURS', 24, 1, 24 * 90) * 3600 * 1000,
    // Proxies in front of this service that append to X-Forwarded-For (Traefik + Caddy = 2; none = 0).
    proxyHops: int(env, 'TRUSTED_PROXY_HOPS', 0, 0, 5)
  };
}

module.exports = { load, ConfigError };
