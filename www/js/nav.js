// Spatial D-pad navigation over `.focusable` elements inside the active screen.
var Nav = (function () {
  var root = document.body;
  var lastInGroup = {};

  function visible(el) {
    return el.offsetParent !== null && !el.disabled;
  }

  function groupOf(el) {
    var g = el.closest('[data-group]');
    return g ? g.getAttribute('data-group') : null;
  }

  function focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var g = groupOf(el);
    if (g) lastInGroup[g] = el;
    if (Nav.onFocus) Nav.onFocus(el);
  }

  function rect(el) {
    var r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  }

  function score(a, b, dir) {
    var primary, secondary, overlap;
    var tol = 4;
    if (dir === 'right' || dir === 'left') {
      primary = dir === 'right' ? b.l - a.r : a.l - b.r;
      if (primary < -tol) return Infinity;
      secondary = Math.abs(b.cy - a.cy);
      overlap = b.t < a.b && b.b > a.t;
    } else {
      primary = dir === 'down' ? b.t - a.b : a.t - b.b;
      if (primary < -tol) return Infinity;
      secondary = Math.abs(b.cx - a.cx);
      overlap = b.l < a.r && b.r > a.l;
    }
    return Math.max(primary, 0) + secondary * (overlap ? 0.3 : 3);
  }

  function move(dir) {
    var cur = document.activeElement;
    var all = Array.prototype.filter.call(root.querySelectorAll('.focusable'), visible);
    if (!all.length) return false;
    if (!cur || !root.contains(cur) || !cur.classList.contains('focusable')) {
      focus(all[0]);
      return true;
    }
    var a = rect(cur);
    var best = null, bestScore = Infinity;
    all.forEach(function (el) {
      if (el === cur) return;
      var s = score(a, rect(el), dir);
      if (s < bestScore) { bestScore = s; best = el; }
    });
    if (!best) return false;

    // Entering another group: return to its remembered / selected element.
    var g = groupOf(best);
    if (g && g !== groupOf(cur)) {
      var remembered = lastInGroup[g];
      var container = root.querySelector('[data-group="' + g + '"]');
      if (!remembered || !container.contains(remembered) || !visible(remembered)) {
        remembered = container.querySelector('.focusable.selected');
      }
      if (remembered && visible(remembered)) best = remembered;
    }
    focus(best);
    return true;
  }

  return {
    onFocus: null,
    focus: focus,
    move: move,
    setRoot: function (el, initial) {
      root = el;
      focus(initial || el.querySelector('.focusable.selected') || Array.prototype.find.call(el.querySelectorAll('.focusable'), visible));
    },
    forget: function (group) { delete lastInGroup[group]; }
  };
})();
