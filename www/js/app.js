var App = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'iptv.cfg';
  var CHUNK = 150;

  var screens = { login: $('login'), main: $('main'), series: $('series') };
  var current = 'login';
  var tab = 'live';
  var data = {};          // kind -> { cats, items }
  var view = [];          // filtered items of the current tab
  var rendered = 0;
  var catId = 'all';
  var lastBack = 0;
  var detailsTimer = null, catTimer = null, searchTimer = null, toastTimer = null;
  var seriesEpisodes = {};
  var seriesOrigin = null;

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function img(src, cls) {
    var i = el('img', cls);
    i.loading = 'lazy';
    i.alt = '';
    if (src) i.src = src;
    i.onerror = function () { i.removeAttribute('src'); };
    return i;
  }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  function saveCfg(c) {
    try { localStorage.setItem(STORE, JSON.stringify(c)); } catch (e) { /* storage unavailable */ }
  }

  function loading(on) { $('loading').classList.toggle('hidden', !on); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }

  function show(name, focusEl) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('hidden', k !== name); });
    current = name;
    Nav.setRoot(screens[name], focusEl);
  }

  function hhmm(ms) {
    var d = new Date(ms);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  // ---------- login ----------
  function updateFormatBtn(fmt) { $('f-format').textContent = 'Formato ao vivo: ' + fmt; }

  function doLogin(cfg, silent) {
    Api.configure(cfg);
    loading(true);
    $('login-msg').textContent = '';
    return Api.login().then(function (info) {
      saveCfg(Api.config());
      var exp = Number(info.user_info.exp_date);
      $('account').textContent = exp ? 'Expira ' + new Date(exp * 1000).toLocaleDateString('pt-BR') : '';
      data = {};
      show('main');
      selectTab('live');
    }).catch(function (e) {
      loading(false);
      show('login', silent ? undefined : $('f-login'));
      $('login-msg').textContent = e.message;
    });
  }

  $('f-format').addEventListener('click', function () {
    var fmt = $('f-format').textContent.indexOf('m3u8') >= 0 ? 'ts' : 'm3u8';
    updateFormatBtn(fmt);
  });

  $('f-login').addEventListener('click', function () {
    doLogin({
      server: $('f-server').value,
      user: $('f-user').value,
      pass: $('f-pass').value,
      format: $('f-format').textContent.indexOf('m3u8') >= 0 ? 'm3u8' : 'ts'
    });
  });

  $('logout').addEventListener('click', function () {
    var c = Api.config();
    saveCfg({ server: c.server, format: c.format });
    Player.close();
    $('f-pass').value = '';
    show('login');
  });

  // ---------- main ----------
  function ensure(kind) {
    if (data[kind]) return Promise.resolve(data[kind]);
    loading(true);
    return Promise.all([Api.categories(kind), Api.streams(kind)]).then(function (r) {
      loading(false);
      data[kind] = { cats: r[0], items: r[1] };
      return data[kind];
    }, function (e) { loading(false); throw e; });
  }

  function selectTab(kind) {
    tab = kind;
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === kind);
    });
    Player.close();
    $('search').value = '';
    $('info').innerHTML = '';
    Nav.forget('cats');
    Nav.forget('items');
    return ensure(kind).then(function (d) {
      renderCats(d.cats);
      selectCat('all');
      var first = $('items').querySelector('.focusable');
      Nav.focus(first || $('cats').querySelector('.cat'));
    }).catch(function (e) { toast(e.message); });
  }

  function renderCats(cats) {
    var box = $('cats');
    box.innerHTML = '';
    var all = [{ category_id: 'all', category_name: 'Todos' }].concat(cats);
    all.forEach(function (c) {
      var b = el('button', 'focusable cat', c.category_name);
      b.setAttribute('data-id', c.category_id);
      b.addEventListener('click', function () {
        selectCat(c.category_id);
        Nav.focus($('items').querySelector('.focusable') || b);
      });
      box.appendChild(b);
    });
  }

  function selectCat(id) {
    catId = String(id);
    Array.prototype.forEach.call($('cats').children, function (b) {
      b.classList.toggle('selected', b.getAttribute('data-id') === catId);
    });
    applyFilter();
  }

  function applyFilter() {
    var items = data[tab] ? data[tab].items : [];
    var q = $('search').value.trim().toLowerCase();
    view = items.filter(function (it) {
      if (q) return String(it.name || '').toLowerCase().indexOf(q) >= 0;
      return catId === 'all' || String(it.category_id) === catId;
    });
    renderItems();
  }

  function renderItems() {
    var box = $('items');
    box.innerHTML = '';
    box.scrollTop = 0;
    box.classList.toggle('list', tab === 'live');
    rendered = 0;
    Nav.forget('items');
    if (!view.length) { box.appendChild(el('div', 'empty', 'Nada aqui.')); return; }
    renderMore();
  }

  function renderMore() {
    var box = $('items');
    var end = Math.min(view.length, rendered + CHUNK);
    var frag = document.createDocumentFragment();
    for (var i = rendered; i < end; i++) frag.appendChild(card(view[i], i));
    box.appendChild(frag);
    rendered = end;
  }

  function card(it, i) {
    var b = el('button', 'focusable card');
    b.setAttribute('data-idx', i);
    if (tab === 'live') {
      b.classList.add('channel');
      b.appendChild(el('span', 'num', it.num != null ? String(it.num) : ''));
      b.appendChild(img(it.stream_icon));
    } else {
      b.appendChild(img(tab === 'vod' ? it.stream_icon : it.cover));
    }
    b.appendChild(el('span', 'name', it.name));
    b.addEventListener('click', function () { openItem(i); });
    return b;
  }

  function liveEntry(it) {
    return { title: it.name, url: Api.liveUrl(it.stream_id), live: true, streamId: it.stream_id, num: it.num };
  }

  // First OK previews in the side panel, OK again on the same item goes full screen.
  function openItem(i) {
    var it = view[i];
    if (tab === 'live') {
      Player.preview(view.map(liveEntry), i, $('preview'), focusCard);
    } else if (tab === 'vod') {
      Player.preview([{ title: it.name, url: Api.vodUrl(it.stream_id, it.container_extension), live: false }], 0,
        $('preview'), function () { focusCard(i); });
    } else {
      openSeries(it);
    }
  }

  // Back from the player (zapping may have moved to another channel).
  function focusCard(idx) {
    while (idx >= rendered && rendered < view.length) renderMore();
    var target = $('items').querySelector('[data-idx="' + idx + '"]');
    if (target) Nav.focus(target);
  }

  // details panel
  function showDetails(i) {
    var it = view[i];
    var box = $('info');
    if (!it) return;
    box.innerHTML = '';
    box.appendChild(el('h3', '', it.name));
    if (tab === 'live') {
      box.appendChild(el('p', 'muted', 'Carregando guia…'));
      Api.shortEpg(it.stream_id).then(function (epg) {
        if (view[i] !== it) return;
        box.innerHTML = '';
        box.appendChild(el('h3', '', it.name));
        if (!epg.length) box.appendChild(el('p', 'muted', 'Sem guia de programação.'));
        epg.forEach(function (e) {
          var d = el('div', 'epg-item');
          d.appendChild(el('div', 'epg-time', hhmm(e.start) + ' – ' + hhmm(e.end)));
          d.appendChild(el('div', '', e.title));
          if (e.desc) d.appendChild(el('div', 'muted', e.desc));
          box.appendChild(d);
        });
      }).catch(function () { /* no EPG */ });
    } else if (tab === 'series') {
      if (it.cover) box.insertBefore(img(it.cover), box.firstChild);
      if (it.genre) box.appendChild(el('p', 'muted', it.genre));
      if (it.rating) box.appendChild(el('p', 'muted', '★ ' + it.rating));
      if (it.plot) box.appendChild(el('p', '', it.plot));
    } else {
      if (it.stream_icon) box.insertBefore(img(it.stream_icon), box.firstChild);
      if (it.rating) box.appendChild(el('p', 'muted', '★ ' + it.rating));
      Api.vodInfo(it.stream_id).then(function (r) {
        var info = r && r.info;
        if (view[i] !== it || !info) return;
        if (info.genre) box.appendChild(el('p', 'muted', info.genre));
        if (info.duration) box.appendChild(el('p', 'muted', info.duration));
        if (info.plot || info.description) box.appendChild(el('p', '', info.plot || info.description));
      }).catch(function () { /* no info */ });
    }
  }

  Nav.onFocus = function (e) {
    if (e.classList.contains('card') && e.parentNode === $('items')) {
      var i = Number(e.getAttribute('data-idx'));
      if (i >= rendered - 30 && rendered < view.length) renderMore();
      clearTimeout(detailsTimer);
      detailsTimer = setTimeout(function () { showDetails(i); }, 500);
    } else if (e.classList.contains('cat') && e.parentNode === $('cats')) {
      // D-pad browsing: preview the category after a short pause
      clearTimeout(catTimer);
      catTimer = setTimeout(function () {
        if (document.activeElement === e && $('search').value === '') selectCat(e.getAttribute('data-id'));
      }, 450);
    } else if (e.parentNode === $('seasons')) {
      clearTimeout(catTimer);
      catTimer = setTimeout(function () {
        if (document.activeElement === e) selectSeason(e.getAttribute('data-season'));
      }, 450);
    }
  };

  Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (t) {
    t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
  });

  $('search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 300);
  });

  // ---------- series ----------
  function openSeries(it) {
    seriesOrigin = document.activeElement;
    loading(true);
    Api.seriesInfo(it.series_id).then(function (r) {
      loading(false);
      var info = r.info || {};
      $('series-title').textContent = info.name || it.name;
      $('series-plot').textContent = info.plot || it.plot || '';
      var cover = info.cover || it.cover;
      if (cover) $('series-cover').src = cover; else $('series-cover').removeAttribute('src');
      seriesEpisodes = r.episodes || {};
      var seasons = Object.keys(seriesEpisodes).sort(function (a, b) { return Number(a) - Number(b); });
      var box = $('seasons');
      box.innerHTML = '';
      seasons.forEach(function (s) {
        var b = el('button', 'focusable cat', 'Temporada ' + s);
        b.setAttribute('data-season', s);
        b.addEventListener('click', function () {
          selectSeason(s);
          Nav.focus($('episodes').querySelector('.focusable') || b);
        });
        box.appendChild(b);
      });
      Nav.forget('seasons');
      Nav.forget('episodes');
      if (seasons.length) selectSeason(seasons[0]);
      else $('episodes').innerHTML = '<div class="empty">Nenhum episódio.</div>';
      show('series', $('episodes').querySelector('.focusable'));
    }).catch(function (e) { loading(false); toast(e.message); });
  }

  function selectSeason(s) {
    Array.prototype.forEach.call($('seasons').children, function (b) {
      b.classList.toggle('selected', b.getAttribute('data-season') === s);
    });
    var eps = seriesEpisodes[s] || [];
    var title = $('series-title').textContent;
    var box = $('episodes');
    box.innerHTML = '';
    Nav.forget('episodes');
    var entries = eps.map(function (ep) {
      return {
        title: title + ' – T' + s + 'E' + ep.episode_num,
        subtitle: ep.title,
        url: Api.episodeUrl(ep.id, ep.container_extension),
        live: false
      };
    });
    eps.forEach(function (ep, i) {
      var b = el('button', 'focusable card episode');
      var info = ep.info || {};
      if (info.movie_image) {
        b.appendChild(img(info.movie_image));
      }
      b.appendChild(el('span', 'name', ep.episode_num + '. ' + (ep.title || '')));
      if (info.duration) b.appendChild(el('span', 'muted', info.duration));
      b.addEventListener('click', function () {
        Player.full(entries, i, function () { Nav.focus(b); });
      });
      box.appendChild(b);
    });
  }

  // ---------- keys ----------
  var KEY = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
    10009: 'back', 27: 'back', 8: 'back',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown',
    10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw',
    65376: 'imedone', 65385: 'imecancel'
  };

  if (window.tizen && tizen.tvinputdevice) {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
      'ChannelUp', 'ChannelDown'].forEach(function (name) {
      try { tizen.tvinputdevice.registerKey(name); } catch (e) { /* key not on this model */ }
    });
  }

  function exitApp() {
    if (window.AndroidBridge) return false;
    if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return true; }
    return true;
  }

  function back() {
    if (Player.isFull()) { Player.key('back'); return true; }
    if (Player.mode() === 'preview') { Player.close(); return true; }
    if (current === 'series') {
      show('main', seriesOrigin && $('items').contains(seriesOrigin) ? seriesOrigin : undefined);
      return true;
    }
    if (current === 'main') {
      var a = document.activeElement;
      if (a && a.closest('#items')) { Nav.focus($('cats').querySelector('.selected')); return true; }
      if (a && a.closest('#cats')) { Nav.focus($('tabs').querySelector('.tab.active')); return true; }
    }
    if (Date.now() - lastBack < 2000) return exitApp();
    lastBack = Date.now();
    toast('Pressione voltar de novo para sair');
    return true;
  }

  // Inputs stay readonly while browsing so the TV keyboard doesn't pop up on focus.
  var reopening = false;
  function editInput(input) {
    input.removeAttribute('readonly');
    // blur+focus makes the TV/phone keyboard appear; the blur must not re-lock the field
    reopening = true;
    input.blur();
    input.focus();
    reopening = false;
    if (window.AndroidBridge) AndroidBridge.showKeyboard();
  }
  function finishInput(input) {
    input.setAttribute('readonly', '');
    if (input.id === 'search') applyFilter();
  }
  Array.prototype.forEach.call(document.querySelectorAll('input'), function (i) {
    i.setAttribute('readonly', '');
    i.addEventListener('click', function () { if (i.hasAttribute('readonly')) editInput(i); });
    i.addEventListener('blur', function () { if (!reopening && !i.hasAttribute('readonly')) finishInput(i); });
  });

  document.addEventListener('keydown', function (e) {
    var k = KEY[e.keyCode];
    if (!k) return;
    var a = document.activeElement;
    var editing = a && a.tagName === 'INPUT' && !a.hasAttribute('readonly');

    if (Player.isFull()) { e.preventDefault(); Player.key(k); return; }

    if (editing) {
      if (k === 'enter' || k === 'imedone' || k === 'imecancel') {
        e.preventDefault();
        finishInput(a);
        Nav.focus(a);
        if (k !== 'imecancel' && current === 'login') Nav.move('down');
      } else if (k === 'up' || k === 'down') {
        e.preventDefault();
        finishInput(a);
        Nav.move(k);
      }
      return; // left/right/backspace edit text
    }

    e.preventDefault();
    if (k === 'back') { back(); return; }
    if (k === 'enter') {
      if (a && a.tagName === 'INPUT') editInput(a);
      else if (a && a.classList.contains('focusable')) a.click();
      return;
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') Nav.move(k);
  });

  // ---------- boot ----------
  (function boot() {
    var cfg = loadCfg();
    if (cfg.server) $('f-server').value = cfg.server;
    if (cfg.user) $('f-user').value = cfg.user;
    if (cfg.pass) $('f-pass').value = cfg.pass;
    updateFormatBtn(cfg.format || 'm3u8');
    if (cfg.server && cfg.user && cfg.pass) doLogin(cfg, true);
    else show('login');
  })();

  return { toast: toast, back: back };
})();
