// Favorites and series progress, kept per account (server + user) in localStorage.
// `pending` holds the changes not yet confirmed by the sync service (same shape as `doc`).
var Library = (function () {
  var PREFIX = 'iptv.lib.v1:';
  var key = null;
  var doc = LibMerge.empty();
  var pending = LibMerge.empty();

  function now() { return Date.now(); }

  function load() {
    doc = LibMerge.empty();
    pending = LibMerge.empty();
    if (!key) return;
    try {
      var s = JSON.parse(localStorage.getItem(key));
      if (s && s.doc) doc = LibMerge.merge(LibMerge.empty(), s.doc);
      if (s && s.pending) pending = LibMerge.merge(LibMerge.empty(), s.pending);
    } catch (e) { /* storage unavailable or corrupt: start empty */ }
  }

  function save() {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ doc: doc, pending: pending })); } catch (e) { /* storage unavailable */ }
  }

  // Apply a partial document locally and queue it for sync.
  function change(part) {
    doc = LibMerge.merge(doc, part);
    pending = LibMerge.merge(pending, part);
    save();
    if (Library.onChange) Library.onChange();
  }

  function favKey(kind, id) { return kind + ':' + id; }

  function isDone(pos, dur) { return dur > 0 && (pos >= 0.9 * dur || dur - pos < 120); }

  function seriesPart(series, fill) {
    var s = { name: String(series.name || ''), cover: String(series.cover || ''), at: now(), eps: {} };
    if (fill) fill(s);
    var part = { favs: {}, series: {} };
    part.series[String(series.id)] = s;
    return part;
  }

  return {
    onChange: null,

    use: function (server, user) {
      key = PREFIX + server + '|' + user;
      load();
    },

    isFav: function (kind, id) {
      var f = doc.favs[favKey(kind, id)];
      return !!(f && !f.deleted);
    },

    // item: {id, name, img, ext, cat}. Returns the new state.
    toggleFav: function (kind, item) {
      var k = favKey(kind, item.id);
      var on = !Library.isFav(kind, item.id);
      var part = { favs: {}, series: {} };
      part.favs[k] = on
        ? { kind: kind, id: String(item.id), name: String(item.name || ''), img: String(item.img || ''),
            ext: String(item.ext || ''), cat: String(item.cat || ''), at: now() }
        : { deleted: true, at: now() };
      change(part);
      return on;
    },

    favs: function (kind) {
      return Object.keys(doc.favs).map(function (k) { return doc.favs[k]; })
        .filter(function (f) { return !f.deleted && (!kind || f.kind === kind); })
        .sort(function (a, b) { return b.at - a.at; });
    },

    // series: {id, name, cover}; ep: {id, season, num, ext, title}
    saveProgress: function (series, ep, pos, dur) {
      if (!(dur > 0)) return;
      var t = now();
      change(seriesPart(series, function (s) {
        s.eps[String(ep.id)] = { pos: Math.max(0, Math.floor(pos)), dur: Math.floor(dur), done: isDone(pos, dur), at: t };
        s.last = { epId: String(ep.id), season: String(ep.season), num: Number(ep.num) || 0,
          ext: String(ep.ext || ''), title: String(ep.title || ''), at: t };
      }));
    },

    progress: function (seriesId) { return doc.series[String(seriesId)] || null; },

    episodeState: function (seriesId, epId) {
      var s = doc.series[String(seriesId)];
      return s && s.eps[String(epId)] || null;
    },

    // Series with a last episode, most recent first.
    recent: function () {
      return Object.keys(doc.series).map(function (id) {
        var s = doc.series[id];
        return { id: id, name: s.name, cover: s.cover, last: s.last, at: s.last ? s.last.at : 0 };
      }).filter(function (s) { return s.last; }).sort(function (a, b) { return b.at - a.at; });
    },

    // ---- sync hooks ----
    hasPending: function () {
      return Object.keys(pending.favs).length > 0 || Object.keys(pending.series).length > 0;
    },
    pending: function () { return JSON.parse(JSON.stringify(pending)); },
    // `remote`: merged document from the server; `sent`: the pending batch it already contains.
    applyRemote: function (remote, sent) {
      doc = LibMerge.merge(doc, remote);
      if (sent) {
        Object.keys(sent.favs).forEach(function (k) {
          if (pending.favs[k] && pending.favs[k].at <= sent.favs[k].at) delete pending.favs[k];
        });
        Object.keys(sent.series).forEach(function (k) {
          if (pending.series[k] && pending.series[k].at <= sent.series[k].at) delete pending.series[k];
        });
      }
      save();
    },
    isDone: isDone
  };
})();
