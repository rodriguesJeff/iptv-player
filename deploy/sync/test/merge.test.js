'use strict';
// Same cases cover the app (www/js/merge.js is the code both sides run).
const test = require('node:test');
const assert = require('node:assert');
const { merge, empty, LIMITS } = require('../lib/merge');
const validate = require('../lib/validate');

const fav = (id, at) => ({ kind: 'vod', id, name: 'F' + id, img: '', ext: 'mp4', cat: '1', at });

const T = Date.now();

test('newest change wins per favorite; tombstone survives a stale device', () => {
  const web = { favs: { 'vod:1': { deleted: true, at: T } }, series: {} };
  const staleAndroid = { favs: { 'vod:1': fav('1', T - 1000) }, series: {} };
  assert.deepStrictEqual(merge(web, staleAndroid).favs['vod:1'], { deleted: true, at: T });
  assert.deepStrictEqual(merge(staleAndroid, web).favs['vod:1'], { deleted: true, at: T });
});

test('progress of different episodes is kept; last follows the newest', () => {
  const a = { favs: {}, series: { 9: { name: 'S', cover: '', at: 10, eps: { 11: { pos: 50, dur: 100, done: false, at: 10 } },
    last: { epId: '11', season: '1', num: 2, ext: 'mp4', title: '', at: 10 } } } };
  const b = { favs: {}, series: { 9: { name: 'S', cover: '', at: 20, eps: { 12: { pos: 5, dur: 100, done: false, at: 20 } },
    last: { epId: '12', season: '1', num: 3, ext: 'mp4', title: '', at: 20 } } } };
  const m = merge(a, b);
  assert.deepStrictEqual(Object.keys(m.series[9].eps).sort(), ['11', '12']);
  assert.strictEqual(m.series[9].last.epId, '12');
  assert.strictEqual(merge(b, a).series[9].last.epId, '12');
});

test('tie goes to the second argument (server document)', () => {
  const m = merge({ favs: { 'vod:1': fav('1', T) }, series: {} }, { favs: { 'vod:1': { deleted: true, at: T } }, series: {} });
  assert.strictEqual(m.favs['vod:1'].deleted, true);
});

test('merge ignores __proto__ keys', () => {
  const m = merge(empty(), JSON.parse('{"favs":{"__proto__":{"polluted":true}},"series":{}}'));
  assert.strictEqual(Object.getPrototypeOf(m.favs), Object.prototype);
  assert.strictEqual(m.favs.polluted, undefined);
});

test('limits and tombstone expiry', () => {
  const now = Date.now();
  const d = empty();
  for (let i = 0; i < LIMITS.series + 5; i++) d.series[i] = { name: '', cover: '', at: i + 1, eps: {} };
  d.favs['vod:old'] = { deleted: true, at: now - LIMITS.tombstoneMs - 1 };
  const m = merge(empty(), d, now);
  assert.strictEqual(Object.keys(m.series).length, LIMITS.series);
  assert.ok(!m.series[0] && m.series[LIMITS.series + 4], 'oldest dropped');
  assert.ok(!m.favs['vod:old']);
});

test('validate.changes accepts the app format and rejects bad shapes', () => {
  const now = 1e12;
  const ok = validate.changes({
    favs: { 'vod:5000': { ...fav('5000', now), extra: 'dropped' }, 'series:9000': { deleted: true, at: now } },
    series: { 9000: { name: 'S', cover: 'http://img/x.jpg', at: now, eps: { 11: { pos: 10, dur: 100, done: false, at: now } },
      last: { epId: '11', season: '1', num: 2, ext: 'mp4', title: 'E', at: now } } }
  }, now);
  assert.strictEqual(ok.favs['vod:5000'].extra, undefined);
  const future = validate.changes({ favs: { 'vod:1': fav('1', now + 10 * 60 * 1000) } }, now);
  assert.strictEqual(future.favs['vod:1'].at, now, 'future timestamp clamped');

  const bad = [
    null, [], 'x', { favs: [] }, { favs: { 'live:1': fav('1', now) } }, { favs: { 'vod:1': fav('2', now) } },
    { favs: { 'vod:../x': fav('../x', now) } }, { favs: { 'vod:1': { ...fav('1', now), img: 'javascript:alert(1)' } } },
    { favs: { 'vod:1': { ...fav('1', now), name: 'x'.repeat(201) } } }, { favs: { 'vod:1': { ...fav('1', now), at: 'now' } } },
    { series: { 9: { name: 'S', cover: '', at: now } } },
    JSON.parse('{"series":{"__proto__":{"name":"","cover":"","at":1,"eps":{}}}}'),
    JSON.parse('{"favs":{"vod:__proto__":{"kind":"vod","id":"__proto__","at":1}}}'),
    { series: { 9: { name: '', cover: '', at: now, eps: { 1: { pos: -1, dur: 1, at: now } } } } }
  ];
  bad.forEach((b, i) => assert.throws(() => validate.changes(b, now), validate.ValidationError, 'case ' + i));
});

test('validate.credentials', () => {
  assert.deepStrictEqual(validate.credentials({ user: 'u', pass: 'p' }), { server: '', user: 'u', pass: 'p' });
  for (const b of [{}, { user: '', pass: 'p' }, { user: 'u', pass: 'p\n' }, { user: 'u', pass: 'p', server: 5 }, null]) {
    assert.throws(() => validate.credentials(b));
  }
});
