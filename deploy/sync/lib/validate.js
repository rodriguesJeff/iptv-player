'use strict';
// Strict validation of library changes sent by clients. Throws ValidationError on wrong shape;
// unknown fields inside items are dropped, timestamps in the future are clamped to `now`.
const { LIMITS } = require('./merge');

class ValidationError extends Error {}

const ID = /^(?!__proto__$)[A-Za-z0-9_-]{1,32}$/;
const FAV_KEY = /^(vod|series):((?!__proto__$)[A-Za-z0-9_-]{1,32})$/;
const EXT = /^[A-Za-z0-9]{0,8}$/;
const SKEW_MS = 5 * 60 * 1000;

function fail(msg) { throw new ValidationError(msg); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function str(v, max, field) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) fail(field);
  return v;
}
function url(v, field) {
  const s = str(v, 500, field);
  if (s && !/^https?:\/\/[^\s]+$/i.test(s)) fail(field);
  return s;
}
function num(v, min, max, field) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(field);
  return v;
}
function clampAt(v, now) {
  const t = num(v, 1, Number.MAX_SAFE_INTEGER, 'at');
  return t > now + SKEW_MS ? now : t;
}

function fav(key, v, now) {
  const m = FAV_KEY.exec(key);
  if (!m || !isObj(v)) fail('favs');
  if (v.deleted === true) return { deleted: true, at: clampAt(v.at, now) };
  if (v.kind !== m[1] || v.id !== m[2]) fail('favs');
  const ext = str(v.ext, 8, 'ext');
  if (!EXT.test(ext)) fail('ext');
  return {
    kind: m[1], id: m[2], name: str(v.name, 200, 'name'), img: url(v.img, 'img'),
    ext, cat: str(v.cat, 32, 'cat'), at: clampAt(v.at, now)
  };
}

function episode(v, now) {
  if (!isObj(v)) fail('eps');
  const dur = Math.floor(num(v.dur, 0, 1e6, 'dur'));
  return {
    pos: Math.floor(num(v.pos, 0, 1e6, 'pos')), dur,
    done: v.done === true, at: clampAt(v.at, now)
  };
}

function series(v, now) {
  if (!isObj(v) || !isObj(v.eps)) fail('series');
  const keys = Object.keys(v.eps);
  if (keys.length > LIMITS.eps) fail('eps');
  const eps = {};
  keys.forEach((k) => { if (!ID.test(k)) fail('eps'); eps[k] = episode(v.eps[k], now); });
  const s = { name: str(v.name, 200, 'name'), cover: url(v.cover, 'cover'), at: clampAt(v.at, now), eps };
  if (v.last !== undefined) {
    const l = v.last;
    if (!isObj(l) || typeof l.epId !== 'string' || !ID.test(l.epId)) fail('last');
    const season = str(l.season, 8, 'season');
    if (!/^[0-9]{1,8}$/.test(season)) fail('season');
    const ext = str(l.ext, 8, 'ext');
    if (!EXT.test(ext)) fail('ext');
    s.last = {
      epId: l.epId, season, num: Math.floor(num(l.num, 0, 100000, 'num')), ext,
      title: str(l.title, 200, 'title'), at: clampAt(l.at, now)
    };
  }
  return s;
}

function changes(body, now = Date.now()) {
  if (!isObj(body)) fail('body');
  const favs = body.favs === undefined ? {} : body.favs;
  const ser = body.series === undefined ? {} : body.series;
  if (!isObj(favs) || !isObj(ser)) fail('body');
  const fk = Object.keys(favs), sk = Object.keys(ser);
  if (fk.length > LIMITS.favs || sk.length > LIMITS.series) fail('limits');
  const out = { favs: {}, series: {} };
  fk.forEach((k) => { out.favs[k] = fav(k, favs[k], now); });
  sk.forEach((k) => { if (!ID.test(k)) fail('series'); out.series[k] = series(ser[k], now); });
  return out;
}

function credentials(body) {
  if (!isObj(body)) fail('body');
  const { server, user, pass } = body;
  if (server !== undefined && server !== null && (typeof server !== 'string' || server.length > 255)) fail('server');
  if (typeof user !== 'string' || !user.length || user.length > 128 || /[\u0000-\u001f\u007f]/.test(user)) fail('user');
  if (typeof pass !== 'string' || !pass.length || pass.length > 256 || /[\u0000-\u001f\u007f]/.test(pass)) fail('pass');
  return { server: server || '', user, pass };
}

module.exports = { changes, credentials, ValidationError };
