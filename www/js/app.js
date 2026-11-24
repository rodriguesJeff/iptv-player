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
  var seriesCur = null;    // {id, name, cover} of the open series
  var seriesSeason = null;

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

  // Web deploy: the sync service is on the same origin. Android/Tizen (file://): optional field.
  var webHosted = /^https?:$/.test(location.protocol);
  if (webHosted) $('f-sync-row').classList.add('hidden');
  var syncUrl = '';

  function cfgToSave() {
    var c = Api.config();
    return { server: c.server, user: c.user, pass: c.pass, format: c.format, sync: webHosted ? '' : syncUrl };
  }

  function doLogin(cfg, silent) {
    syncUrl = webHosted ? location.origin : String(cfg.sync || '').trim();
    if (syncUrl && Sync.normalize(syncUrl) === false) {
      show('login', silent ? undefined : $('f-sync'));
      $('login-msg').textContent = 'Servidor de sincronização precisa usar https://';
      return Promise.resolve();
    }
    Api.configure(cfg);
    loading(true);
    $('login-msg').textContent = '';
    return Api.login().then(function (info) {
      saveCfg(cfgToSave());
      Library.use(Api.config().server, Api.config().user);
      Sync.start(syncUrl, Api.config());
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
      sync: $('f-sync').value,
      format: $('f-format').textContent.indexOf('m3u8') >= 0 ? 'm3u8' : 'ts'
    });
  });

  $('logout').addEventListener('click', function () {
    var c = Api.config();
    Player.close();
    Sync.logout();
    saveCfg({ server: c.server, format: c.format, sync: webHosted ? '' : syncUrl });
    $('f-pass').value = '';
    show('login');
  });

  // ---------- main ----------
  // Favorites tab: built from the Library each time, items tagged with their real kind.
  function buildFavs() {
    var items = Library.recent().map(function (r) {
      return { _kind: 'series', _continue: r.last, series_id: r.id, name: r.name, cover: r.cover, category_id: 'continue' };
    });
    Library.favs().forEach(function (f) {
      if (f.kind === 'vod') {
        items.push({ _kind: 'vod', stream_id: f.id, name: f.name, stream_icon: f.img, container_extension: f.ext, category_id: 'vod' });
      } else if (f.kind === 'series') {
        items.push({ _kind: 'series', series_id: f.id, name: f.name, cover: f.img, category_id: 'series' });
      }
    });
    data.favs = {
      cats: [
        { category_id: 'continue', category_name: 'Continuar assistindo' },
        { category_id: 'vod', category_name: 'Filmes' },
        { category_id: 'series', category_name: 'Séries' }
      ],
      items: items
    };
    return data.favs;
  }

  function ensure(kind) {
    if (kind === 'favs') return Promise.resolve(buildFavs());
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
      if (kind === 'favs') {
        renderCats(d.cats, true);
        selectCat(Library.recent().length ? 'continue' : 'vod');
      } else {
        renderCats(d.cats);
        selectCat('all');
      }
      var first = $('items').querySelector('.focusable');
      Nav.focus(first || $('cats').querySelector('.cat'));
    }).catch(function (e) { toast(e.message); });
  }

  function renderCats(cats, noAll) {
    var box = $('cats');
    box.innerHTML = '';
    var all = noAll ? cats : [{ category_id: 'all', category_name: 'Todos' }].concat(cats);
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
      // Search in the favorites tab covers favorites only ("continue" duplicates them).
      if (q) return !it._continue && String(it.name || '').toLowerCase().indexOf(q) >= 0;
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
    if (!view.length) { box.appendChild(el('div', 'empty', emptyText())); return; }
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

  function emptyText() {
    if (tab !== 'favs' || $('search').value.trim()) return 'Nada aqui.';
    if (catId === 'continue') return 'Nenhuma série em andamento. Assista a um episódio e ele aparece aqui.';
    return 'Nenhum favorito ainda. Use ☆ Favoritar no painel de detalhes ou na tela da série, ' +
      'a tecla vermelha do controle, ou pressione e segure um filme ou série.';
  }

  function kindOf(it) { return it._kind || tab; }
  function idOf(it, kind) { return kind === 'vod' ? it.stream_id : it.series_id; }
  function epLabel(last) { return 'T' + last.season + 'E' + last.num; }

  function card(it, i) {
    var kind = kindOf(it);
    var b = el('button', 'focusable card');
    b.setAttribute('data-idx', i);
    if (kind === 'live') {
      b.classList.add('channel');
      b.appendChild(el('span', 'num', it.num != null ? String(it.num) : ''));
      b.appendChild(img(it.stream_icon));
    } else {
      b.appendChild(img(kind === 'vod' ? it.stream_icon : it.cover));
      if (Library.isFav(kind, idOf(it, kind))) b.classList.add('fav');
      // Long press (touch) / right click toggles the favorite.
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); toggleFav(i); });
    }
    b.appendChild(el('span', 'name', it.name));
    if (it._continue) b.appendChild(el('span', 'muted', 'Parou em ' + epLabel(it._continue)));
    b.addEventListener('click', function () { openItem(i); });
    return b;
  }

  function favData(it, kind) {
    return kind === 'vod'
      ? { id: it.stream_id, name: it.name, img: it.stream_icon, ext: it.container_extension, cat: it.category_id }
      : { id: it.series_id, name: it.name, img: it.cover, cat: it.category_id };
  }

  // Mark rendered cards after a favorite changed elsewhere (series screen, details panel).
  function refreshFavMarks() {
    Array.prototype.forEach.call($('items').querySelectorAll('.card[data-idx]'), function (c) {
      var it = view[Number(c.getAttribute('data-idx'))];
      var kind = it && kindOf(it);
      if (kind && kind !== 'live') c.classList.toggle('fav', Library.isFav(kind, idOf(it, kind)));
    });
  }

  // Rebuild the favorites grid in place, keeping focus close to where it was.
  function reloadFavs(focusIdx) {
    buildFavs();
    applyFilter();
    if (focusIdx == null) return;
    var n = Math.min(focusIdx, view.length - 1);
    Nav.focus(n >= 0 ? $('items').querySelector('[data-idx="' + n + '"]') : $('cats').querySelector('.selected'));
  }

  function toggleFav(i) {
    var it = view[i];
    var kind = it && kindOf(it);
    if (!it || kind === 'live') return;
    var on = Library.toggleFav(kind, favData(it, kind));
    toast(on ? '★ Adicionado aos favoritos' : 'Removido dos favoritos');
    if (tab === 'favs' && !it._continue) { reloadFavs(i); return; }
    if (tab === 'favs') buildFavs();
    refreshFavMarks();
    var btn = $('info').querySelector('.fav-btn');
    if (btn && btn.getAttribute('data-idx') === String(i)) favButtonLabel(btn, on);
  }

  function favButtonLabel(btn, on) {
    btn.textContent = on ? '★ Favorito' : '☆ Favoritar';
    btn.classList.toggle('on', on);
  }

  function liveEntry(it) {
    return { title: it.name, url: Api.liveUrl(it.stream_id), live: true, streamId: it.stream_id, num: it.num };
  }

  // First OK previews in the side panel, OK again on the same item goes full screen.
  function openItem(i) {
    var it = view[i];
    var kind = kindOf(it);
    if (kind === 'live') {
      Player.preview(view.map(liveEntry), i, $('preview'), focusCard);
    } else if (kind === 'vod') {
      Player.preview([{ title: it.name, url: Api.vodUrl(it.stream_id, it.container_extension), live: false }], 0,
        $('preview'), function () { focusCard(i); });
    } else {
      openSeries(it, { focusContinue: !!it._continue });
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
    var kind = kindOf(it);
    box.innerHTML = '';
    box.appendChild(el('h3', '', it.name));
    if (kind !== 'live') {
      var fb = el('button', 'focusable btn fav-btn');
      fb.setAttribute('data-idx', i);
      favButtonLabel(fb, Library.isFav(kind, idOf(it, kind)));
      fb.addEventListener('click', function () { toggleFav(i); });
      box.appendChild(fb);
    }
    if (kind === 'live') {
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
    } else if (kind === 'series') {
      if (it.cover) box.insertBefore(img(it.cover), box.firstChild);
      if (it._continue) box.appendChild(el('p', 'muted', 'Parou em ' + epLabel(it._continue)));
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
  function seasonList() {
    return Object.keys(seriesEpisodes).sort(function (a, b) { return Number(a) - Number(b); });
  }

  // Where "Continuar" goes: the last episode if unfinished, else the next one, else replay the last.
  function resumeTarget() {
    var pr = Library.progress(seriesCur.id);
    if (!pr || !pr.last) return null;
    var flat = [];
    seasonList().forEach(function (s) {
      (seriesEpisodes[s] || []).forEach(function (ep, i) { flat.push({ season: s, idx: i, ep: ep }); });
    });
    var at = -1;
    for (var k = 0; k < flat.length; k++) if (String(flat[k].ep.id) === pr.last.epId) { at = k; break; }
    if (at < 0) return null;                       // episode no longer on the server
    var st = pr.eps[pr.last.epId];
    var t = flat[at], label = 'Continuar';
    if (st && st.done) {
      if (at + 1 < flat.length) t = flat[at + 1];
      else label = 'Rever';
    }
    var ts = Library.episodeState(seriesCur.id, t.ep.id);
    return {
      season: t.season, idx: t.idx, label: label + ' T' + t.season + 'E' + t.ep.episode_num,
      start: label === 'Continuar' && ts && !ts.done ? ts.pos : 0
    };
  }

  function updateSeriesActions() {
    var c = $('series-continue');
    var t = resumeTarget();
    c.classList.toggle('hidden', !t);
    c.textContent = t ? '▶ ' + t.label : '';
    var f = $('series-fav');
    var on = Library.isFav('series', seriesCur.id);
    f.textContent = on ? '★ Favorito' : '☆ Favoritar';
    f.classList.toggle('on', on);
    return t;
  }

  $('series-continue').addEventListener('click', function () {
    var t = resumeTarget();
    if (!t) return;
    selectSeason(t.season);
    playEpisode(t.idx, t.start);
  });

  $('series-fav').addEventListener('click', function () {
    var on = Library.toggleFav('series', { id: seriesCur.id, name: seriesCur.name, img: seriesCur.cover, cat: seriesCur.cat });
    toast(on ? '★ Adicionado aos favoritos' : 'Removido dos favoritos');
    updateSeriesActions();
  });

  function openSeries(it, opts) {
    seriesOrigin = document.activeElement;
    loading(true);
    Api.seriesInfo(it.series_id).then(function (r) {
      loading(false);
      var info = r.info || {};
      var cover = info.cover || it.cover;
      seriesCur = { id: String(it.series_id), name: info.name || it.name, cover: cover || '', cat: it.category_id };
      $('series-title').textContent = seriesCur.name;
      $('series-plot').textContent = info.plot || it.plot || '';
      if (cover) $('series-cover').src = cover; else $('series-cover').removeAttribute('src');
      seriesEpisodes = r.episodes || {};
      var seasons = seasonList();
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
      Nav.forget('series-actions');
      var t = updateSeriesActions();
      if (seasons.length) selectSeason(t ? t.season : seasons[0]);
      else $('episodes').innerHTML = '<div class="empty">Nenhum episódio.</div>';
      var first = t && opts && opts.focusContinue ? $('series-continue')
        : t ? $('episodes').querySelector('[data-idx="' + t.idx + '"]') : null;
      show('series', first || $('episodes').querySelector('.focusable') || $('series-fav'));
    }).catch(function (e) { loading(false); toast(e.message); });
  }

  var seasonEntries = [];

  function selectSeason(s) {
    seriesSeason = s;
    Array.prototype.forEach.call($('seasons').children, function (b) {
      b.classList.toggle('selected', b.getAttribute('data-season') === s);
    });
    var eps = seriesEpisodes[s] || [];
    var series = seriesCur;
    var box = $('episodes');
    box.innerHTML = '';
    Nav.forget('episodes');
    seasonEntries = eps.map(function (ep) {
      var st = Library.episodeState(series.id, ep.id);
      var meta = { id: ep.id, season: s, num: ep.episode_num, ext: ep.container_extension, title: ep.title };
      return {
        title: series.name + ' – T' + s + 'E' + ep.episode_num,
        subtitle: ep.title,
        url: Api.episodeUrl(ep.id, ep.container_extension),
        live: false,
        start: st && !st.done ? st.pos : 0,
        onProgress: function (cur, dur) { Library.saveProgress(series, meta, cur, dur); }
      };
    });
    eps.forEach(function (ep, i) {
      var b = el('button', 'focusable card episode');
      b.setAttribute('data-idx', i);
      var info = ep.info || {};
      if (info.movie_image) {
        b.appendChild(img(info.movie_image));
      }
      b.appendChild(el('span', 'name', ep.episode_num + '. ' + (ep.title || '')));
      if (info.duration) b.appendChild(el('span', 'muted', info.duration));
      var st = Library.episodeState(series.id, ep.id);
      if (st && st.done) {
        b.appendChild(el('span', 'ep-done', '✓ Assistido'));
      } else if (st && st.dur > 0) {
        var bar = el('div', 'ep-progress');
        var fill = el('div');
        fill.style.width = Math.min(100, Math.round(100 * st.pos / st.dur)) + '%';
        bar.appendChild(fill);
        b.appendChild(bar);
      }
      b.addEventListener('click', function () { playEpisode(i); });
      box.appendChild(b);
    });
  }

  // Plays episode `i` of the shown season; `start` overrides the saved position.
  function playEpisode(i, start) {
    var entries = seasonEntries.slice();
    if (start != null) {
      entries[i] = Object.keys(entries[i]).reduce(function (o, k) { o[k] = entries[i][k]; return o; }, {});
      entries[i].start = start;
    }
    var season = seriesSeason;
    Player.full(entries, i, function () {
      // Back from the player: show the new progress and keep focus on that episode.
      updateSeriesActions();
      if (current !== 'series' || seriesSeason !== season) return;
      selectSeason(season);
      Nav.focus($('episodes').querySelector('[data-idx="' + i + '"]'));
    });
  }

  // ---------- keys ----------
  var KEY = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
    10009: 'back', 27: 'back', 8: 'back',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown',
    10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 403: 'red',
    65376: 'imedone', 65385: 'imecancel'
  };

  if (window.tizen && tizen.tvinputdevice) {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
      'ChannelUp', 'ChannelDown', 'ColorF0Red'].forEach(function (name) {
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
      var origin = seriesOrigin && $('items').contains(seriesOrigin) ? seriesOrigin : undefined;
      var idx = origin ? Number(origin.getAttribute('data-idx')) : 0;
      show('main', origin);
      if (tab === 'favs') reloadFavs(idx); else refreshFavMarks();
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
    if (k === 'red') {
      if (current === 'main' && a && a.classList.contains('card') && a.parentNode === $('items')) {
        toggleFav(Number(a.getAttribute('data-idx')));
      } else if (current === 'series') {
        $('series-fav').click();
      }
      return;
    }
    if (k === 'enter') {
      if (a && a.tagName === 'INPUT') editInput(a);
      else if (a && a.classList.contains('focusable')) a.click();
      return;
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') Nav.move(k);
  });

  // ---------- sync ----------
  Library.onChange = function () { Sync.schedule(2000); };
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Sync.flush(); else Sync.schedule(0);
  });
  // Data from another device arrived: refresh what is on screen without stealing focus.
  Sync.onSynced = function () {
    if (current === 'series' && seriesCur) {
      updateSeriesActions();
    } else if (current === 'main' && !Player.isFull()) {
      var a = document.activeElement;
      if (tab === 'favs' && !(a && $('items').contains(a))) { buildFavs(); applyFilter(); }
      else refreshFavMarks();
    }
  };

  // ---------- boot ----------
  (function boot() {
    var cfg = loadCfg();
    if (cfg.server) $('f-server').value = cfg.server;
    if (cfg.user) $('f-user').value = cfg.user;
    if (cfg.pass) $('f-pass').value = cfg.pass;
    if (cfg.sync) $('f-sync').value = cfg.sync;
    updateFormatBtn(cfg.format || 'm3u8');
    if (cfg.server && cfg.user && cfg.pass) doLogin(cfg, true);
    else show('login');
  })();

  return { toast: toast, back: back };
})();
