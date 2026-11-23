import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, type ProjectPayload } from './api.js';
import { clientBaseUrl, frozenForPane, liveUrl, pageHtml, parse } from './render.js';
import { homeHref } from './nav.js';
import { IS_STATIC } from '../static/env.js';
import { buildTree, commonAncestor, defFromItem, flattenTree, type TreeItem } from '../compose/tree.js';
import { ownText } from '../compose/isolate.js';
import { contentRectMm, gridColumnsMm, mmToPx, PX_PER_MM, pxToMm, pxToPt, trimMm, type Rect } from '../model/geometry.js';
import * as ops from '../model/ops.js';
import { snapMove, snapResize, snapTargets } from '../model/snap.js';
import type { ComponentDef, EditorDocument, Override, Placement } from '../model/types.js';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Drag =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; handle: Handle; startX: number; startY: number; rect: Rect }
  | { kind: 'margin'; side: 'top' | 'right' | 'bottom' | 'left'; startX: number; startY: number; value: number; orig: number }
  | { kind: 'guide'; id: string; axis: 'x' | 'y'; start: number; pos: number }
  | { kind: 'place'; def: ComponentDef; label: string; x: number; y: number };

const SNAP_PX = 6; // snap distance on screen
const r2 = (n: number) => Math.round(n * 100) / 100;

declare global {
  interface Window {
    __ve?: Record<string, unknown>;
  }
}

/** Rect of an element in viewport coordinates, through nested (scaled) iframes. */
function viewportRect(el: Element): Rect | null {
  let r = el.getBoundingClientRect();
  let x = r.left;
  let y = r.top;
  let w = r.width;
  let h = r.height;
  let win = el.ownerDocument.defaultView;
  while (win && win.frameElement) {
    const fe = win.frameElement as HTMLIFrameElement;
    const fr = fe.getBoundingClientRect();
    const sx = fe.offsetWidth ? fr.width / fe.offsetWidth : 1;
    const sy = fe.offsetHeight ? fr.height / fe.offsetHeight : 1;
    void sy;
    // Content starts inside the iframe's border.
    x = fr.left + (fe.clientLeft + x) * sx;
    y = fr.top + (fe.clientTop + y) * sx;
    w *= sx;
    h *= sx;
    win = fe.ownerDocument.defaultView;
    if (win === window) break;
  }
  void r;
  return { x, y, w, h };
}

/** Deepest stamped element at a viewport point inside a page iframe (through component frames). */
function wpIdAtPoint(pageFrame: HTMLIFrameElement, cx: number, cy: number): string | null {
  const doc = pageFrame.contentDocument;
  if (!doc) return null;
  const fr = pageFrame.getBoundingClientRect();
  const zoom = fr.width / pageFrame.offsetWidth;
  const px = (cx - fr.left) / zoom;
  const py = (cy - fr.top) / zoom;
  const hits = doc.elementsFromPoint(px, py).filter((e): e is HTMLIFrameElement => e.tagName === 'IFRAME');
  for (const inner of hits) {
    const ir = inner.getBoundingClientRect();
    const s = inner.offsetWidth ? ir.width / inner.offsetWidth : 1;
    const idoc = inner.contentDocument;
    if (!idoc) continue;
    const el = idoc.elementFromPoint((px - ir.left) / s, (py - ir.top) / s);
    const stamped = el?.closest('[data-wp-id]');
    if (stamped && stamped.tagName !== 'HTML' && stamped.tagName !== 'BODY') return stamped.getAttribute('data-wp-id');
  }
  return null;
}

function innerDocs(pageFrame: HTMLIFrameElement | null, placementId?: string): Document[] {
  const doc = pageFrame?.contentDocument;
  if (!doc) return [];
  const sel = placementId ? `[data-placement="${placementId}"] iframe.ve-inner` : 'iframe.ve-inner';
  return Array.from(doc.querySelectorAll<HTMLIFrameElement>(sel))
    .map((f) => f.contentDocument)
    .filter((d): d is Document => !!d);
}

