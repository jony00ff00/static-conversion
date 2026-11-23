/**
 * Runs INSIDE the rendered page. Loaded as plain text and injected unchanged,
 * so it is never transpiled (transpilers add helpers that don't exist in the page).
 * Exposes window.__ve with settle / freeze / stamping / serialisation helpers.
 */
(function () {
  if (window.__ve) return;

  var HTML_NS = 'http://www.w3.org/1999/xhtml';
  var nativeTimeout = function (fn, ms) { return window.setTimeout(fn, ms); };
  var nativeRaf = function (fn) { return window.requestAnimationFrame(fn); };

  /* ------------------------------------------------------------------ settle */

  /** Pause animations: finite → end state, infinite → paused at t=0. */
  function freezeAnimations() {
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
        return new Promise(function (r) { nativeRaf.call(window, function () { nativeRaf.call(window, r); }); });
      });
  }

  /**
   * Stop the page's own timers and animation-frame loops so nothing changes
   * after the snapshot (e.g. an auto-advancing carousel).
   */
  function stopTimers() {
    if (!window.__veStopTimers) return 0;
    var r = window.__veStopTimers();
    // From here on, the page's timers are disabled; use the originals for our own waits.
    nativeTimeout = r.setTimeout;
    nativeRaf = r.requestAnimationFrame;
    return r.cancelled;
  }

  /* ----------------------------------------------------------------- stamping */

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

  /* ------------------------------------------------------------------ freeze */

  var STATIC_CSS =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' +
    '[data-ve-pseudo~="before"]::before{content:none!important}' +
    '[data-ve-pseudo~="after"]::after{content:none!important}';

  /**
   * Write each animated property's current value as an inline !important style,
   * so the frozen document keeps the end state once animations are switched off.
   */
  function bakeAnimations() {
    var baked = 0;
    document.getAnimations().forEach(function (anim) {
      var eff = anim.effect;
      if (!eff || !eff.target || eff.pseudoElement) return;
      var props = {};
      eff.getKeyframes().forEach(function (kf) {
        Object.keys(kf).forEach(function (k) {
          if (k !== 'offset' && k !== 'computedOffset' && k !== 'easing' && k !== 'composite') props[k] = 1;
        });
      });
      var cs = getComputedStyle(eff.target);
      Object.keys(props).forEach(function (p) {
        var css = p === 'cssFloat' ? 'float' : p.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
        var v = cs.getPropertyValue(css);
        if (v) { eff.target.style.setProperty(css, v, 'important'); baked++; }
      });
    });
    return baked;
  }

  /** Parse a computed `content` value. Returns null if it can't be resolved statically. */
  function parseContent(c, el) {
    var out = [], i = 0, n = c.length, m;
    while (i < n) {
      var ch = c[i];
      if (ch === ' ') { i++; continue; }
      if (ch === '"' || ch === "'") {
        var q = ch, s = '';
        i++;
        while (i < n && c[i] !== q) {
          if (c[i] === '\\') {
            i++;
            var hex = '';
            while (i < n && /[0-9a-fA-F]/.test(c[i]) && hex.length < 6) { hex += c[i]; i++; }
            if (hex) { s += String.fromCodePoint(parseInt(hex, 16)); if (c[i] === ' ') i++; }
            else if (i < n) { s += c[i]; i++; }
          } else { s += c[i]; i++; }
        }
        i++;
        out.push({ t: 'text', v: s });
        continue;
      }
      m = /^attr\(\s*([^\s)]+)\s*\)/.exec(c.slice(i));
      if (m) { out.push({ t: 'text', v: el.getAttribute(m[1]) || '' }); i += m[0].length; continue; }
      m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(c.slice(i));
      if (m) { out.push({ t: 'img', v: m[1] || m[2] || m[3] }); i += m[0].length; continue; }
      return null; // counter(), counters(), quotes, gradients...
    }
    return out;
  }

  var NO_PSEUDO = { IMG: 1, INPUT: 1, BR: 1, HR: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, TEXTAREA: 1, SELECT: 1, OBJECT: 1, EMBED: 1 };

  /**
   * Replace ::before / ::after with real elements carrying the same styles,
   * so they survive extraction. Unresolvable content (counters, quotes) is
   * left as a pseudo-element and reported.
   */
  function convertPseudos(report) {
    var els = Array.prototype.slice.call(document.querySelectorAll('body, body *'));
    els.forEach(function (el) {
      if (el.namespaceURI !== HTML_NS || NO_PSEUDO[el.tagName]) return;
      ['before', 'after'].forEach(function (which) {
        var cs = getComputedStyle(el, '::' + which);
        var content = cs.content;
        if (!content || content === 'none' || content === 'normal' || cs.display === 'none') return;
        var parts = parseContent(content, el);
        var hasImg = parts && parts.some(function (p) { return p.t === 'img'; });
        if (!parts || (hasImg && parts.length > 1)) {
          report.pseudoSkipped.push({ wpId: el.getAttribute('data-wp-id'), which: which, content: content });
          return;
        }
        var span = document.createElement('span');
        // Probe: a plain span in the same position shows what the author's own
        // rules already give a span there; only the differences are copied.
        if (which === 'before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
        var probe = getComputedStyle(span);
        var copy = [];
        for (var i = 0; i < cs.length; i++) {
          var prop = cs[i];
          if (prop === 'content') continue;
          var v = cs.getPropertyValue(prop);
          if (v !== probe.getPropertyValue(prop)) copy.push([prop, v]);
        }
        copy.forEach(function (pv) { span.style.setProperty(pv[0], pv[1]); });
        if (hasImg) {
          var img = document.createElement('img');
          img.src = parts[0].v;
          img.alt = '';
          span.appendChild(img);
        } else {
          span.textContent = parts.map(function (p) { return p.v; }).join('');
        }
        span.setAttribute('data-ve-pseudo-of', which);
        span.setAttribute('data-wp-id', (el.getAttribute('data-wp-id') || '') + '~' + which);
        var marks = (el.getAttribute('data-ve-pseudo') || '').split(' ').filter(Boolean);
        marks.push(which);
        el.setAttribute('data-ve-pseudo', marks.join(' '));
        report.pseudoConverted++;
      });
    });
  }

  var DROP_ATTRS = {
    src: 1, srcset: 1, width: 1, height: 1, poster: 1, srcdoc: 1, controls: 1, autoplay: 1, loop: 1,
    muted: 1, preload: 1, sandbox: 1, allow: 1, loading: 1, frameborder: 1, allowfullscreen: 1,
    referrerpolicy: 1, playsinline: 1, scrolling: 1, name: 1,
  };

  function copyAttrs(from, to) {
    Array.prototype.forEach.call(from.attributes, function (a) {
      if (!DROP_ATTRS[a.name]) to.setAttribute(a.name, a.value);
    });
  }

  /**
   * Layout and decoration properties copied from the original element, so the
   * replacement keeps its place even when the author's CSS targeted the tag
   * (e.g. `video { display: block }` no longer matches an <img>).
   */
  var LAYOUT_PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'vertical-align',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'justify-self', 'order',
    'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end',
    'opacity', 'transform', 'transform-origin', 'filter', 'box-shadow', 'visibility',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  ];
  var BOX_PROPS = [
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'background-color',
  ];

  function copyComputed(from, to, props) {
    var cs = getComputedStyle(from);
    props.forEach(function (p) { to.style.setProperty(p, cs.getPropertyValue(p)); });
  }

  function important(el, styles) {
    Object.keys(styles).forEach(function (k) { el.style.setProperty(k, styles[k], 'important'); });
  }

  function contentBox(el) {
    var cs = getComputedStyle(el);
    return { w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0, fit: cs.objectFit, pos: cs.objectPosition };
  }

  /** Replace an element with an <img> showing `src` in its content box. */
  function replaceContentWithImg(el, src, kind) {
    var box = contentBox(el);
    var img = document.createElement('img');
    copyAttrs(el, img);
    img.alt = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    img.setAttribute('data-ve-frozen', kind);
    img.src = src;
    copyComputed(el, img, LAYOUT_PROPS.concat(BOX_PROPS));
    important(img, { width: box.w + 'px', height: box.h + 'px', 'box-sizing': 'content-box' });
    if (kind === 'video') important(img, { 'object-fit': box.fit || 'contain', 'object-position': box.pos || '50% 50%' });
    el.replaceWith(img);
    return img;
  }

  function seek(v, t) {
    return new Promise(function (resolve) {
      if (Math.abs(v.currentTime - t) < 0.001) return resolve();
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      v.addEventListener('seeked', finish, { once: true });
      nativeTimeout.call(window, finish, 2000);
      v.currentTime = t;
    });
  }

  var rasterSeq = 0;
  function markRaster(el, kind, reason, jobs) {
    var id = String(++rasterSeq);
    el.setAttribute('data-ve-raster', id);
    var r = el.getBoundingClientRect();
    jobs.push({
      id: id, kind: kind, reason: reason, wpId: el.getAttribute('data-wp-id'),
      src: el.getAttribute('src') ? el.src : null, width: r.width, height: r.height,
    });
  }

  /**
   * Freeze everything JS produced into static content. Elements that can't be
   * captured in the page are marked for an element screenshot and returned as
   * raster jobs; the Node side screenshots them and calls applyRaster.
   */
  function prepareFreeze(opts) {
    var report = { canvases: [], videos: [], pseudoConverted: 0, pseudoSkipped: [], bakedProps: 0, rasterJobs: [] };
    var jobs = report.rasterJobs;

    // 1. Pseudo-elements (before animations are switched off, so styles are final).
    convertPseudos(report);
    // 2. Keep animation end states once animations are disabled.
    report.bakedProps = bakeAnimations();

    // 3. Canvas and WebGL.
    Array.prototype.slice.call(document.querySelectorAll('canvas')).forEach(function (c) {
      var box = contentBox(c);
      if (!box.w || !box.h) return;
      var info = {
        wpId: c.getAttribute('data-wp-id'), webgl: /webgl/i.test(c.__veContextType || ''),
        cssWidth: box.w, cssHeight: box.h, pixelWidth: c.width, pixelHeight: c.height, method: 'toDataURL',
      };
      try {
        replaceContentWithImg(c, c.toDataURL('image/png'), 'canvas');
      } catch (e) {
        info.method = 'screenshot';
        markRaster(c, 'canvas', 'tainted', jobs);
      }
      report.canvases.push(info);
    });

    // 4. Video: poster, or the frame at opts.videoTimeSec.
    var videoWork = Array.prototype.slice.call(document.querySelectorAll('video')).map(function (v) {
      var info = { wpId: v.getAttribute('data-wp-id'), method: '' };
      report.videos.push(info);
      if (v.poster) {
        info.method = 'poster';
        replaceContentWithImg(v, v.poster, 'video');
        return Promise.resolve();
      }
      if (v.readyState < 2) {
        info.method = 'screenshot';
        markRaster(v, 'video', 'not-loaded', jobs);
        return Promise.resolve();
      }
      v.pause();
      return seek(v, opts.videoTimeSec || 0).then(function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = v.videoWidth;
          cv.height = v.videoHeight;
          cv.getContext('2d').drawImage(v, 0, 0);
          info.method = 'frame';
          info.timeSec = v.currentTime;
          replaceContentWithImg(v, cv.toDataURL('image/png'), 'video');
        } catch (e) {
          info.method = 'screenshot';
          markRaster(v, 'video', 'tainted', jobs);
        }
      });
    });

    // 5. Images that failed to load (e.g. blocked by the sandbox) would print as
    //    a broken-image icon; they become labelled placeholders on the Node side.
    Array.prototype.slice.call(document.images).forEach(function (img) {
      if (!img.complete || img.naturalWidth > 0 || /^data:/.test(img.currentSrc || img.src)) return;
      if (img.getAttribute('data-ve-frozen')) return;
      var r = img.getBoundingClientRect();
      if (!r.width || !r.height) return;
      markRaster(img, 'img', 'failed', jobs);
    });

    // 6. Iframes: always rasterised (content may be cross-origin).
    Array.prototype.slice.call(document.querySelectorAll('iframe')).forEach(function (f) {
      var r = f.getBoundingClientRect();
      if (!r.width || !r.height) return;
      markRaster(f, 'iframe', 'embedded', jobs);
    });

    return Promise.all(videoWork).then(function () { return report; });
  }

  /** Replace a marked element with an image of its border box. */
  function applyRaster(id, dataUrl) {
    var el = document.querySelector('[data-ve-raster="' + id + '"]');
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var img = document.createElement('img');
    copyAttrs(el, img);
    img.removeAttribute('data-ve-raster');
    img.setAttribute('data-ve-frozen', 'raster-' + el.tagName.toLowerCase());
    img.alt = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    img.src = dataUrl;
    copyComputed(el, img, LAYOUT_PROPS);
    important(img, {
      width: r.width + 'px', height: r.height + 'px', 'box-sizing': 'border-box',
      border: '0', padding: '0', 'object-fit': 'fill',
    });
    el.replaceWith(img);
    return true;
  }

  /** Replace a marked element with a neutral placeholder box (e.g. blocked embed). */
  function applyPlaceholder(id, label) {
    var el = document.querySelector('[data-ve-raster="' + id + '"]');
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var div = document.createElement('div');
    copyAttrs(el, div);
    div.removeAttribute('data-ve-raster');
    div.setAttribute('data-ve-frozen', 'placeholder');
    div.setAttribute('role', 'img');
    div.setAttribute('aria-label', label);
    div.textContent = label;
    var origDisplay = getComputedStyle(el).display;
    copyComputed(el, div, LAYOUT_PROPS);
    important(div, {
      width: r.width + 'px', height: r.height + 'px', 'box-sizing': 'border-box',
      display: origDisplay === 'block' ? 'flex' : 'inline-flex',
      'align-items': 'center', 'justify-content': 'center', 'text-align': 'center',
      padding: '8px', border: '1px dashed #9ca3af', background: '#f3f4f6', color: '#4b5563',
      font: '12px/1.3 sans-serif', 'vertical-align': 'top',
    });
    el.replaceWith(div);
    return true;
  }

  /** Add the stylesheet that keeps the frozen document static. */
  function addStaticStyle() {
    if (document.querySelector('style[data-ve-static]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-ve-static', '');
    style.textContent = STATIC_CSS;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------- fonts */

  var GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

  function unquote(s) { return s.trim().replace(/^["']|["']$/g, ''); }

  /**
   * Font facts for every stamped element, in document order (matching CDP's
   * DOM.querySelectorAll('[data-wp-id]') order), plus loaded/failed web fonts.
   */
  function fontFacts() {
    var nodes = Array.prototype.map.call(document.querySelectorAll('[data-wp-id]'), function (el) {
      var hasText = false;
      el.childNodes.forEach(function (n) { if (n.nodeType === 3 && n.textContent.trim()) hasText = true; });
      if (!hasText) return null;
      var cs = getComputedStyle(el);
      return { wpId: el.getAttribute('data-wp-id'), family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle };
    });
    var loaded = {}, failed = {};
    document.fonts.forEach(function (f) {
      var fam = unquote(f.family);
      if (f.status === 'loaded') loaded[fam.toLowerCase()] = fam;
      if (f.status === 'error') failed[fam.toLowerCase()] = fam;
    });
    var files = performance.getEntriesByType('resource')
      .map(function (e) { return e.name; })
      .filter(function (u) { return /\.(woff2?|ttf|otf)(\?|#|$)/i.test(u); });
    return {
      nodes: nodes,
      loadedFaces: Object.keys(loaded).map(function (k) { return loaded[k]; }),
      failedFaces: Object.keys(failed).filter(function (k) { return !loaded[k]; }).map(function (k) { return failed[k]; }),
      fontFiles: files,
      genericPattern: GENERIC.source,
    };
  }

  /* -------------------------------------------------------------- measuring */

  /** Height of the whole document and the smallest visible text size (CSS px). */
  function measure() {
    var de = document.documentElement, body = document.body;
    var height = Math.max(de.scrollHeight, body ? body.scrollHeight : 0, de.getBoundingClientRect().height);
    var smallest = Infinity, smallestWpId = null;
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
      if (el.getAttribute('data-ve-frozen') === 'placeholder') return;
      var hasText = false;
      el.childNodes.forEach(function (n) { if (n.nodeType === 3 && n.textContent.trim()) hasText = true; });
      if (!hasText) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') return;
      var size = parseFloat(cs.fontSize);
      if (size < smallest) { smallest = size; smallestWpId = el.getAttribute('data-wp-id'); }
    });
    return {
      width: de.scrollWidth, height: Math.ceil(height),
      smallestFontPx: isFinite(smallest) ? smallest : null, smallestFontWpId: smallestWpId,
    };
  }

  /* -------------------------------------------------------------- serialise */

  var KEEP_SCRIPT_TYPES = /^(application\/(ld\+)?json|text\/template|text\/x-template)$/i;

  /**
   * Serialise the frozen DOM as a static document: scripts, noscript, inline
   * event handlers and javascript: URLs removed (they must not run, or show, again).
   */
  function serializeDom() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script').forEach(function (s) {
      if (!KEEP_SCRIPT_TYPES.test(s.type || '')) s.remove();
    });
    clone.querySelectorAll('noscript').forEach(function (s) { s.remove(); });
    clone.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if ((a.name === 'href' || a.name === 'src' || a.name === 'action') && /^\s*javascript:/i.test(a.value)) {
          el.setAttribute(a.name, '#');
        }
      });
    });
    var dt = document.doctype;
    return (dt ? '<!DOCTYPE ' + dt.name + '>' : '') + '\n' + clone.outerHTML + '\n';
  }

  Object.defineProperty(window, '__ve', {
    value: Object.freeze({
      freezeAnimations: freezeAnimations,
      waitForAssets: waitForAssets,
      stopTimers: stopTimers,
      stampWpIds: stampWpIds,
      countUnstamped: countUnstamped,
      prepareFreeze: prepareFreeze,
      applyRaster: applyRaster,
      applyPlaceholder: applyPlaceholder,
      addStaticStyle: addStaticStyle,
      fontFacts: fontFacts,
      measure: measure,
      serializeDom: serializeDom,
    }),
    enumerable: false,
  });
})();
