// Optional sync of the Library with the user's own sync service (deploy/sync).
// The IPTV password is sent only to POST /sync/session (in the body, never in a URL); afterwards
// only the session token travels. Any failure leaves the data local and retries later.
var Sync = (function () {
  var TOKENS = 'iptv.sync.token:';
  var BATCH_CHARS = 150000;
  var base = null, account = null, token = null, disabled = false;
  var timer = null, running = false, again = false, backoff = 0;

  // http is accepted only for local development hosts (emulator/desktop).
  function normalize(url) {
    var s = String(url || '').trim().replace(/\/+$/, '');
    if (!s) return null;
    var m = /^(https?):\/\/([^\/?#@\s]+)$/i.exec(s);
    if (!m) return false;
    var host = m[2].replace(/:\d+$/, '').toLowerCase();
    if (m[1].toLowerCase() === 'http' && !/^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/.test(host)) return false;
    return m[1].toLowerCase() + '://' + m[2].toLowerCase();
  }

  function request(method, path, body, auth) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, base + path, true);
      xhr.timeout = 15000;
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      if (auth) xhr.setRequestHeader('Authorization', 'Bearer ' + auth);
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        resolve({ status: xhr.status, data: data });
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error('network')); };
      xhr.send(body !== undefined ? JSON.stringify(body) : null);
    });
  }

  function tokenKey() { return TOKENS + base + '|' + account.server + '|' + account.user; }
  function loadToken() {
    try {
      var t = JSON.parse(localStorage.getItem(tokenKey()));
      return t && t.exp > Date.now() ? t.token : null;
    } catch (e) { return null; }
  }
  function saveToken(t, exp) {
    token = t;
    try { localStorage.setItem(tokenKey(), JSON.stringify({ token: t, exp: exp })); } catch (e) { /* storage unavailable */ }
  }
  function clearToken() {
    token = null;
    try { localStorage.removeItem(tokenKey()); } catch (e) { /* storage unavailable */ }
  }

  function Stop(reason) { this.stop = reason; }

  function session() {
    return request('POST', '/sync/session', { server: account.server, user: account.user, pass: account.pass })
      .then(function (r) {
        if (r.status === 200 && r.data && r.data.token) { saveToken(r.data.token, r.data.expiresAt); return; }
        // No sync service here (404/405/502) or account refused (401): stop for this login,
        // so the password is not sent again and again.
        if (r.status === 401 || r.status === 404 || r.status === 405 || r.status === 502) throw new Stop(r.status);
        throw new Error('HTTP ' + r.status);
      });
  }

  // Authenticated call; one silent renewal when the token expired.
  function call(method, path, body) {
    var ready = token ? Promise.resolve() : session();
    return ready.then(function () { return request(method, path, body, token); }).then(function (r) {
      if (r.status !== 401) return r;
      clearToken();
      return session().then(function () { return request(method, path, body, token); });
    });
  }

  // Split pending changes so each POST stays well under the service body limit.
  function batches(p) {
    var out = [], cur = null, size = 0;
    function add(type, k, v) {
      var n = k.length + JSON.stringify(v).length + 8;
      if (!cur || size + n > BATCH_CHARS) { cur = { favs: {}, series: {} }; out.push(cur); size = 0; }
      cur[type][k] = v;
      size += n;
    }
    Object.keys(p.favs).forEach(function (k) { add('favs', k, p.favs[k]); });
    Object.keys(p.series).forEach(function (k) { add('series', k, p.series[k]); });
    return out;
  }

  function push() {
    var list = batches(Library.pending());
    return list.reduce(function (chain, batch) {
      return chain.then(function () {
        return call('POST', '/sync/library', { changes: batch }).then(function (r) {
          if (r.status === 200 && r.data && r.data.doc) { Library.applyRemote(r.data.doc, batch); return; }
          // Rejected as invalid: drop it instead of retrying forever; the data stays local.
          if (r.status === 400 || r.status === 413) { Library.applyRemote(null, batch); return; }
          throw new Error('HTTP ' + r.status);
        });
      });
    }, Promise.resolve());
  }

  function pull() {
    return call('GET', '/sync/library').then(function (r) {
      if (r.status === 200 && r.data && r.data.doc) { Library.applyRemote(r.data.doc, null); return; }
      throw new Error('HTTP ' + r.status);
    });
  }

  function run() {
    clearTimeout(timer);
    if (!base || !account || disabled) return;
    if (running) { again = true; return; }
    running = true;
    again = false;
    var acct = account;
    (Library.hasPending() ? push().then(pull) : pull()).then(function () {
      running = false;
      if (acct !== account) return;
      backoff = 0;
      if (Sync.onSynced) Sync.onSynced();
      if (again) schedule(0);
    }, function (e) {
      running = false;
      if (acct !== account) return;
      if (e instanceof Stop) { disabled = true; return; }
      backoff = Math.min(Math.max(5000, backoff * 2), 300000);
      schedule(backoff);
    });
  }

  function schedule(ms) {
    if (!base || !account || disabled) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  return {
    onSynced: null,
    normalize: normalize,

    // url: sync service base (null/'' disables); acct: {server, user, pass}
    start: function (url, acct) {
      clearTimeout(timer);
      base = normalize(url) || null;
      account = base ? { server: acct.server, user: acct.user, pass: acct.pass } : null;
      disabled = false;
      backoff = 0;
      token = base ? loadToken() : null;
      run();
    },
    schedule: schedule,
    flush: function () { if (Library.hasPending()) run(); },
    active: function () { return !!(base && account && !disabled); },

    logout: function () {
      clearTimeout(timer);
      if (base && token) request('DELETE', '/sync/session', undefined, token).catch(function () { /* offline */ });
      if (base && account) clearToken();
      base = null;
      account = null;
    }
  };
})();
