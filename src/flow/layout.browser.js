/**
 * Runs inside an isolated component page (injected as plain text). Measures
 * where content can be split across frames: text lines, blocks, table rows
 * and table headers. All positions are CSS px from the top of the document.
 */
(function () {
  var BLOCK = /^(P|H[1-6]|LI|PRE|BLOCKQUOTE|FIGURE|IMG|SVG|VIDEO|CANVAS|TR|CAPTION|DT|DD|HR|TABLE|UL|OL|DL|DIV|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|NAV|MAIN|FORM|FIELDSET|ADDRESS|DETAILS|SUMMARY)$/;
  var ATOMIC = /^(IMG|SVG|VIDEO|CANVAS|FIGURE|HR|PRE)$/;
  var HEADING = /^H[1-6]$/;

  function visible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  function hasBlockChild(el) {
    return Array.prototype.some.call(el.children, function (c) {
      var d = getComputedStyle(c).display;
      return visible(c) && (d === 'block' || d === 'flex' || d === 'grid' || d === 'table' || d === 'list-item' || d === 'table-row' || d === 'table-row-group');
    });
  }
  var sy = function () { return window.scrollY || 0; };

  var root = document.querySelector('[data-ve-root]') || document.body;
  var rootTop = root.getBoundingClientRect().top + sy();
  var blocks = [];
  var lines = [];
  var tables = [];

  // Leaf blocks: block-level elements without block-level children (or atomic ones).
  var walk = function (el, inAtomic) {
    Array.prototype.forEach.call(el.children, function (c) {
      if (!visible(c) || c.hasAttribute('data-ve-hide')) return;
      var tag = c.tagName.toUpperCase();
      var disp = getComputedStyle(c).display;
      if (tag === 'TABLE') {
        var tr = c.getBoundingClientRect();
        var thead = c.tHead && visible(c.tHead) ? c.tHead.getBoundingClientRect() : null;
        var rows = Array.prototype.filter.call(c.querySelectorAll('tbody > tr, :scope > tr'), visible).map(function (r) {
          var b = r.getBoundingClientRect();
          return { top: b.top + sy() - rootTop, bottom: b.bottom + sy() - rootTop };
        });
        var cap = c.caption && visible(c.caption) ? c.caption.getBoundingClientRect() : null;
        tables.push({
          top: tr.top + sy() - rootTop,
          bottom: tr.bottom + sy() - rootTop,
          thead: thead ? { top: thead.top + sy() - rootTop, bottom: thead.bottom + sy() - rootTop } : null,
          rows: rows,
        });
        var unitTop = tr.top + sy() - rootTop;
        // Caption + header + first row are kept together; each later row is a unit.
        var firstRowBottom = rows.length ? rows[0].bottom : tr.bottom + sy() - rootTop;
        blocks.push({ top: unitTop, bottom: firstRowBottom, kind: 'row', tag: 'TABLE-START' });
        rows.slice(1).forEach(function (r) { blocks.push({ top: r.top, bottom: r.bottom, kind: 'row', tag: 'TR' }); });
        void cap;
        return;
      }
      var leaf = ATOMIC.test(tag) || inAtomic || !hasBlockChild(c);
      if (leaf && (BLOCK.test(tag) || disp === 'block' || disp === 'list-item' || disp === 'flex' || disp === 'grid')) {
        var b = c.getBoundingClientRect();
        var kind = HEADING.test(tag) || c.getAttribute('role') === 'heading' ? 'heading' : ATOMIC.test(tag) ? 'atomic' : 'text';
        if (kind === 'text' && (disp === 'flex' || disp === 'grid')) kind = 'atomic';
        var idx = blocks.length;
        blocks.push({ top: b.top + sy() - rootTop, bottom: b.bottom + sy() - rootTop, kind: kind, tag: tag });
        if (kind !== 'atomic') collectLines(c, idx);
        return;
      }
      walk(c, inAtomic || ATOMIC.test(tag));
    });
  };

  function collectLines(el, blockIdx) {
    var rects = [];
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    for (var n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.textContent.trim()) continue;
      var p = n.parentElement;
      if (p && (p.closest('[data-ve-hide]') || !visible(p))) continue;
      range.selectNodeContents(n);
      Array.prototype.forEach.call(range.getClientRects(), function (r) {
        if (r.width > 0 && r.height > 0) rects.push({ top: r.top + sy() - rootTop, bottom: r.bottom + sy() - rootTop, text: n.textContent });
      });
    }
    rects.sort(function (a, b) { return a.top - b.top; });
    var cur = null;
    rects.forEach(function (r) {
      // Rects on the same visual line overlap vertically.
      if (cur && r.top < cur.bottom - 0.5 * Math.min(r.bottom - r.top, cur.bottom - cur.top)) {
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      } else {
        cur = { top: r.top, bottom: r.bottom, block: blockIdx };
        lines.push(cur);
      }
    });
  }

  walk(root, false);
  var height = root === document.body ? document.documentElement.scrollHeight : root.getBoundingClientRect().height;
  return { height: Math.ceil(height), blocks: blocks, lines: lines, tables: tables };
})();
