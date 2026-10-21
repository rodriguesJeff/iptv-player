// Playback surface that sits *behind* the page (AVPlay plane on Tizen, native ExoPlayer view on
// Android, a fixed <video> elsewhere). The page stays transparent over it while playing, so the
// video shows through either the #preview box (preview mode) or the whole screen (full mode).
var Player = (function () {
  var screenEl = document.getElementById('player');
  var video = document.getElementById('video');
  var osd = document.getElementById('osd');
  var osdTitle = document.getElementById('osd-title');
  var osdSub = document.getElementById('osd-sub');
  var osdBar = osd.querySelector('.bar');
  var osdProgress = document.getElementById('osd-progress');
  var spinner = document.getElementById('spinner');

  var list = [], index = 0;
  var mode = 'idle';          // idle | preview | full
  var fromPreview = false;    // full mode entered from preview: back returns there
  var previewEl = null;
  var hls = null, osdTimer = null, zapTimer = null, progressTimer = null;
  var onClose = null, onReturn = null;

  var avplay = window.webapis && window.webapis.avplay;
  var android = window.AndroidBridge;

  // Rect of the video surface in CSS px, or null for full screen.
  function surfaceRect() {
    if (mode !== 'preview' || !previewEl) return null;
    var r = previewEl.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // ---------- backends ----------
  var tizen = {
    open: function (item) {
      document.getElementById('avplayer').style.display = 'block';
      try { avplay.stop(); avplay.close(); } catch (e) { /* nothing open */ }
      try {
        avplay.open(item.url);
        avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        tizen.rect(surfaceRect());
        avplay.setListener({
          onbufferingstart: function () { busy(true); },
          onbufferingcomplete: function () { busy(false); tizen.rect(surfaceRect()); },
          onstreamcompleted: function () { if (!item.live) close(); },
          onerror: function (e) { busy(false); fail(e); }
        });
        busy(true);
        avplay.prepareAsync(function () {
          busy(false);
          // Older AVPlay (Tizen 6.5) resets the rect during prepare; apply it again
          tizen.rect(surfaceRect());
          avplay.play();
        }, function (e) { busy(false); fail(e); });
      } catch (e) { busy(false); fail(e); }
    },
    stop: function () {
      try { avplay.stop(); avplay.close(); } catch (e) { /* already closed */ }
      document.getElementById('avplayer').style.display = 'none';
    },
    // AVPlay coordinates are on a 1920x1080 grid regardless of the page resolution.
    rect: function (r) {
      var s = 1920 / window.innerWidth;
      try {
        if (r) avplay.setDisplayRect(Math.round(r.x * s), Math.round(r.y * s), Math.round(r.w * s), Math.round(r.h * s));
        else avplay.setDisplayRect(0, 0, 1920, 1080);
      } catch (e) { /* player not open yet */ }
    },
    toggle: function () {
      var st = avplay.getState();
      if (st === 'PLAYING') avplay.pause(); else if (st === 'PAUSED') avplay.play();
    },
    seek: function (sec) {
      try {
        if (sec > 0) avplay.jumpForward(sec * 1000); else avplay.jumpBackward(-sec * 1000);
      } catch (e) { /* not seekable */ }
    },
    position: function () {
      try { return { cur: avplay.getCurrentTime() / 1000, dur: avplay.getDuration() / 1000 }; }
      catch (e) { return { cur: 0, dur: 0 }; }
    }
  };

  var droid = {
    open: function (item) {
      busy(true);
      android.open(item.url, !!item.live);
      droid.rect(surfaceRect());
    },
    stop: function () { android.stop(); },
    rect: function (r) {
      if (r) android.setRect(r.x, r.y, r.w, r.h); else android.setRect(-1, -1, -1, -1);
    },
    toggle: function () { android.toggle(); },
    seek: function (sec) { android.seek(sec * 1000); },
    position: function () {
      try { return JSON.parse(android.position()); } catch (e) { return { cur: 0, dur: 0 }; }
    }
  };

  var html5 = {
    open: function (item) {
      html5.stop();
      video.style.display = 'block';
      html5.rect(surfaceRect());
      var url = item.live ? item.url.replace(/\.ts$/, '.m3u8') : item.url;
      busy(true);
      if (/\.m3u8(\?|$)/.test(url) && window.Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, function (_, data) { if (data.fatal) fail(data.details); });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        video.src = url;
      }
      video.play().catch(function () { /* autoplay may need a key press */ });
    },
    stop: function () {
      if (hls) { hls.destroy(); hls = null; }
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
    },
    rect: function (r) {
      video.style.left = r ? r.x + 'px' : '0';
      video.style.top = r ? r.y + 'px' : '0';
      video.style.width = r ? r.w + 'px' : '100%';
      video.style.height = r ? r.h + 'px' : '100%';
    },
    toggle: function () { if (video.paused) video.play(); else video.pause(); },
    seek: function (sec) { if (isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + sec); },
    position: function () { return { cur: video.currentTime || 0, dur: isFinite(video.duration) ? video.duration : 0 }; }
  };

  video.addEventListener('playing', function () { busy(false); });
  video.addEventListener('waiting', function () { busy(true); });
  video.addEventListener('ended', function () { if (mode !== 'idle' && !list[index].live) close(); });
  video.addEventListener('error', function () { if (mode !== 'idle' && video.getAttribute('src')) fail(video.error && video.error.code); });

  var backend = android ? droid : avplay ? tizen : html5;

  // ---------- UI ----------
  function busy(on) { spinner.classList.toggle('hidden', !on); }

  function fail(err) {
    App.toast('Erro ao reproduzir' + (err ? ' (' + (err.name || err) + ')' : ''));
  }

  // Page transparent while anything plays; other screens hidden in full mode.
  function applyMode() {
    var playing = mode !== 'idle';
    document.documentElement.classList.toggle('playing', playing);
    document.body.classList.toggle('playing', playing);
    document.body.classList.toggle('fullplay', mode === 'full');
    screenEl.classList.toggle('hidden', mode !== 'full');
    if (mode !== 'full') busy(false);
    clearInterval(progressTimer);
    if (mode === 'full') progressTimer = setInterval(updateProgress, 1000);
  }

  function showOsd() {
    osd.classList.remove('faded');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.classList.add('faded'); }, 4000);
  }

  function fmt(sec) {
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function hhmm(ms) {
    var d = new Date(ms);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function updateProgress() {
    var item = list[index];
    if (!item || item.live) return;
    var p = backend.position();
    if (p.dur > 0) {
      osdProgress.style.width = (100 * p.cur / p.dur) + '%';
      osdSub.textContent = fmt(p.cur) + ' / ' + fmt(p.dur);
    }
  }

  function render(item) {
    osdTitle.textContent = (item.num ? item.num + '  ' : '') + item.title;
    osdSub.textContent = item.live ? '' : (item.subtitle || '');
    osdBar.classList.toggle('hidden', !!item.live);
    osdProgress.style.width = '0';
    if (item.live && item.streamId) {
      Api.shortEpg(item.streamId).then(function (epg) {
        if (list[index] !== item || !epg.length) return;
        osdSub.textContent = epg.slice(0, 2).map(function (e) { return hhmm(e.start) + ' ' + e.title; }).join('   •   ');
      }).catch(function () { /* no EPG */ });
    }
    showOsd();
  }

  function zap(delta) {
    if (list.length < 2) return;
    index = (index + delta + list.length) % list.length;
    render(list[index]);
    // Debounce so fast zapping doesn't burn the single allowed connection.
    clearTimeout(zapTimer);
    backend.stop();
    zapTimer = setTimeout(function () { backend.open(list[index]); }, 500);
  }

  function goFull() {
    mode = 'full';
    fromPreview = true;
    applyMode();
    backend.rect(null);
    render(list[index]);
  }

  function backToPreview() {
    mode = 'preview';
    applyMode();
    backend.rect(surfaceRect());
    if (onReturn) onReturn(index);
  }

  function close() {
    if (mode === 'idle') return;
    var cb = fromPreview ? null : onClose;
    mode = 'idle';
    clearTimeout(zapTimer);
    backend.stop();
    applyMode();
    if (cb) cb(index);
  }

  function same(a, b) { return a && b && a.url === b.url; }

  return {
    mode: function () { return mode; },
    isFull: function () { return mode === 'full'; },

    // items: [{title, url, live, streamId, num, subtitle}]
    // Plays inside `box` (the page leaves it transparent); selecting the same item again goes full screen.
    preview: function (items, startIndex, box, returned) {
      if (mode === 'preview' && same(list[index], items[startIndex])) { goFull(); return; }
      if (!box || box.offsetParent === null) { Player.full(items, startIndex, returned); return; }
      clearTimeout(zapTimer);
      list = items;
      index = startIndex;
      previewEl = box;
      onReturn = returned;
      onClose = null;
      mode = 'preview';
      applyMode();
      backend.open(list[index]);
    },

    // Straight to full screen; back closes the player and calls `closed(index)`.
    full: function (items, startIndex, closed) {
      clearTimeout(zapTimer);
      list = items;
      index = startIndex;
      onClose = closed;
      onReturn = null;
      fromPreview = false;
      mode = 'full';
      applyMode();
      render(list[index]);
      backend.open(list[index]);
    },

    close: close,

    // Native player events (Android bridge).
    onNative: function (type, value) {
      if (type === 'buffering') busy(!!value);
      else if (type === 'error') { busy(false); fail(value); }
      else if (type === 'ended' && list[index] && !list[index].live) close();
    },

    // Keys while full screen.
    key: function (k) {
      var live = list[index] && list[index].live;
      switch (k) {
        case 'back': if (fromPreview) backToPreview(); else close(); return;
        case 'stop': close(); return;
        case 'up': case 'chup': if (live) zap(-1); else showOsd(); return;
        case 'down': case 'chdown': if (live) zap(1); else showOsd(); return;
        case 'left': case 'rw': if (!live) { backend.seek(-10); updateProgress(); } showOsd(); return;
        case 'right': case 'ff': if (!live) { backend.seek(30); updateProgress(); } showOsd(); return;
        case 'enter': case 'playpause': case 'play': case 'pause':
          if (!live) backend.toggle();
          showOsd();
          return;
      }
    }
  };
})();
