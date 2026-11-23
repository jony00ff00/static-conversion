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

  /* ----------------------------------------------------------------- presets */

  /** Print presets, applied after settling and before IDs are stamped. */
  function applyPresets(p) {
    var report = { hidden: 0, expanded: 0, links: 0 };
    if (p.hideChrome) {
      Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
        var cs = getComputedStyle(el);
        var cookie = /(cookie|consent|gdpr)/i.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || ''));
        if (cs.position === 'fixed' || cs.position === 'sticky' || (cookie && (el.getAttribute('role') === 'dialog' || cs.position !== 'static'))) {
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-ve-preset', 'hidden');
          report.hidden++;
        }
      });
    }
    if (p.expandInteractive) {
      document.querySelectorAll('details:not([open])').forEach(function (d) { d.open = true; report.expanded++; });
      document.querySelectorAll('[role=tabpanel][hidden], [role=tabpanel][aria-hidden=true]').forEach(function (t) {
        t.hidden = false; t.removeAttribute('aria-hidden'); report.expanded++;
      });
      document.querySelectorAll('[aria-expanded=false][aria-controls]').forEach(function (b) {
        var t = document.getElementById(b.getAttribute('aria-controls'));
        if (t && t.getAttribute('role') !== 'tabpanel') { b.setAttribute('aria-expanded', 'true'); t.hidden = false; report.expanded++; }
      });
      document.querySelectorAll('[aria-roledescription=carousel], .carousel').forEach(function (c) {
        c.style.setProperty('height', 'auto', 'important');
        c.style.setProperty('overflow', 'visible', 'important');
        Array.prototype.forEach.call(c.children, function (slide) {
          slide.hidden = false;
          slide.style.setProperty('position', 'relative', 'important');
          slide.style.setProperty('inset', 'auto', 'important');
          slide.style.setProperty('min-height', '160px');
          report.expanded++;
        });
      });
    }
    if (p.linkUrls) {
      document.querySelectorAll('a[href]').forEach(function (a) {
        var href = a.getAttribute('href');
        if (!/^https?:/i.test(href) || a.querySelector('[data-ve-link-url]')) return;
        var s = document.createElement('span');
        s.setAttribute('data-ve-link-url', '');
        s.textContent = ' (' + href.replace(/^https?:\/\//, '') + ')';
        a.appendChild(s);
        report.links++;
      });
    }
    return report;
  }

  /**
   * Make the author's @media print rules part of the static document: every
   * stylesheet is re-emitted with print rules unwrapped and screen-only rules
   * dropped, so the frozen page shows the print styling on screen and in export.
   */
  function bakePrintMedia() {
    var out = [];
    var isPrint = function (m) { return /\bprint\b/i.test(m) && !/not\s+print/i.test(m); };
    var isScreenOnly = function (m) { return /\bscreen\b/i.test(m) && !/\bprint\b/i.test(m); };
    var absolutise = function (css, base) {
      return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (all, q, u) {
        if (/^(data:|blob:|#)/.test(u)) return all;
        try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return all; }
      });
    };
    var walk = function (rules, base) {
      Array.prototype.forEach.call(rules, function (r) {
        if (r.type === CSSRule.MEDIA_RULE) {
          var m = r.media.mediaText;
          if (isPrint(m)) walk(r.cssRules, base);
          else if (!isScreenOnly(m)) out.push(absolutise(r.cssText, base));
        } else if (r.type === CSSRule.IMPORT_RULE) {
          if (r.styleSheet) walk(r.styleSheet.cssRules, r.styleSheet.href || base);
        } else {
          out.push(absolutise(r.cssText, base));
        }
      });
    };
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var owner = sheet.ownerNode;
      if (owner && owner.hasAttribute && owner.hasAttribute('data-ve-static')) return;
      var m = sheet.media && sheet.media.mediaText;
      if (m && isScreenOnly(m)) return;
      try { walk(sheet.cssRules, sheet.href || document.baseURI); } catch (e) { return; }
    });
    document.querySelectorAll('link[rel~=stylesheet], style:not([data-ve-static])').forEach(function (n) { n.remove(); });
    var style = document.createElement('style');
    style.setAttribute('data-ve-print-baked', '');
    style.textContent = out.join('\n');
    document.head.appendChild(style);
    return out.length;
  }

  /* -------------------------------------------------------------- decompose */

  var SEMANTIC = { HEADER: 'header', NAV: 'nav', FOOTER: 'footer', SECTION: 'section', ARTICLE: 'card', ASIDE: 'section', FIGURE: 'media', TABLE: 'table', FORM: 'section', BLOCKQUOTE: 'text', MAIN: 'section', DETAILS: 'group' };
  var MEDIA = { IMG: 1, SVG: 1, VIDEO: 1, PICTURE: 1, CANVAS: 1, IFRAME: 1 };
  var TEXT = { H1: 'text', H2: 'text', H3: 'text', H4: 'text', H5: 'text', H6: 'text', P: 'text', PRE: 'text', UL: 'list', OL: 'list', DL: 'list' };
  var INLINE = { SPAN: 1, A: 1, STRONG: 1, EM: 1, B: 1, I: 1, LABEL: 1, SMALL: 1, CODE: 1, BR: 1, SUP: 1, SUB: 1, U: 1, S: 1, ABBR: 1, TIME: 1, MARK: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1, BASE: 1, HEAD: 1, OPTION: 1, SOURCE: 1, TRACK: 1, PATH: 1, G: 1 };

  function opaque(c) { return c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c); }

  function effectiveBg(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (opaque(c)) return c;
    }
    return 'rgb(255, 255, 255)';
  }

  function visibleBox(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function signature(el) {
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).sort().join('.') : '';
    var kids = Array.prototype.map.call(el.children, function (c) { return c.tagName; }).join(',');
    return el.tagName + '.' + cls + '>' + kids;
  }

  /** Bottom of the lowest visible element (plus body padding/margin), CSS px. */
  function contentHeight() {
    var body = document.body, bottom = 0;
    Array.prototype.forEach.call(body.querySelectorAll('*'), function (e) {
      var r = e.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && r.bottom + scrollY > bottom) bottom = r.bottom + scrollY;
    });
    var cs = getComputedStyle(body);
    bottom += parseFloat(cs.paddingBottom) + parseFloat(cs.marginBottom);
    var br = body.getBoundingClientRect();
    return Math.ceil(Math.max(bottom, br.bottom + scrollY + parseFloat(cs.marginBottom)));
  }

  function ownTextLen(el) {
    var n = 0;
    el.childNodes.forEach(function (k) { if (k.nodeType === 3) n += k.textContent.trim().length; });
    return n;
  }
  function hasBlockKids(el) {
    return Array.prototype.some.call(el.children, function (k) {
      var d = getComputedStyle(k).display;
      return d !== 'inline' && d !== 'none' && d !== 'contents';
    });
  }

  function headingText(el) {
    var h = /^H[1-6]$/.test(el.tagName) ? el : el.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
    var t = h ? (h.innerText || h.textContent) : '';
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  function minFont(el) {
    var min = Infinity;
    var all = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    all.forEach(function (e) {
      var has = false;
      e.childNodes.forEach(function (n) { if (n.nodeType === 3 && n.textContent.trim()) has = true; });
      if (!has || !visibleBox(e)) return;
      var f = parseFloat(getComputedStyle(e).fontSize);
      if (f < min) min = f;
    });
    return isFinite(min) ? min : null;
  }

  function nameOf(el, kind) {
    var t = headingText(el);
    if (!t) t = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '';
    if (!t && el.getAttribute('data-ve-frozen') === 'canvas') t = 'Chart';
    if (!t) {
      // Join the text of leaf elements with spaces, so "Work About Contact"
      // doesn't run together when the links have no whitespace between them.
      var parts = [];
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (var n = tw.nextNode(); n && parts.length < 12; n = tw.nextNode()) {
        var v = n.textContent.replace(/\s+/g, ' ').trim();
        if (v && n.parentElement && visibleBox(n.parentElement)) parts.push(v);
      }
      t = parts.join(' ');
    }
    if (!t) t = kind === 'media' ? 'Image' : el.tagName.toLowerCase();
    return t.length > 48 ? t.slice(0, 45).trim() + '…' : t;
  }

  /**
   * Score every element as a possible component boundary. Elements scoring 2+
   * become candidate components; nesting gives each a depth (1 = top level).
   * `rules`: [{selector, action: 'component' | 'ignore'}] applied first.
   */
  function decompose(rules) {
    var body = document.body;
    var docW = Math.max(document.documentElement.scrollWidth, 1);
    var pageArea = docW * Math.min(Math.max(document.documentElement.scrollHeight, 1), 1200);
    var forced = new Set(), ignored = new Set();
    (rules || []).forEach(function (r) {
      try {
        document.querySelectorAll(r.selector).forEach(function (e) { (r.action === 'ignore' ? ignored : forced).add(e); });
      } catch (e) { /* bad selector: skip */ }
    });

    var info = new Map();
    var walk = function (el, insideMedia) {
      Array.prototype.forEach.call(el.children, function (c) {
        var tag = c.tagName.toUpperCase();
        if (SKIP[tag]) return;
        var box = visibleBox(c);
        if (!box) { if (getComputedStyle(c).display === 'contents') walk(c, insideMedia); return; }
        var isMedia = !!MEDIA[tag] || c.getAttribute('data-ve-frozen') === 'canvas' || c.getAttribute('data-ve-frozen') === 'video';
        var s = 0, kind = null, hinted = false;
        if (!insideMedia) {
          var cs = getComputedStyle(c);
          if (SEMANTIC[tag]) { s += tag === 'MAIN' ? 1 : 3; kind = SEMANTIC[tag]; }
          if (c.hasAttribute('data-component') || tag.indexOf('-') > 0) s += 3;
          // Author hints: common component names in class/id, and landmark/widget roles.
          var hint = ((typeof c.className === 'string' ? c.className : '') + ' ' + (c.id || '')).toLowerCase();
          if (/(^|[\s_-])(tabs|accordion|carousel|slider|hero|card|panel|alert|gallery|pricing|testimonial|faq|banner|callout)([\s_-]|$)/.test(hint) && box.w * box.h >= pageArea * 0.005) { s += 3; hinted = true; kind = kind || (/card|panel|pricing|testimonial/.test(hint) ? 'card' : 'group'); }
          var role = c.getAttribute('role');
          if (role === 'tablist' || role === 'region' || role === 'tabpanel' || c.getAttribute('aria-roledescription') === 'carousel') { s += 2; hinted = true; }
          var parentBg = c.parentElement ? effectiveBg(c.parentElement) : 'rgb(255, 255, 255)';
          var ownBg = cs.backgroundColor;
          var boxed = (opaque(ownBg) && ownBg !== parentBg) || cs.backgroundImage !== 'none' ||
            ['Top', 'Right', 'Bottom', 'Left'].some(function (sd) { return parseFloat(cs['border' + sd + 'Width']) > 0 && cs['border' + sd + 'Style'] !== 'none'; }) ||
            cs.boxShadow !== 'none';
          if (boxed) s += 2;
          if (isMedia) { s += 3; kind = 'media'; }
          if (TEXT[tag]) { s += 2; kind = kind || TEXT[tag]; }
          else if (!kind && !isMedia && ownTextLen(c) >= 3 && !hasBlockKids(c)) { s += 2; kind = 'text'; }
          if ((cs.display === 'grid' || cs.display === 'flex') && c.children.length >= 2) s += 1;
          if (box.w >= docW * 0.9 && box.h >= 150 && tag !== 'MAIN') s += 1;
          if (INLINE[tag] && !isMedia) s = 0;
          if (!isMedia && kind !== 'text' && kind !== 'list' && box.w * box.h < pageArea * 0.005) s -= 2;
          if (isMedia && (box.w < 24 || box.h < 24)) s = 0;
          if (forced.has(c)) s = Math.max(s, 5);
          if (ignored.has(c)) s = -99;
          info.set(c, { el: c, s: s, kind: kind, box: box, boxed: boxed, media: isMedia, hinted: hinted });
        }
        // Tables are one unit: their rows and cells are never components.
        if (!isMedia && tag !== 'TABLE') walk(c, insideMedia);
      });
    };
    walk(body, false);

    // Repeated siblings (cards in a row): same structure, 2+ of them.
    var groups = new Map();
    info.forEach(function (v) {
      // Climb through single-child wrappers (e.g. Bootstrap .col around a .card),
      // so cards in separate wrappers still count as a repeated set.
      var up = v.el, chain = '';
      while (up.parentElement && up.parentElement !== body && up.parentElement.children.length === 1) {
        up = up.parentElement;
        chain += '<' + signature(up).split('>')[0];
      }
      var parent = up.parentElement;
      var key = (parent ? parent.getAttribute('data-wp-id') : '') + '|' + signature(v.el) + chain;
      v.sig = key;
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    info.forEach(function (v) {
      v.repeat = groups.get(v.sig) >= 2 && v.el.children.length > 0 ? v.sig : null;
      if (v.repeat && v.s > 0) v.s += 2;
    });

    // Wrappers: an element whose only visible child covers the same box keeps
    // just one of the two (the higher score; the outer one on a tie).
    info.forEach(function (v) {
      var kids = Array.prototype.filter.call(v.el.children, function (k) { return info.has(k); });
      if (kids.length !== 1) return;
      var k = info.get(kids[0]);
      var same = Math.abs(k.box.x - v.box.x) < 3 && Math.abs(k.box.y - v.box.y) < 3 && Math.abs(k.box.w - v.box.w) < 3 && Math.abs(k.box.h - v.box.h) < 3;
      if (!same) return;
      if (k.s > v.s) v.s = Math.min(v.s, 1); else k.s = Math.min(k.s, 1);
    });

    var nodes = [];
    var cand = new Map();
    info.forEach(function (v) { if (v.s >= 2) cand.set(v.el, v); });
    // Pure wrappers (no box of their own, mostly filled by 2+ candidate
    // children) are not components themselves: their children are.
    cand.forEach(function (v) {
      if (forced.has(v.el) || v.boxed || v.media || v.hinted || !/^(DIV|MAIN|SECTION)$/.test(v.el.tagName)) return;
      var kids = [];
      cand.forEach(function (k) {
        if (k === v) return;
        for (var a = k.el.parentElement; a; a = a.parentElement) {
          if (a === v.el) { kids.push(k); break; }
          if (cand.has(a)) break;
        }
      });
      if (kids.length < 2) return;
      var covered = kids.reduce(function (sum, k) { return sum + k.box.w * k.box.h; }, 0);
      if (covered >= 0.85 * v.box.w * v.box.h) cand.delete(v.el);
    });
    cand.forEach(function (v) {
      var parent = null, depth = 1;
      for (var a = v.el.parentElement; a && a !== body; a = a.parentElement) {
        if (cand.has(a)) { if (!parent) parent = a; depth++; }
      }
      var kind = v.kind;
      if (!kind || kind === 'section') {
        if (v.repeat || (v.boxed && headingText(v.el) && v.box.w < docW * 0.7)) kind = 'card';
        else if (!kind) kind = v.box.w >= docW * 0.9 ? 'section' : 'group';
      }
      if (v.el.tagName === 'TABLE') kind = 'table';
      nodes.push({
        wpId: v.el.getAttribute('data-wp-id'),
        parentWpId: parent ? parent.getAttribute('data-wp-id') : null,
        depth: depth,
        tag: v.el.tagName.toLowerCase(),
        kind: kind,
        name: nameOf(v.el, kind),
        score: v.s,
        bbox: v.box,
        bg: effectiveBg(v.el),
        repeatKey: v.repeat,
        minFontPx: minFont(v.el),
        atomic: v.media,
      });
    });
    nodes.sort(function (a, b) { return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x || a.depth - b.depth; });
    return {
      nodes: nodes,
      pageBg: effectiveBg(body),
      bodyWpId: body.getAttribute('data-wp-id'),
      documentHeightPx: contentHeight(),
    };
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
      applyPresets: applyPresets,
      bakePrintMedia: bakePrintMedia,
      decompose: decompose,
    }),
    enumerable: false,
  });
})();