function minFontPt(def: ComponentDef, p: Placement): number | null {
  if (def.minFontPx == null) return null;
  const scale = p.fit === 'scale' ? mmToPx(p.wMm) / def.widthPx : 1;
  return Math.round(pxToPt(def.minFontPx * scale) * 10) / 10;
}

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [frozen, setFrozen] = useState('');
  const historyRef = useRef<ops.History | null>(null);
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [libSel, setLibSel] = useState<string[]>([]);
  const [selWpId, setSelWpId] = useState<string | null>(null);
  const [hoverWpId, setHoverWpId] = useState<string | null>(null);
  const [webMode, setWebMode] = useState<'frozen' | 'live'>('frozen');
  const [pendingSteps, setPendingSteps] = useState<Array<{ action: 'click'; selector: string }>>([]);
  const [zoom, setZoom] = useState(0.75);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = useCallback((v: Drag | null | ((d: Drag | null) => Drag | null)) => {
    const next = typeof v === 'function' ? v(dragRef.current) : v;
    dragRef.current = next;
    setDragState(next);
  }, []);
  const [contentEdit, setContentEdit] = useState<string | null>(null);
  const [contentTarget, setContentTarget] = useState<string | null>(null);
  const [proof, setProof] = useState<Record<string, { url: string; opacity: number; diff: boolean }>>({});
  const [overflow, setOverflow] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [hl, setHl] = useState<{ web: Rect | null; print: Rect[] }>({ web: null, print: [] });
  const [snapName, setSnapName] = useState('');
  const webFrame = useRef<HTMLIFrameElement>(null);
  const pageFrames = useRef<Record<string, HTMLIFrameElement | null>>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const [frameTick, setFrameTick] = useState(0);
  const webScroll = useRef<HTMLDivElement>(null);
  const [webW, setWebW] = useState(600);
  useEffect(() => {
    const el = webScroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWebW(el.clientWidth - 18));
    ro.observe(el);
    return () => ro.disconnect();
  });

  /* ----------------------------------------------------------- loading */

  const loadProject = useCallback(async () => {
    const [p, f] = await Promise.all([api.load(projectId), api.frozen(projectId)]);
    setProject(p);
    setFrozen(f);
    historyRef.current = new ops.History(p.document);
    setDoc(p.document);
  }, [projectId]);

  useEffect(() => {
    loadProject().catch((e) => setToast({ kind: 'error', text: String(e) }));
  }, [loadProject]);

  const baseUrl = project ? clientBaseUrl(projectId, project.analysis.baseUrl) : '';

  const persist = useCallback(
    (d: EditorDocument) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.save(projectId, d).catch((e) => setToast({ kind: 'error', text: `Save failed: ${e.message}` }));
      }, 300);
    },
    [projectId],
  );

  const commit = useCallback(
    (op: (d: EditorDocument) => EditorDocument) => {
      const h = historyRef.current;
      if (!h) return;
      try {
        const next = h.apply(op);
        setDoc(next);
        persist(next);
      } catch (e) {
        setToast({ kind: 'error', text: (e as Error).message });
      }
    },
    [persist],
  );

  const replaceDoc = useCallback(
    (d: EditorDocument) => {
      commit(() => d);
    },
    [commit],
  );

  const undo = () => {
    const h = historyRef.current;
    if (!h) return;
    const d = h.undo();
    setDoc(d);
    persist(d);
  };
  const redo = () => {
    const h = historyRef.current;
    if (!h) return;
    const d = h.redo();
    setDoc(d);
    persist(d);
  };

  const recapture = async (patch: Partial<EditorDocument>, label = 'Re-capturing…') => {
    if (!doc) return;
    setBusy(label);
    try {
      await api.save(projectId, doc);
      const p = await api.recapture(projectId, patch);
      const f = await api.frozen(projectId);
      setProject(p);
      setFrozen(f);
      historyRef.current = new ops.History(p.document);
      setDoc(p.document);
      if (p.presetReport) setToast({ kind: 'info', text: `Presets: ${p.presetReport.hidden} hidden, ${p.presetReport.expanded} expanded, ${p.presetReport.links} link URLs added.` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  /* -------------------------------------------------------- derived data */

  const tree = useMemo(() => (project && doc ? buildTree(project.analysis.nodes, doc.decomposition) : []), [project, doc?.decomposition]);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const pageSrc = useMemo(() => {
    if (!project || !doc || !frozen) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const pg of doc.pages) out[pg.id] = pageHtml(projectId, frozen, baseUrl, doc, pg.id);
    return out;
  }, [project, doc, frozen, baseUrl, projectId]);
  const webSrc = useMemo(() => (frozen && baseUrl ? frozenForPane(frozen, baseUrl) : ''), [frozen, baseUrl]);
  const inMargin = useMemo(() => new Set(doc ? ops.placementsInMargin(doc) : []), [doc]);

  /* ------------------------------------------------------ linked selection */

  const computeHighlights = useCallback(() => {
    const id = selWpId ?? hoverWpId;
    if (!id) return setHl({ web: null, print: [] });
    const wd = webFrame.current?.contentDocument;
    const wel = webMode === 'frozen' ? wd?.querySelector(`[data-wp-id="${id}"]`) : null;
    const web = wel ? viewportRect(wel) : null;
    const print: Rect[] = [];
    for (const f of Object.values(pageFrames.current)) {
      for (const idoc of innerDocs(f)) {
        const el = idoc.querySelector(`[data-wp-id="${id}"]`);
        if (!el || el.closest('[data-ve-hide]')) continue;
        const r = viewportRect(el);
        // Only highlight what is visible inside the frame (not content cut off below it).
        const frameEl = idoc.defaultView?.frameElement?.closest('.ve-frame');
        const clip = frameEl ? viewportRect(frameEl) : null;
        if (!r || r.w <= 0 || r.h <= 0) continue;
        if (clip && (r.x >= clip.x + clip.w || r.x + r.w <= clip.x || r.y >= clip.y + clip.h || r.y + r.h <= clip.y)) continue;
        if (clip) {
          // Highlight only the part that is visible in the frame.
          const x = Math.max(r.x, clip.x);
          const y = Math.max(r.y, clip.y);
          print.push({ x, y, w: Math.min(r.x + r.w, clip.x + clip.w) - x, h: Math.min(r.y + r.h, clip.y + clip.h) - y });
        } else print.push(r);
      }
    }
    setHl({ web, print });
  }, [selWpId, hoverWpId, webMode]);

  useEffect(() => {
    computeHighlights();
  }, [computeHighlights, frameTick, zoom, doc]);

  useEffect(() => {
    const on = () => computeHighlights();
    addEventListener('scroll', on, true);
    addEventListener('resize', on);
    return () => {
      removeEventListener('scroll', on, true);
      removeEventListener('resize', on);
    };
  }, [computeHighlights]);

  const selectWp = (id: string | null, scroll = true) => {
    setSelWpId(id);
    if (id && scroll && webMode === 'frozen') {
      const el = webFrame.current?.contentDocument?.querySelector(`[data-wp-id="${id}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Web pane (frozen): hover and click map to data-wp-id.
  const onWebLoad = () => {
    const d = webFrame.current?.contentDocument;
    if (!d) return;
    d.addEventListener('mousemove', (e) => {
      const el = (e.target as Element).closest?.('[data-wp-id]');
      setHoverWpId(el && el.tagName !== 'HTML' && el.tagName !== 'BODY' ? el.getAttribute('data-wp-id') : null);
    });
    d.addEventListener('mouseleave', () => setHoverWpId(null));
    // The frozen page is a picture of the site: links and forms must not navigate it.
    d.addEventListener('click', (e) => e.preventDefault(), true);
    d.addEventListener('submit', (e) => e.preventDefault(), true);
    d.addEventListener('dragstart', (e) => e.preventDefault(), true);
    d.addEventListener('pointerdown', (e) => {
      const el = (e.target as Element).closest?.('[data-wp-id]');
      if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') return;
      e.preventDefault(); // no text selection or native drag in the frozen page
      const wp = el.getAttribute('data-wp-id');
      selectWp(wp, false);
      startWebDrag(e as PointerEvent, wp!);
    });
    // Mark elements that differ in print.
    markOverridden();
    setFrameTick((t) => t + 1);
  };

  const markOverridden = useCallback(() => {
    const d = webFrame.current?.contentDocument;
    if (!d || !doc) return;
    d.querySelectorAll('[data-ve-overridden-src]').forEach((e) => e.removeAttribute('data-ve-overridden-src'));
    for (const o of doc.overrides) d.querySelector(`[data-wp-id="${o.target}"]`)?.setAttribute('data-ve-overridden-src', '');
  }, [doc]);
  useEffect(() => markOverridden(), [markOverridden]);

  // Live pane: record clicks for "Capture this state".
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type === 've-click' && typeof e.data.selector === 'string') {
        setPendingSteps((s) => [...s, { action: 'click', selector: e.data.selector }]);
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);

  /* ------------------------------------------------------------- dragging */

  const nodeFor = (wp: string) => {
    if (!project) return null;
    const byId = new Map(project.analysis.nodes.map((n) => [n.wpId, n]));
    let n = byId.get(wp);
    if (n) return n;
    // Walk up the frozen DOM to the nearest analysed component.
    const d = parse(frozen);
    for (let e = d.querySelector(`[data-wp-id="${wp}"]`)?.parentElement; e; e = e.parentElement) {
      n = byId.get(e.getAttribute('data-wp-id') ?? '');
      if (n) return n;
    }
    return null;
  };

  const startWebDrag = (e: PointerEvent, wp: string) => {
    const n = nodeFor(wp);
    if (!n) return;
    const item = flat.find((i) => i.node.wpId === n.wpId) ?? { node: n, children: [], label: n.name, repeatCount: 1 };
    const fr = webFrame.current!.getBoundingClientRect();
    const sx = fr.width / webFrame.current!.offsetWidth;
    const start = { x: fr.left + e.clientX * sx, y: fr.top + e.clientY * sx };
    const def = defFromItem(item as TreeItem);
    const move = (ev: PointerEvent) => {
      const x = fr.left + ev.clientX * sx;
      const y = fr.top + ev.clientY * sx;
      if (Math.hypot(x - start.x, y - start.y) > 6) setDrag({ kind: 'place', def, label: item.label, x, y });
    };
    const up = (ev: PointerEvent) => {
      webFrame.current?.contentDocument?.removeEventListener('pointermove', move);
      webFrame.current?.contentDocument?.removeEventListener('pointerup', up);
      void ev;
    };
    webFrame.current?.contentDocument?.addEventListener('pointermove', move);
    webFrame.current?.contentDocument?.addEventListener('pointerup', up);
  };

  // Global pointer tracking while placing (drag from web pane or library onto a page).
  useEffect(() => {
    if (drag?.kind !== 'place') return;
    const move = (e: PointerEvent) => setDrag((d) => (d?.kind === 'place' ? { ...d, x: e.clientX, y: e.clientY } : d));
    // Drop at a point in this window's coordinates (also used when the release
    // is delivered to the web pane, which keeps the mouse while the button is down).
    const dropAt = (cx: number, cy: number) => {
      const d = dragRef.current;
      if (d?.kind !== 'place') return;
      setDrag(null);
      const target = document.elementsFromPoint(cx, cy).find((el) => (el as HTMLElement).dataset?.pageDrop);
      if (!target || !doc) return;
      const pageId = (target as HTMLElement).dataset.pageDrop!;
      const r = target.getBoundingClientRect();
      const s = PX_PER_MM * zoom;
      const xMm = r2((cx - r.left) / s);
      const yMm = r2((cy - r.top) / s);
      commit((x) => ops.placeComponent(x, d.def, pageId, { xMm, yMm }));
    };
    const up = (e: PointerEvent) => dropAt(e.clientX, e.clientY);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    // Also listen inside the web frame (pointer captured there while dragging out).
    const wd = webFrame.current?.contentDocument;
    const fr = webFrame.current?.getBoundingClientRect();
    const sx = fr && webFrame.current ? fr.width / webFrame.current.offsetWidth : 1;
    const wmove = (e: PointerEvent) => fr && setDrag((d) => (d?.kind === 'place' ? { ...d, x: fr.left + e.clientX * sx, y: fr.top + e.clientY * sx } : d));
    const wup = (e: PointerEvent) => (fr ? dropAt(fr.left + e.clientX * sx, fr.top + e.clientY * sx) : setDrag(null));
    wd?.addEventListener('pointermove', wmove);
    wd?.addEventListener('pointerup', wup);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      wd?.removeEventListener('pointermove', wmove);
      wd?.removeEventListener('pointerup', wup);
    };
  }, [drag?.kind === 'place', zoom, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = PX_PER_MM * zoom;

  const onBoxDown = (e: RPointerEvent, p: Placement, pageFrame: HTMLIFrameElement | null) => {
    if (contentEdit === p.id) return;
    e.stopPropagation();
    const ids = e.shiftKey ? Array.from(new Set([...selection, p.id])) : selection.includes(p.id) ? selection : [p.id];
    setSelection(ids);
    if (pageFrame) {
      const wp = wpIdAtPoint(pageFrame, e.clientX, e.clientY);
      if (wp) selectWp(wp);
    }
    if (p.locked) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'move', ids: doc ? ops.withGroup(doc, ids) : ids, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
  };

  const onHandleDown = (e: RPointerEvent, p: Placement, handle: Handle) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelection([p.id]);
    setDrag({ kind: 'resize', id: p.id, handle, startX: e.clientX, startY: e.clientY, rect: { x: p.xMm, y: p.yMm, w: p.wMm, h: p.hMm } });
  };

  const targetsFor = (pageId: string, exclude: string[]) =>
    doc
      ? snapTargets(doc.pageSetup, {
          guides: doc.guides,
          grid: doc.showGrid,
          others: doc.placements.filter((x) => x.pageId === pageId && !exclude.includes(x.id)).map((x) => ({ x: x.xMm, y: x.yMm, w: x.wMm, h: x.hMm })),
        })
      : [];

  const draftRect = (p: Placement): Rect => {
    if (drag?.kind === 'move' && drag.ids.includes(p.id)) return { x: p.xMm + drag.dx, y: p.yMm + drag.dy, w: p.wMm, h: p.hMm };
    if (drag?.kind === 'resize' && drag.id === p.id) return drag.rect;
    return { x: p.xMm, y: p.yMm, w: p.wMm, h: p.hMm };
  };

  const onOverlayMove = (e: RPointerEvent, pageId: string) => {
    if (!drag || !doc) return;
    if (drag.kind === 'move') {
      const moving = doc.placements.filter((p) => drag.ids.includes(p.id));
      const rawDx = (e.clientX - drag.startX) / s;
      const rawDy = (e.clientY - drag.startY) / s;
      const x = Math.min(...moving.map((p) => p.xMm)) + rawDx;
      const y = Math.min(...moving.map((p) => p.yMm)) + rawDy;
      const w = Math.max(...moving.map((p) => p.xMm + p.wMm)) - Math.min(...moving.map((p) => p.xMm));
      const h = Math.max(...moving.map((p) => p.yMm + p.hMm)) - Math.min(...moving.map((p) => p.yMm));
      const snapped = e.altKey ? { rect: { x, y, w, h } } : snapMove({ x, y, w, h }, targetsFor(pageId, drag.ids), SNAP_PX / s);
      setDrag({ ...drag, dx: rawDx + (snapped.rect.x - x), dy: rawDy + (snapped.rect.y - y) });
    } else if (drag.kind === 'resize') {
      const p = doc.placements.find((x) => x.id === drag.id)!;
      const dx = (e.clientX - drag.startX) / s;
      const dy = (e.clientY - drag.startY) / s;
      const hd = drag.handle;
      let { xMm: x, yMm: y, wMm: w, hMm: h } = p;
      if (hd.includes('w')) (x += dx), (w -= dx);
      if (hd.includes('e')) w += dx;
      if (hd.includes('n')) (y += dy), (h -= dy);
      if (hd.includes('s')) h += dy;
      const r = e.altKey
        ? { x, y, w: Math.max(1, w), h: Math.max(1, h) }
        : snapResize({ x, y, w, h }, { left: hd.includes('w'), right: hd.includes('e'), top: hd.includes('n'), bottom: hd.includes('s') }, targetsFor(pageId, [p.id]), SNAP_PX / s);
      setDrag({ ...drag, rect: r });
    } else if (drag.kind === 'margin') {
      const d = drag.side === 'top' || drag.side === 'bottom' ? (e.clientY - drag.startY) / s : (e.clientX - drag.startX) / s;
      const sign = drag.side === 'bottom' || drag.side === 'right' ? -1 : 1;
      setDrag({ ...drag, value: Math.max(0, Math.round((drag.orig + sign * d) * 2) / 2) });
    } else if (drag.kind === 'guide') {
      const d = drag.axis === 'x' ? e.clientX : e.clientY;
      setDrag({ ...drag, pos: r2(drag.start + (d - (drag.axis === 'x' ? 0 : 0)) / s - drag.start + drag.start) });
    }
  };

  const onOverlayUp = () => {
    // Read the live drag from the ref: several handlers may see the same
    // pointerup, and only the first may commit it.
    const d = dragRef.current;
    if (!d || !doc) return;
    dragRef.current = null;
    setDrag(null);
    if (d.kind === 'move' && (Math.abs(d.dx) > 0.001 || Math.abs(d.dy) > 0.001)) commit((x) => ops.movePlacements(x, d.ids, r2(d.dx), r2(d.dy)));
    if (d.kind === 'resize') commit((x) => ops.setPlacementRect(x, d.id, { x: r2(d.rect.x), y: r2(d.rect.y), w: r2(d.rect.w), h: r2(d.rect.h) }));
    if (d.kind === 'margin' && d.value !== d.orig) commit((x) => ops.setMargins(x, { ...x.pageSetup.marginsMm, [d.side]: d.value }));
  };

  /* ---------------------------------------------------------- content mode */

  const editableLeaves = (idoc: Document) =>
    Array.from(idoc.querySelectorAll<HTMLElement>('body [data-wp-id]')).filter(
      (el) => !el.closest('[data-ve-hide]') && el.children.length === 0 && (el.textContent ?? '').trim().length > 0,
    );

  const originalText = useCallback(
    (wp: string) => {
      const el = parse(frozen).querySelector(`[data-wp-id="${wp}"]`);
      return el ? ownText(el) : '';
    },
    [frozen],
  );

  const wireContentMode = useCallback(() => {
    if (!contentEdit || !doc) return;
    const p = doc.placements.find((x) => x.id === contentEdit);
    if (!p) return;
    const frame = pageFrames.current[p.pageId] ?? null;
    for (const idoc of innerDocs(frame, p.id)) {
      if ((idoc as Document & { __veWired?: boolean }).__veWired) continue;
      (idoc as Document & { __veWired?: boolean }).__veWired = true;
      const style = idoc.createElement('style');
      style.textContent = '[contenteditable]{outline:1px dashed rgba(37,99,235,.5);cursor:text}[contenteditable]:focus{outline:2px solid #2563eb}[data-ve-target]{outline:2px solid #f59e0b!important}';
      idoc.head.appendChild(style);
      for (const el of editableLeaves(idoc)) {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') e.preventDefault();
        });
        el.addEventListener('focusout', () => {
          const wp = el.getAttribute('data-wp-id')!;
          const value = ownText(el);
          const original = originalText(wp);
          const current = doc.overrides.find((o) => o.type === 'text' && o.target === wp && o.componentId === p.componentId) as Extract<Override, { type: 'text' }> | undefined;
          if (value === (current?.value ?? original)) return;
          commit((x) => ops.setOverride(x, { id: ops.newId('ov'), componentId: p.componentId, type: 'text', target: wp, value, original }));
        });
      }
      idoc.addEventListener('pointerdown', (e) => {
        const el = (e.target as Element).closest?.('[data-wp-id]');
        if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') return;
        idoc.querySelectorAll('[data-ve-target]').forEach((x) => x.removeAttribute('data-ve-target'));
        el.setAttribute('data-ve-target', '');
        setContentTarget(el.getAttribute('data-wp-id'));
        selectWp(el.getAttribute('data-wp-id'), true);
      });
    }
  }, [contentEdit, doc, commit, originalText]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPageLoad = (pageId: string) => {
    const f = pageFrames.current[pageId];
    if (!f || !doc) return;
    // Overflow flags (reflow frames whose content is taller than the frame).
    const flags: Record<string, boolean> = {};
    for (const p of doc.placements.filter((x) => x.pageId === pageId && x.fit === 'reflow' && !x.chainId)) {
      const idoc = innerDocs(f, p.id)[0];
      if (!idoc) continue;
      const root = idoc.querySelector('[data-ve-root]') as HTMLElement | null;
      const h = root ? root.getBoundingClientRect().height : idoc.documentElement.scrollHeight;
      flags[p.id] = h > mmToPx(p.hMm) + 0.5;
    }
    for (const c of doc.chains) for (const sl of c.slices) if (sl.overflow) flags[sl.placementId] = true;
    setOverflow((o) => ({ ...o, ...flags }));
    setFrameTick((t) => t + 1);
    wireContentMode();
  };
  useEffect(() => wireContentMode(), [wireContentMode]);

  const contentPlacement = doc?.placements.find((p) => p.id === contentEdit);
  // While editing content, that page takes clicks directly (overlay steps aside).
  const contentPage = contentPlacement?.pageId ?? null;
  const targetEl = useMemo(() => {
    if (!contentTarget) return null;
    return parse(frozen).querySelector(`[data-wp-id="${contentTarget}"]`);
  }, [contentTarget, frozen]);

  const setStyleOverride = (prop: string, value: string) => {
    if (!contentPlacement || !contentTarget) return;
    if (!value) {
      const o = doc!.overrides.find((x) => x.type === 'style' && x.target === contentTarget && x.prop === prop && x.componentId === contentPlacement.componentId);
      if (o) commit((d) => ops.revertOverride(d, o.id));
      return;
    }
    commit((d) => ops.setOverride(d, { id: ops.newId('ov'), componentId: contentPlacement.componentId, type: 'style', target: contentTarget, prop, value }));
  };

  // Snap each page to whole screen pixels: a page at a fractional position
  // would anti-alias every edge differently from the export and the Proof.
  useEffect(() => {
    const snap = () => {
      document.querySelectorAll<HTMLElement>('.page').forEach((el) => {
        el.style.translate = '';
        const r = el.getBoundingClientRect();
        const fx = r.left - Math.round(r.left);
        const fy = r.top - Math.round(r.top);
        if (Math.abs(fx) > 0.001 || Math.abs(fy) > 0.001) el.style.translate = `${-fx}px ${-fy}px`;
      });
    };
    snap();
    const pane = document.querySelector('.print-pane');
    pane?.addEventListener('scroll', snap);
    addEventListener('resize', snap);
    return () => {
      pane?.removeEventListener('scroll', snap);
      removeEventListener('resize', snap);
    };
  });

  /* ----------------------------------------------------------------- keys */

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        commit((d) => ops.deletePlacements(d, selection));
        setSelection([]);
      } else if (e.key === 'Escape') {
        setContentEdit(null);
        setContentTarget(null);
      } else if (e.key.startsWith('Arrow') && selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit((d) => ops.movePlacements(d, selection, dx, dy));
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  /* ----------------------------------------------------------------- tests */

  useEffect(() => {
    window.__ve = {
      getDoc: () => historyRef.current?.present,
      getSelection: () => selection,
      getHighlights: () => hl,
      getSelectedWpId: () => selWpId,
      selectWp: (id: string) => selectWp(id),
      setZoom,
      commit,
      ops,
      history: historyRef.current,
      projectId,
    };
  });

  if (!project || !doc) return <main className="loading">{toast ? <p role="alert">{toast.text}</p> : 'Loading…'}</main>;

  const t = trimMm(doc.pageSetup);
  const c = contentRectMm(doc.pageSetup);
  const sel = doc.placements.find((p) => p.id === selection[selection.length - 1]);
  const selDef = sel ? doc.components[sel.componentId] : undefined;
  const margins = drag?.kind === 'margin' ? { ...doc.pageSetup.marginsMm, [drag.side]: drag.value } : doc.pageSetup.marginsMm;
  const cDraft = drag?.kind === 'margin' ? contentRectMm({ ...doc.pageSetup, marginsMm: margins }) : c;

  const placeItem = (item: TreeItem) => {
    const pageId = sel?.pageId ?? doc.pages[0]!.id;
    const merged = item.mergedId ? doc.decomposition.merged.find((m) => m.id === item.mergedId) : undefined;
    commit((d) => ops.placeComponent(d, defFromItem(item, merged), pageId, { xMm: c.x, yMm: c.y }));
  };

  const decomp = (patch: Partial<EditorDocument['decomposition']>) => commit((d) => ({ ...d, decomposition: { ...d.decomposition, ...patch } }));

  const selectorFor = (wp: string) => {
    const el = parse(frozen).querySelector(`[data-wp-id="${wp}"]`);
    if (!el) return null;
    const cls = Array.from(el.classList).filter((x) => /^[A-Za-z][\w-]*$/.test(x)).slice(0, 2);
    return el.tagName.toLowerCase() + cls.map((x) => `.${x}`).join('');
  };

  const flowOntoPages = async () => {
    if (!sel) return;
    setBusy('Flowing onto pages…');
    try {
      await api.save(projectId, doc);
      const r = await api.paginate(projectId, sel.componentId, sel.pageId, ops.deletePlacements(doc, [sel.id]));
      replaceDoc(r.document);
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const linkSelected = async () => {
    try {
      const next = ops.linkFrames(doc, selection);
      const chainId = next.chains[next.chains.length - 1]!.id;
      setBusy('Linking frames…');
      const r = await api.reflowChain(projectId, chainId, next);
      replaceDoc(r.document);
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const doProof = async (pageId: string) => {
    if (proof[pageId]) {
      URL.revokeObjectURL(proof[pageId]!.url);
      const { [pageId]: _gone, ...rest } = proof;
      void _gone;
      return setProof(rest);
    }
    setBusy('Rendering proof…');
    try {
      await api.save(projectId, doc);
      const blob = await api.proof(projectId, pageId);
      setProof((p) => ({ ...p, [pageId]: { url: URL.createObjectURL(blob), opacity: 0.5, diff: false } }));
    } finally {
      setBusy('');
    }
  };

  const exportPdf = async () => {
    setBusy('Exporting PDF…');
    try {
      await api.save(projectId, doc);
      const blob = await api.exportPdf(projectId);
      if (!blob) return; // static build: the print dialog was opened instead
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.meta.title.replace(/[^\w-]+/g, '-') || 'export'}.pdf`;
      a.click();
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const libItem = (item: TreeItem, depth = 0): JSX.Element => {
    const on = libSel.includes(item.node.wpId);
    return (
      <li key={item.mergedId ?? item.node.wpId}>
        <div
          className={`lib-item${on ? ' on' : ''}${selWpId === item.node.wpId ? ' hl' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          data-wp={item.node.wpId}
          role="button"
          tabIndex={0}
          aria-pressed={on}
          onClick={(e) => {
            setLibSel(e.ctrlKey || e.metaKey ? (on ? libSel.filter((x) => x !== item.node.wpId) : [...libSel, item.node.wpId]) : [item.node.wpId]);
            selectWp(item.node.wpId);
          }}
          onPointerDown={(e) => {
            const start = { x: e.clientX, y: e.clientY };
            const def = defFromItem(item, item.mergedId ? doc.decomposition.merged.find((m) => m.id === item.mergedId) : undefined);
            const mv = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
                removeEventListener('pointermove', mv);
                setDrag({ kind: 'place', def, label: item.label, x: ev.clientX, y: ev.clientY });
              }
            };
            addEventListener('pointermove', mv);
            addEventListener('pointerup', () => removeEventListener('pointermove', mv), { once: true });
          }}
        >
          <span className={`kind k-${item.node.kind}`}>{item.node.kind}</span>
          <span className="lib-name">{item.label}</span>
          {item.repeatCount > 1 && <span className="badge" title="Repeated">×{item.repeatCount}</span>}
          <span className="lib-actions">
            <button aria-label={`Place ${item.label}`} title="Place on page" onClick={(e) => (e.stopPropagation(), placeItem(item))}>＋</button>
            {item.children.length > 0 || project.analysis.nodes.some((n) => n.parentWpId === item.node.wpId) ? (
              <button aria-label={`Split ${item.label}`} title="Split into parts" onClick={(e) => (e.stopPropagation(), decomp({ split: [...doc.decomposition.split, item.node.wpId] }))}>⇲</button>
            ) : null}
            <button aria-label={`Remove ${item.label} from library`} title="Not a component" onClick={(e) => (e.stopPropagation(), decomp({ demoted: [...doc.decomposition.demoted, item.node.wpId] }))}>×</button>
          </span>
        </div>
        {item.children.length > 0 && <ul className="plain">{item.children.map((ch) => libItem(ch, depth + 1))}</ul>}
      </li>
    );
  };

  const selNode = selWpId ? project.analysis.nodes.find((n) => n.wpId === selWpId) : undefined;
  const libItemsSel = flat.filter((i) => libSel.includes(i.node.wpId));

  return (
    <div className="editor" onPointerUp={() => drag?.kind !== 'place' && onOverlayUp()}>
      <header className="toolbar">
        <a href={homeHref()} className="brand">Static Conversion</a>
        <strong className="title">{project.meta.title}</strong>
        <button onClick={undo} disabled={!historyRef.current?.canUndo} aria-label="Undo">↶ Undo</button>
        <button onClick={redo} disabled={!historyRef.current?.canRedo} aria-label="Redo">↷ Redo</button>
        <label>
          Detail
          <input type="range" min={1} max={4} value={doc.decomposition.granularity} aria-label="Component granularity" onChange={(e) => decomp({ granularity: Number(e.target.value) })} />
        </label>
        <label>
          Zoom
          <select aria-label="Zoom" value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
            {[0.5, 0.75, 1, 1.5, 2, 4].map((z) => (
              <option key={z} value={String(z)}>{z * 100}%</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={doc.showGrid} onChange={(e) => commit((d) => ({ ...d, showGrid: e.target.checked }))} /> Grid
        </label>
        <button onClick={exportPdf} className="primary">{IS_STATIC ? 'Print / Save PDF' : 'Export PDF'}</button>
        {busy && <span role="status" className="status">{busy}</span>}
      </header>

      <aside className="library" aria-label="Components">
        <h2>Components</h2>
        <div className="lib-tools">
          <button disabled={libItemsSel.length < 2} onClick={() => {
            const nodes = libItemsSel.map((i) => i.node);
            const root = commonAncestor(nodes, project.analysis.nodes) ?? nodes[0]!.parentWpId ?? project.bodyWpId;
            decomp({ merged: [...doc.decomposition.merged, { id: ops.newId('merge'), rootWpId: root, wpIds: nodes.map((n) => n.wpId) }] });
            setLibSel([]);
          }}>Merge</button>
          <button disabled={!libItemsSel[0]?.node.repeatKey} onClick={() => setLibSel(flat.filter((i) => i.node.repeatKey && i.node.repeatKey === libItemsSel[0]!.node.repeatKey).map((i) => i.node.wpId))}>Select similar</button>
          <button disabled={!libItemsSel.length} onClick={() => libItemsSel.forEach(placeItem)}>Place selected</button>
          <button disabled={!doc.decomposition.split.length && !doc.decomposition.demoted.length && !doc.decomposition.merged.length && !doc.decomposition.promoted.length} onClick={() => decomp({ split: [], demoted: [], merged: [], promoted: [] })}>Reset edits</button>
        </div>
        <ul className="plain tree">{tree.map((i) => libItem(i))}</ul>
        {selWpId && !flat.some((i) => i.node.wpId === selWpId) && (
          <div className="card">
            <p>Selected element isn't a component.</p>
            {selNode && <button onClick={() => decomp({ promoted: [...doc.decomposition.promoted, selWpId], demoted: doc.decomposition.demoted.filter((x) => x !== selWpId) })}>Make it a component</button>}
          </div>
        )}
        {selWpId && (
          <div className="rules">
            <button onClick={() => { const sl = selectorFor(selWpId); if (sl) recapture({ decomposition: { ...doc.decomposition, rules: [...doc.decomposition.rules, { selector: sl, action: 'component' }] } }); }}>Always a component</button>
            <button onClick={() => { const sl = selectorFor(selWpId); if (sl) recapture({ decomposition: { ...doc.decomposition, rules: [...doc.decomposition.rules, { selector: sl, action: 'ignore' }] } }); }}>Never a component</button>
          </div>
        )}
        {doc.decomposition.rules.length > 0 && (
          <div>
            <h3>Saved rules</h3>
            <ul className="plain">
              {doc.decomposition.rules.map((r, i) => (
                <li key={i}>
                  <code>{r.selector}</code> → {r.action}{' '}
                  <button aria-label={`Delete rule ${r.selector}`} onClick={() => recapture({ decomposition: { ...doc.decomposition, rules: doc.decomposition.rules.filter((_, j) => j !== i) } })}>×</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3>Print presets</h3>
        {(['hideChrome', 'expandInteractive', 'printMedia', 'linkUrls'] as const).map((k) => (
          <label key={k} className="row">
            <input type="checkbox" checked={doc.presets[k]} onChange={(e) => recapture({ presets: { ...doc.presets, [k]: e.target.checked } })} />
            {{ hideChrome: 'Hide sticky bars and cookie banners', expandInteractive: 'Expand tabs, accordions and carousels', printMedia: "Use the site's print styles", linkUrls: 'Show link addresses' }[k]}
          </label>
        ))}
        <label className="row">
          Capture width (px)
          <input type="number" aria-label="Capture width" defaultValue={doc.captureWidthPx} min={200} max={4000} onBlur={(e) => Number(e.target.value) !== doc.captureWidthPx && recapture({ captureWidthPx: Number(e.target.value) })} />
        </label>
      </aside>

      <section className="web-pane" aria-label="Web page">
        <div className="pane-head">
          <div role="tablist" aria-label="Web view">
            <button role="tab" aria-selected={webMode === 'frozen'} onClick={() => setWebMode('frozen')}>Frozen</button>
            <button role="tab" aria-selected={webMode === 'live'} disabled={!project.liveAvailable} onClick={() => setWebMode('live')}>Live</button>
          </div>
          {webMode === 'live' && (
            <>
              <span className="muted">{pendingSteps.length} recorded click{pendingSteps.length === 1 ? '' : 's'}</span>
              <button className="primary" onClick={() => { const steps = [...doc.setupSteps, ...pendingSteps]; setPendingSteps([]); setWebMode('frozen'); recapture({ setupSteps: steps }, 'Capturing this state…'); }}>Capture this state</button>
            </>
          )}
          {webMode === 'frozen' && doc.setupSteps.length > 0 && (
            <button onClick={() => recapture({ setupSteps: [] })}>Clear {doc.setupSteps.length} recorded step(s)</button>
          )}
        </div>
        <div className="web-scroll" ref={webScroll}>
          {(() => {
            const ws = Math.min(1, webW / doc.captureWidthPx);
            const h = webMode === 'frozen' ? Math.max(project.analysis.documentHeightPx, 400) : 900;
            return (
              <div style={{ width: doc.captureWidthPx * ws, height: h * ws, position: 'relative' }}>
                {webMode === 'frozen' ? (
                  <iframe
                    ref={webFrame}
                    title="Frozen web page"
                    className="web-frame"
                    sandbox="allow-same-origin"
                    srcDoc={webSrc}
                    onLoad={onWebLoad}
                    style={{ width: doc.captureWidthPx, height: h, transform: `scale(${ws})`, transformOrigin: '0 0' }}
                  />
                ) : (
                  <iframe title="Live web page" className="web-frame live" sandbox={IS_STATIC ? 'allow-scripts allow-forms allow-same-origin' : 'allow-scripts allow-forms'} src={liveUrl(projectId, (project.meta.source as unknown as { entry?: string }).entry ?? 'index.html')} style={{ width: doc.captureWidthPx, height: h, transform: `scale(${ws})`, transformOrigin: '0 0' }} />
                )}
              </div>
            );
          })()}
        </div>
        {project.analysis.warnings.length > 0 && (
          <details className="warnings">
            <summary>{project.analysis.warnings.length} capture warning(s)</summary>
            <ul>{project.analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="print-pane" aria-label="Print pages" onPointerMove={(e) => drag && drag.kind !== 'place' && onOverlayMove(e, sel?.pageId ?? doc.pages[0]!.id)}>
        <div className="pane-head">
          <span>A4 {doc.pageSetup.orientation} · margins {margins.top}/{margins.right}/{margins.bottom}/{margins.left} mm</span>
          <button onClick={() => commit((d) => ops.addPage(d))}>Add page</button>
          <button onClick={() => commit((d) => ops.setOrientation(d, d.pageSetup.orientation === 'portrait' ? 'landscape' : 'portrait'))}>Rotate pages</button>
          <button onClick={() => commit((d) => ops.addGuide(d, 'x', c.x + c.w / 2))}>+ Vertical guide</button>
          <button onClick={() => commit((d) => ops.addGuide(d, 'y', c.y + c.h / 2))}>+ Horizontal guide</button>
        </div>
        {doc.pages.map((pg, pi) => {
          const placements = doc.placements.filter((p) => p.pageId === pg.id).sort((a, b) => a.z - b.z);
          const pf = proof[pg.id];
          return (
            <div key={pg.id} className="page-wrap">
              <div className="page-head">
                <span>Page {pi + 1}</span>
                {!IS_STATIC && <button onClick={() => doProof(pg.id)} aria-pressed={!!pf}>{pf ? 'Hide proof' : 'Proof'}</button>}
                {pf && (
                  <>
                    <label>Opacity <input type="range" min={0} max={1} step={0.05} value={pf.opacity} onChange={(e) => setProof((p) => ({ ...p, [pg.id]: { ...pf, opacity: Number(e.target.value) } }))} /></label>
                    <label><input type="checkbox" checked={pf.diff} onChange={(e) => setProof((p) => ({ ...p, [pg.id]: { ...pf, diff: e.target.checked } }))} /> Difference</label>
                  </>
                )}
                {doc.pages.length > 1 && <button onClick={() => commit((d) => ops.removePage(d, pg.id))} aria-label={`Delete page ${pi + 1}`}>Delete page</button>}
              </div>
              <div className="ruler-row">
                <div className="ruler-corner" />
                <svg className="ruler ruler-x" data-testid="ruler-x" width={t.width * s} height={18} aria-hidden="true">
                  {Array.from({ length: Math.floor(t.width) + 1 }, (_, i) => (
                    <line key={i} x1={i * s} x2={i * s} y1={18} y2={i % 10 === 0 ? 4 : i % 5 === 0 ? 10 : 14} data-mm={i} />
                  ))}
                  {Array.from({ length: Math.floor(t.width / 10) + 1 }, (_, i) => (
                    <text key={i} x={i * 10 * s + 2} y={10}>{i * 10}</text>
                  ))}
                </svg>
              </div>
              <div className="page-row">
                <svg className="ruler ruler-y" width={18} height={t.height * s} aria-hidden="true">
                  {Array.from({ length: Math.floor(t.height) + 1 }, (_, i) => (
                    <line key={i} y1={i * s} y2={i * s} x1={18} x2={i % 10 === 0 ? 4 : i % 5 === 0 ? 10 : 14} />
                  ))}
                </svg>
                <div className="page" data-page-id={pg.id} style={{ width: t.width * s, height: t.height * s }}>
                  <iframe
                    ref={(el) => {
                      pageFrames.current[pg.id] = el;
                    }}
                    title={`Page ${pi + 1}`}
                    className="page-frame"
                    data-testid={`page-frame-${pi + 1}`}
                    sandbox="allow-same-origin"
                    srcDoc={pageSrc[pg.id]}
                    onLoad={() => onPageLoad(pg.id)}
                    style={{ width: Math.ceil(mmToPx(t.width)), height: Math.ceil(mmToPx(t.height)), transform: zoom === 1 ? undefined : `scale(${zoom})`, pointerEvents: contentPage === pg.id ? 'auto' : 'none' }}
                  />
                  {pf && <img className="proof" src={pf.url} alt={`Server proof of page ${pi + 1}`} style={{ width: t.width * s, height: t.height * s, opacity: pf.opacity, mixBlendMode: pf.diff ? 'difference' : 'normal' }} />}
                  <div
                    className="overlay"
                    data-page-drop={pg.id}
                    style={{ pointerEvents: contentPage === pg.id ? 'none' : undefined }}
                    onPointerDown={(e) => {
                      if (e.target === e.currentTarget) {
                        setSelection([]);
                        setContentEdit(null);
                        setContentTarget(null);
                        const f = pageFrames.current[pg.id];
                        if (f) selectWp(wpIdAtPoint(f, e.clientX, e.clientY));
                      }
                    }}
                    onPointerMove={(e) => drag && drag.kind !== 'place' && onOverlayMove(e, pg.id)}
                    onPointerUp={onOverlayUp}
                  >
                    <div className="content-box" style={{ left: cDraft.x * s, top: cDraft.y * s, width: cDraft.w * s, height: cDraft.h * s }} />
                    {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                      const style =
                        side === 'top' ? { left: 0, right: 0, top: cDraft.y * s - 3, height: 6 } :
                        side === 'bottom' ? { left: 0, right: 0, top: (cDraft.y + cDraft.h) * s - 3, height: 6 } :
                        side === 'left' ? { top: 0, bottom: 0, left: cDraft.x * s - 3, width: 6 } :
                        { top: 0, bottom: 0, left: (cDraft.x + cDraft.w) * s - 3, width: 6 };
                      return (
                        <div
                          key={side}
                          className={`margin-handle m-${side}`}
                          data-testid={`margin-${side}`}
                          role="slider"
                          aria-label={`${side} margin`}
                          aria-valuenow={margins[side]}
                          style={style}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            (e.target as Element).setPointerCapture?.(e.pointerId);
                            setDrag({ kind: 'margin', side, startX: e.clientX, startY: e.clientY, value: doc.pageSetup.marginsMm[side], orig: doc.pageSetup.marginsMm[side] });
                          }}
                        />
                      );
                    })}
                    {doc.showGrid && gridColumnsMm(doc.pageSetup).map((col, i) => (
                      <div key={i} className="grid-col" style={{ left: col.x * s, top: c.y * s, width: col.w * s, height: c.h * s }} />
                    ))}
                    {doc.guides.map((g) => (
                      <div
                        key={g.id}
                        className={`guide g-${g.axis}`}
                        style={g.axis === 'x' ? { left: g.posMm * s, top: 0, bottom: 0 } : { top: g.posMm * s, left: 0, right: 0 }}
                        title={`${g.posMm} mm (double-click to remove)`}
                        onDoubleClick={() => commit((d) => ops.removeGuide(d, g.id))}
                      />
                    ))}
                    {placements.map((p) => {
                      const r = draftRect(p);
                      const isSel = selection.includes(p.id);
                      const def = doc.components[p.componentId];
                      return (
                        <div
                          key={p.id}
                          className={`box${isSel ? ' sel' : ''}${p.locked ? ' locked' : ''}${contentEdit === p.id ? ' editing' : ''}`}
                          data-placement-box={p.id}
                          aria-label={`${def?.name ?? p.componentId} frame`}
                          style={{ left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s, transform: p.rotationDeg ? `rotate(${p.rotationDeg}deg)` : undefined, pointerEvents: contentEdit === p.id ? 'none' : undefined }}
                          onPointerDown={(e) => onBoxDown(e, p, pageFrames.current[pg.id] ?? null)}
                          onDoubleClick={() => {
                            setContentEdit(p.id);
                            setSelection([p.id]);
                          }}
                        >
                          {inMargin.has(p.id) && <span className="warn-badge" title="Extends into the margin">!</span>}
                          {overflow[p.id] && <span className="overflow-badge" title="Content doesn't fit this frame" data-testid={`overflow-${p.id}`}>+</span>}
                          {p.chainId && <span className="chain-badge" title="Linked frame">⛓</span>}
                          {isSel && !p.locked && contentEdit !== p.id &&
                            (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Handle[]).map((h) => (
                              <span key={h} className={`handle h-${h}`} data-handle={h} onPointerDown={(e) => onHandleDown(e, p, h)} />
                            ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <aside className="inspector" aria-label="Inspector">
        <h2>Page setup</h2>
        <div className="margins">
          {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
            <label key={k}>
              {k}
              <input
                type="number"
                step={0.5}
                min={0}
                aria-label={`${k} margin (mm)`}
                key={`${k}-${doc.pageSetup.marginsMm[k]}`}
                defaultValue={doc.pageSetup.marginsMm[k]}
                onBlur={(e) => Number(e.target.value) !== doc.pageSetup.marginsMm[k] && commit((d) => ops.setMargins(d, { ...d.pageSetup.marginsMm, [k]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>

        {sel && selDef && (
          <>
            <h2>{selDef.name}</h2>
            <div className="fields">
              {(['xMm', 'yMm', 'wMm', 'hMm'] as const).map((k) => (
                <label key={k}>
                  {k[0]!.toUpperCase()}
                  <input
                    type="number"
                    step={0.1}
                    aria-label={`${k[0]} (mm)`}
                    key={`${sel.id}-${k}-${sel[k]}`}
                    defaultValue={r2(sel[k])}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v === r2(sel[k])) return;
                      commit((d) => ops.setPlacementRect(d, sel.id, { x: k === 'xMm' ? v : sel.xMm, y: k === 'yMm' ? v : sel.yMm, w: k === 'wMm' ? v : sel.wMm, h: k === 'hMm' ? v : sel.hMm }));
                    }}
                  />
                </label>
              ))}
              <label>
                Rotate
                <input type="number" step={1} aria-label="Rotation (degrees)" key={`${sel.id}-rot-${sel.rotationDeg}`} defaultValue={sel.rotationDeg} onBlur={(e) => commit((d) => ops.updatePlacement(d, sel.id, { rotationDeg: Number(e.target.value) }))} />
              </label>
              <label>
                Fit
                <select aria-label="Fit" value={sel.fit} disabled={!!sel.chainId} onChange={(e) => commit((d) => ops.updatePlacement(d, sel.id, { fit: e.target.value as Placement['fit'] }))}>
                  <option value="reflow">Reflow</option>
                  <option value="scale">Scale</option>
                  <option value="crop">Crop</option>
                </select>
              </label>
              <label className="row">
                <input type="checkbox" checked={sel.locked} onChange={(e) => commit((d) => ops.updatePlacement(d, sel.id, { locked: e.target.checked }))} /> Locked
              </label>
            </div>
            <p className="readout" data-testid="point-size">Smallest text on paper: {minFontPt(selDef, sel) ?? '–'} pt</p>
            {inMargin.has(sel.id) && <p className="warn">This frame extends into the margin.</p>}
            {overflow[sel.id] && <p className="warn">Content doesn't fit this frame.</p>}
            <div className="btns">
              {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as ops.Align[]).map((a) => (
                <button key={a} onClick={() => commit((d) => ops.align(d, selection, a))} aria-label={`Align ${a}`}>{{ left: '⇤', hcenter: '↔', right: '⇥', top: '⤒', vcenter: '↕', bottom: '⤓' }[a]}</button>
              ))}
              <button disabled={selection.length < 3} onClick={() => commit((d) => ops.distribute(d, selection, 'x'))}>Distribute ↔</button>
              <button disabled={selection.length < 3} onClick={() => commit((d) => ops.distribute(d, selection, 'y'))}>Distribute ↕</button>
              <button onClick={() => commit((d) => ops.bringToFront(d, selection))}>Front</button>
              <button onClick={() => commit((d) => ops.sendToBack(d, selection))}>Back</button>
              <button disabled={selection.length < 2} onClick={() => commit((d) => ops.group(d, selection))}>Group</button>
              <button disabled={!sel.groupId} onClick={() => commit((d) => ops.ungroup(d, selection))}>Ungroup</button>
              <button onClick={() => (commit((d) => ops.deletePlacements(d, selection)), setSelection([]))}>Delete</button>
            </div>
            <div className="btns">
              <button onClick={flowOntoPages} disabled={!!sel.chainId}>Flow onto pages</button>
              <button onClick={linkSelected} disabled={selection.length < 2}>Link frames</button>
              {sel.chainId && <button onClick={() => commit((d) => ops.unlinkChain(d, sel.chainId!))}>Unlink</button>}
              <button onClick={() => { setContentEdit(sel.id); }}>Edit content</button>
            </div>
          </>
        )}

        {contentPlacement && (
          <div className="content-tools">
            <h2>Editing content</h2>
            <p className="muted">Click text to edit it. Press Esc or Done to finish.</p>
            <button className="primary" onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); pageFrames.current[contentPlacement.pageId]?.contentDocument?.querySelectorAll('iframe.ve-inner').forEach((f) => ((f as HTMLIFrameElement).contentDocument?.activeElement as HTMLElement | null)?.blur?.()); setTimeout(() => { setContentEdit(null); setContentTarget(null); }, 0); }}>Done editing</button>
            {contentTarget && targetEl && (
              <>
                <p>
                  Selected: <code>{targetEl.tagName.toLowerCase()}</code>
                </p>
                <button
                  onClick={() => commit((d) => ops.setOverride(d, { id: ops.newId('ov'), componentId: contentPlacement.componentId, type: 'visibility', target: contentTarget, hidden: true }))}
                >
                  Hide element
                </button>
                <div className="fields">
                  {[
                    ['font-size', 'Font size'],
                    ['line-height', 'Line height'],
                    ['letter-spacing', 'Letter spacing'],
                    ['font-weight', 'Weight'],
                    ['color', 'Colour'],
                    ['background-color', 'Background'],
                  ].map(([prop, label]) => {
                    const cur = doc.overrides.find((o) => o.type === 'style' && o.target === contentTarget && o.prop === prop) as Extract<Override, { type: 'style' }> | undefined;
                    return (
                      <label key={prop}>
                        {label}
                        <input aria-label={label} key={`${contentTarget}-${prop}-${cur?.value}`} defaultValue={cur?.value ?? ''} placeholder="(as web)" onBlur={(e) => e.target.value !== (cur?.value ?? '') && setStyleOverride(prop!, e.target.value.trim())} />
                      </label>
                    );
                  })}
                </div>
                {targetEl.tagName === 'IMG' && (
                  <div className="fields">
                    <label>
                      Replace image
                      <input
                        type="file"
                        accept="image/*"
                        aria-label="Replace image"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const src = await new Promise<string>((res) => {
                            const r = new FileReader();
                            r.onload = () => res(String(r.result));
                            r.readAsDataURL(f);
                          });
                          const cur = doc.overrides.find((o) => o.type === 'asset' && o.target === contentTarget) as Extract<Override, { type: 'asset' }> | undefined;
                          commit((d) => ops.setOverride(d, { ...(cur ?? {}), id: ops.newId('ov'), componentId: contentPlacement.componentId, type: 'asset', target: contentTarget, src }));
                        }}
                      />
                    </label>
                    {(['focalX', 'focalY'] as const).map((k) => {
                      const cur = doc.overrides.find((o) => o.type === 'asset' && o.target === contentTarget) as Extract<Override, { type: 'asset' }> | undefined;
                      return (
                        <label key={k}>
                          {k === 'focalX' ? 'Focus X %' : 'Focus Y %'}
                          <input type="range" min={0} max={100} aria-label={k} value={cur?.[k] ?? 50} onChange={(e) => commit((d) => ops.setOverride(d, { ...(cur ?? { objectFit: 'cover' }), id: ops.newId('ov'), componentId: contentPlacement.componentId, type: 'asset', target: contentTarget, [k]: Number(e.target.value) } as Override))} />
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <h2>Print changes ({doc.overrides.length})</h2>
        <ul className="plain overrides">
          {doc.overrides.map((o) => (
            <li key={o.id} data-override={o.id}>
              <span>
                {doc.components[o.componentId]?.name}: {o.type === 'text' ? `text “${o.value.slice(0, 30)}”` : o.type === 'style' ? `${o.prop}: ${o.value}` : o.type === 'visibility' ? 'hidden' : 'image'}
              </span>
              <button aria-label="Revert change" onClick={() => commit((d) => ops.revertOverride(d, o.id))}>Revert</button>
            </li>
          ))}
        </ul>
        {doc.overrides.length > 0 && <button onClick={() => commit((d) => ops.revertAllOverrides(d))}>Revert all</button>}

        <h2>Snapshots</h2>
        <div className="row">
          <input aria-label="Snapshot name" placeholder="Name" value={snapName} onChange={(e) => setSnapName(e.target.value)} />
          <button onClick={async () => { await api.save(projectId, doc); const sn = await api.snapshot(projectId, snapName); setProject({ ...project, snapshots: [...project.snapshots, sn] }); setSnapName(''); }}>Save</button>
        </div>
        <ul className="plain">
          {project.snapshots.map((sn) => (
            <li key={sn.id}>
              {sn.name} <button onClick={async () => replaceDoc((await api.restore(projectId, sn.id)).document)}>Restore</button>
            </li>
          ))}
        </ul>
      </aside>

      {hl.web && <div className="hl hl-web" data-testid="hl-web" style={{ left: hl.web.x, top: hl.web.y, width: hl.web.w, height: hl.web.h }} />}
      {hl.print.map((r, i) => (
        <div key={i} className="hl hl-print" data-testid="hl-print" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
      ))}
      {drag?.kind === 'place' && (
        <div className="ghost" style={{ left: drag.x + 8, top: drag.y + 8 }}>
          {drag.label}
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export { pxToMm };
