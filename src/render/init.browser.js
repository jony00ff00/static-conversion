/*
 * Init script, runs before any page code. Injected as plain text (never transpiled).
 * The seed placeholder below is replaced before injection.
 */
(function () {
  // Deterministic Math.random (mulberry32).
  var a = __SEED__ >>> 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Track the page's timers and animation-frame callbacks so they can be
  // cancelled after settling (window.__veStopTimers), without guessing IDs.
  var timeouts = new Set(), intervals = new Set(), frames = new Set();
  var _st = window.setTimeout, _ct = window.clearTimeout, _si = window.setInterval, _ci = window.clearInterval;
  var _raf = window.requestAnimationFrame, _caf = window.cancelAnimationFrame;
  var stopped = false;
  window.setTimeout = function (fn) {
    if (stopped) return 0;
    var args = Array.prototype.slice.call(arguments);
    if (typeof fn === 'function') {
      args[0] = function () { timeouts.delete(id); return fn.apply(this, arguments); };
    }
    var id = _st.apply(window, args);
    timeouts.add(id);
    return id;
  };
  window.clearTimeout = function (id) { timeouts.delete(id); return _ct.call(window, id); };
  window.setInterval = function () {
    if (stopped) return 0;
    var id = _si.apply(window, arguments);
    intervals.add(id);
    return id;
  };
  window.clearInterval = function (id) { intervals.delete(id); return _ci.call(window, id); };
  window.requestAnimationFrame = function (cb) {
    if (stopped) return 0;
    var id = _raf.call(window, function (t) { frames.delete(id); cb(t); });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = function (id) { frames.delete(id); return _caf.call(window, id); };
  Object.defineProperty(window, '__veStopTimers', {
    value: function () {
      stopped = true;
      timeouts.forEach(function (id) { _ct.call(window, id); });
      intervals.forEach(function (id) { _ci.call(window, id); });
      frames.forEach(function (id) { _caf.call(window, id); });
      var n = timeouts.size + intervals.size + frames.size;
      timeouts.clear(); intervals.clear(); frames.clear();
      // The editor's own helpers still need timers and frames after this.
      return { cancelled: n, setTimeout: _st, requestAnimationFrame: _raf };
    },
  });

  // WebGL canvases discard their pixels after each frame unless
  // preserveDrawingBuffer is set, which makes toDataURL() return a blank image.
  var origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === 'string' && /webgl/i.test(type)) {
      attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
    }
    var ctx = origGetContext.call(this, type, attrs);
    if (ctx) {
      try { Object.defineProperty(this, '__veContextType', { value: type, configurable: true }); } catch (e) {}
    }
    return ctx;
  };
})();
