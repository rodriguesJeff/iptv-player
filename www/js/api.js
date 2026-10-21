// Xtream Codes / XUI.one client.
var Api = (function () {
  var cfg = { server: '', user: '', pass: '', format: 'm3u8' };
  var enc = encodeURIComponent;

  function get(url, timeoutMs) {
    // XHR instead of fetch: works cross-origin from file:// (Android WebView) and Tizen widgets.
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs || 30000;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('HTTP ' + xhr.status));
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('Resposta inválida do servidor')); }
      };
      xhr.onerror = function () { reject(new Error('Falha de rede')); };
      xhr.ontimeout = function () { reject(new Error('Tempo esgotado')); };
      xhr.send();
    });
  }

  function apiUrl(action, extra) {
    var url = cfg.server + '/player_api.php?username=' + enc(cfg.user) + '&password=' + enc(cfg.pass);
    if (action) url += '&action=' + action;
    if (extra) Object.keys(extra).forEach(function (k) { url += '&' + k + '=' + enc(extra[k]); });
    return url;
  }

  function call(action, extra) {
    return get(apiUrl(action, extra)).then(function (data) {
      // XUI answers {"user_info":{"auth":0}} or an empty list on bad credentials
      if (data && data.user_info && data.user_info.auth === 0) throw new Error('Usuário ou senha inválidos');
      return data;
    });
  }

  function streamUrl(kind, id, ext) {
    return cfg.server + '/' + kind + '/' + enc(cfg.user) + '/' + enc(cfg.pass) + '/' + id + '.' + ext;
  }

  function b64(s) {
    if (!s) return '';
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; }
  }

  return {
    configure: function (c) {
      cfg.server = String(c.server || '').trim().replace(/\/+$/, '');
      if (cfg.server && !/^https?:\/\//i.test(cfg.server)) cfg.server = 'http://' + cfg.server;
      cfg.user = c.user || '';
      cfg.pass = c.pass || '';
      cfg.format = c.format || 'm3u8';
      return cfg;
    },
    config: function () { return cfg; },

    login: function () {
      return call('').then(function (data) {
        if (!data || !data.user_info || Number(data.user_info.auth) !== 1) throw new Error('Usuário ou senha inválidos');
        if (data.user_info.status && data.user_info.status !== 'Active') throw new Error('Conta ' + data.user_info.status);
        return data;
      });
    },

    categories: function (kind) {
      return call('get_' + kind + '_categories').then(function (d) { return Array.isArray(d) ? d : []; });
    },
    streams: function (kind) {
      var action = kind === 'series' ? 'get_series' : 'get_' + kind + '_streams';
      return call(action).then(function (d) { return Array.isArray(d) ? d : []; });
    },
    seriesInfo: function (id) { return call('get_series_info', { series_id: id }); },
    vodInfo: function (id) { return call('get_vod_info', { vod_id: id }); },
    shortEpg: function (id) {
      return call('get_short_epg', { stream_id: id, limit: 4 }).then(function (d) {
        return (d && d.epg_listings || []).map(function (e) {
          return {
            title: b64(e.title),
            desc: b64(e.description),
            start: Number(e.start_timestamp) * 1000,
            end: Number(e.stop_timestamp) * 1000
          };
        });
      });
    },

    liveUrl: function (id) { return streamUrl('live', id, cfg.format); },
    vodUrl: function (id, ext) { return streamUrl('movie', id, ext || 'mp4'); },
    episodeUrl: function (id, ext) { return streamUrl('series', id, ext || 'mp4'); }
  };
})();
