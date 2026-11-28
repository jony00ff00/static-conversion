"use strict";(()=>{var v="static-conversion",w=["projects","files"],l=null;function h(){return l??=new Promise((e,n)=>{let t=indexedDB.open(v,1);t.onupgradeneeded=()=>w.forEach(o=>t.result.objectStoreNames.contains(o)||t.result.createObjectStore(o)),t.onsuccess=()=>e(t.result),t.onerror=()=>n(t.error)}),l}var y=e=>new Promise((n,t)=>{e.onsuccess=()=>n(e.result),e.onerror=()=>t(e.error)});async function d(e,n){return y((await h()).transaction(e).objectStore(e).get(n))}var b=String.raw`(function () {
  function sel(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      var tag = el.tagName.toLowerCase();
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); break; }
      var n = 1, s = el.previousElementSibling;
      while (s) { if (s.tagName === el.tagName) n++; s = s.previousElementSibling; }
      parts.unshift(tag + ':nth-of-type(' + n + ')');
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function post(step) { parent.postMessage({ type: 've-step', step: step }, '*'); }
  function isToggle(el) { return !!el && el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type); }
  function toggleFor(t) {
    if (!t || !t.closest) return null;
    if (isToggle(t)) return t;
    var label = t.closest('label');
    return label && isToggle(label.control) ? label.control : null;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || toggleFor(t)) return;
    if (t.tagName === 'SELECT' || t.tagName === 'OPTION') return;
    post({ action: 'click', selector: sel(t) });
  }, true);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (isToggle(t)) post({ action: 'check', selector: sel(t), checked: !!t.checked });
    else if (t && t.tagName === 'SELECT') post({ action: 'select', selector: sel(t), value: String(t.value) });
  }, true);
  var pending = {};
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    var page = t === document || t === document.documentElement || t === document.body || t === window;
    var key = page ? '' : sel(t);
    clearTimeout(pending[key]);
    pending[key] = setTimeout(function () {
      delete pending[key];
      post(page
        ? { action: 'scroll', selector: null, x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
        : { action: 'scroll', selector: key, x: Math.round(t.scrollLeft), y: Math.round(t.scrollTop) });
    }, 250);
  }, true);
})();`,u=`<script data-ve-recorder>${b.replace(/<\/script/gi,"<\\/script")}<\/script>`;var p={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".avif":"image/avif",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".mp4":"video/mp4",".webm":"video/webm"};var s=self,T="<script data-ve-init>(function(){var F=Date.UTC(2026,0,1),D=Date;function FD(){if(!(this instanceof FD))return new D(F).toString();if(!arguments.length)return new D(F);return new (Function.prototype.bind.apply(D,[null].concat([].slice.call(arguments))))();}FD.prototype=D.prototype;FD.now=function(){return F};FD.UTC=D.UTC;FD.parse=D.parse;window.Date=FD;})();<\/script>",D=`${T}<script data-ve-init>/*
 * Init script, runs before any page code. Injected as plain text (never transpiled).
 * The seed placeholder below is replaced before injection.
 */
(function () {
  // Deterministic Math.random (mulberry32).
  var a = 24301 >>> 0;
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
  // Recorded steps ("Capture this state") replay with the page's timers running
  // again, so menus, scroll handlers and transitions can react; they are
  // stopped once more afterwards.
  Object.defineProperty(window, '__veResumeTimers', {
    value: function () { stopped = false; },
  });

  // IntersectionObservers drive scroll reveals. They are disconnected after the
  // recorded steps, so scrolling back to the top doesn't undo what scrolling did.
  var observers = [];
  var NativeIO = window.IntersectionObserver;
  if (NativeIO) {
    var TrackedIO = function (cb, opts) {
      var o = new NativeIO(cb, opts);
      observers.push(o);
      return o;
    };
    TrackedIO.prototype = NativeIO.prototype;
    window.IntersectionObserver = TrackedIO;
  }
  Object.defineProperty(window, '__veStopObservers', {
    value: function () {
      observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
      var n = observers.length;
      observers = [];
      return n;
    },
  });

  // Registered before any page code, so it runs first: while muted, the page's
  // scroll listeners don't see the editor scrolling back to the top.
  var scrollMuted = false;
  window.addEventListener('scroll', function (e) { if (scrollMuted) e.stopImmediatePropagation(); }, true);
  Object.defineProperty(window, '__veMuteScroll', {
    value: function (on) { scrollMuted = !!on; },
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
<\/script>`,E="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src 'self' data: blob:; object-src 'none'";s.addEventListener("install",()=>s.skipWaiting());s.addEventListener("activate",e=>e.waitUntil(s.clients.claim()));s.addEventListener("fetch",e=>{let n=new URL(e.request.url),t=new URL(s.registration.scope);if(n.origin!==t.origin||!n.pathname.startsWith(t.pathname))return;let o=/^(vfs|live)\/([a-z0-9-]+)\/(.*)$/.exec(n.pathname.slice(t.pathname.length));if(!o)return;let r;try{r=decodeURIComponent(o[3])}catch{return e.respondWith(new Response("Bad path",{status:400}))}e.respondWith(x(o[1],o[2],r))});function f(e,n,t){if(t==="head"){let o=/<head[^>]*>/i.exec(e);if(o)return e.slice(0,o.index+o[0].length)+n+e.slice(o.index+o[0].length);let r=/<!doctype[^>]*>/i.exec(e);return r?e.slice(0,r.index+r[0].length)+n+e.slice(r.index+r[0].length):n+e}return/<\/body>/i.test(e)?e.replace(/<\/body>/i,`${n}</body>`):e+n}async function x(e,n,t){let o=t===""||t.endsWith("/")?[`${t}index.html`]:[t],r;for(let i of o)r??=await d("files",`${n}/${i}`);if(!r)return new Response("Not found",{status:404,headers:{"content-type":"text/plain"}});let g=/\.[^./]+$/.exec(o[0])?.[0].toLowerCase()??"",c=r.type||p[g]||"application/octet-stream",a={"content-type":c,"cache-control":"no-store"};if(c.startsWith("text/html")){let i=new TextDecoder().decode(r.data);a["content-security-policy"]=E;let m=e==="vfs"?f(i,D,"head"):f(i,u,"body");return new Response(m,{headers:a})}return new Response(r.data,{headers:a})}})();
