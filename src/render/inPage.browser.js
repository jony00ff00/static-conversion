/**
 * Runs INSIDE the rendered page. Loaded as plain text and injected unchanged,
 * so it is never transpiled (transpilers add helpers that don't exist in the page).
 * Exposes window.__ve with settle / stamping / serialisation helpers.
 */
(function () {
  if (window.__ve) return;

  /** Freeze animations: finite → end state, infinite → paused at t=0. */
  function freezeAnimations() {
    var style = document.createElement('style');
    style.setAttribute('data-ve-freeze', '');
    style.textContent =
      '*,*::before,*::after{transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    document.head.appendChild(style);
    document.getAnimations().forEach(function (anim) {
      var timing = anim.effect && anim.effect.getComputedTiming();
      if (timing && isFinite(timing.endTime)) {
        try { anim.finish(); } catch (e) { anim.pause(); }
      } else {
        anim.pause();
        anim.currentTime = 0;
      }
    });
  }

  /** Wait for fonts and every <img>, then two animation frames. */
  function waitForAssets() {
    return document.fonts.ready
      .then(function () {
        return Promise.all(Array.prototype.map.call(document.images, function (img) {
          if (img.complete) return img.decode().catch(function () {});
          return new Promise(function (r) {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
          });
        }));
      })
      .then(function () {
        return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      });
  }

  function fnv1a(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function segment(el) {
    var n = 1, sib = el.previousElementSibling;
    while (sib) { if (sib.tagName === el.tagName) n++; sib = sib.previousElementSibling; }
    return el.tagName.toLowerCase() + ':' + n;
  }

  function ownText(el) {
    var t = '';
    el.childNodes.forEach(function (node) { if (node.nodeType === 3) t += node.textContent || ''; });
    return t.replace(/\s+/g, ' ').trim().slice(0, 32);
  }

  /**
   * Stamp every element with a stable data-wp-id:
   * FNV-1a(structural path + first 32 chars of own text), base36.
   */
  function stampWpIds() {
    var seen = {}, count = 0;
    (function walk(el, path) {
      var p = path + '/' + segment(el);
      var id = fnv1a(p + '|' + ownText(el));
      var dup = seen[id] || 0;
      seen[id] = dup + 1;
      if (dup) id = id + '-' + dup;
      el.setAttribute('data-wp-id', id);
      count++;
      Array.prototype.forEach.call(el.children, function (c) { walk(c, p); });
    })(document.documentElement, '');
    return count;
  }

  function countUnstamped() {
    return Array.prototype.filter.call(document.querySelectorAll('*'), function (e) {
      return !e.hasAttribute('data-wp-id');
    }).length;
  }

  /** Serialise the settled DOM, minus the editor's own freeze stylesheet. */
  function serializeDom() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('style[data-ve-freeze]').forEach(function (s) { s.remove(); });
    var dt = document.doctype;
    return (dt ? '<!DOCTYPE ' + dt.name + '>' : '') + '\n' + clone.outerHTML + '\n';
  }

  Object.defineProperty(window, '__ve', {
    value: Object.freeze({
      freezeAnimations: freezeAnimations,
      waitForAssets: waitForAssets,
      stampWpIds: stampWpIds,
      countUnstamped: countUnstamped,
      serializeDom: serializeDom,
    }),
    enumerable: false,
  });
})();
