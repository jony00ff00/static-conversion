/**
 * Injected into the live preview: reports what the user does so it can be
 * replayed before capture ("Capture this state"). Posts
 * `{ type: 've-step', step }` to the editor, where `step` is a SetupStep:
 * - click on any element, except checkboxes, radio buttons and their labels;
 * - check: the ticked state of a checkbox or radio after it changes (clicking a
 *   label also clicks its input, so recording clicks would toggle twice);
 * - select: the value of a drop-down after it changes;
 * - scroll: where the page or a scrollable element came to rest (debounced).
 */
const SCRIPT = String.raw`(function () {
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
})();`;

export const RECORDER = `<script data-ve-recorder>${SCRIPT.replace(/<\/script/gi, '<\\/script')}</script>`;
