// Library document merge, shared by the app (window.LibMerge) and the sync service (require).
// Document: { favs: { "<kind>:<id>": item | {deleted: true, at} },
//             series: { "<id>": { name, cover, at, last: {epId, season, num, ext, title, at},
//                                 eps: { "<epId>": {pos, dur, done, at} } } } }
// Every leaf carries `at` (ms); per key the newest `at` wins, ties go to `b`.
(function (root) {
  var LIMITS = { series: 100, eps: 300, favs: 2000, tombstoneMs: 90 * 24 * 3600 * 1000 };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function at(x) { return x && typeof x.at === 'number' ? x.at : 0; }
  function newer(a, b) { return at(b) >= at(a) ? b : a; }

  function empty() { return { favs: {}, series: {} }; }

  function mergeMap(a, b, fn) {
    var out = {}, k;
    for (k in a) if (own(a, k) && k !== '__proto__') out[k] = a[k];
    for (k in b) if (own(b, k) && k !== '__proto__') out[k] = own(out, k) ? fn(out[k], b[k]) : b[k];
    return out;
  }

  function mergeSeries(a, b) {
    var meta = newer(a, b);
    var s = { name: meta.name, cover: meta.cover, at: Math.max(at(a), at(b)), eps: mergeMap(a.eps || {}, b.eps || {}, newer) };
    var last = a.last && b.last ? newer(a.last, b.last) : a.last || b.last;
    if (last) s.last = last;
    return s;
  }

  // Keep the `max` newest keys of a map.
  function cap(map, max, filter) {
    var keys = Object.keys(map).filter(function (k) { return !filter || filter(map[k]); });
    if (keys.length <= max) return map;
    keys.sort(function (x, y) { return at(map[y]) - at(map[x]); });
    keys.slice(max).forEach(function (k) { delete map[k]; });
    return map;
  }

  function prune(doc, now) {
    now = now || Date.now();
    Object.keys(doc.favs).forEach(function (k) {
      if (doc.favs[k].deleted && now - at(doc.favs[k]) > LIMITS.tombstoneMs) delete doc.favs[k];
    });
    cap(doc.favs, LIMITS.favs, function (f) { return !f.deleted; });
    cap(doc.series, LIMITS.series);
    Object.keys(doc.series).forEach(function (k) { cap(doc.series[k].eps, LIMITS.eps); });
    return doc;
  }

  function merge(a, b, now) {
    a = a || empty();
    b = b || empty();
    return prune({
      favs: mergeMap(a.favs || {}, b.favs || {}, newer),
      series: mergeMap(a.series || {}, b.series || {}, mergeSeries)
    }, now);
  }

  var api = { merge: merge, prune: prune, empty: empty, LIMITS: LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LibMerge = api;
})(this);
