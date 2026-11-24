/**
 * Editor document model, shared by the browser editor and the server.
 * All geometry on pages is in mm from the top-left of the trim.
 */
import type { PageSetup } from '../schema/document.js';

export type Fit = 'reflow' | 'scale' | 'crop';

/** A candidate component found by decomposition (one per scored element). */
export interface AnalysisNode {
  wpId: string;
  parentWpId: string | null; // nearest ancestor that is also a candidate
  depth: number; // 1 = top level
  tag: string;
  kind: ComponentKind;
  name: string;
  score: number;
  /** Border box in CSS px, relative to the document, at the capture width. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Effective background colour behind the element (first opaque ancestor). */
  bg: string;
  /** Siblings with the same structure share a key (e.g. a row of cards). */
  repeatKey: string | null;
  /** Smallest font size inside the element, CSS px. */
  minFontPx: number | null;
  atomic: boolean; // media: children are never components
}

export type ComponentKind =
  | 'header'
  | 'nav'
  | 'footer'
  | 'section'
  | 'card'
  | 'media'
  | 'table'
  | 'text'
  | 'list'
  | 'group'
  | 'page';

export interface Analysis {
  captureWidthPx: number;
  documentHeightPx: number;
  baseUrl: string;
  pageBg: string;
  nodes: AnalysisNode[];
  warnings: string[];
}

/** A component placed (or placeable) in the document. Stable once created. */
export interface ComponentDef {
  id: string;
  name: string;
  kind: ComponentKind;
  /** Element whose subtree is the component ('page' = the whole body). */
  rootWpId: string;
  /** For merged components: only these children of the root stay visible. */
  showWpIds?: string[];
  /** Natural size at the capture width, CSS px. */
  widthPx: number;
  heightPx: number;
  bg: string;
  minFontPx: number | null;
}

export type Override =
  | { id: string; componentId: string; type: 'text'; target: string; value: string; original: string }
  | { id: string; componentId: string; type: 'style'; target: string; prop: string; value: string }
  | { id: string; componentId: string; type: 'visibility'; target: string; hidden: boolean }
  | {
      id: string;
      componentId: string;
      type: 'asset';
      target: string;
      src?: string;
      objectFit?: 'cover' | 'contain' | 'fill';
      focalX?: number; // 0–100 %
      focalY?: number;
    };

export interface Flow {
  /** All frames in a chain share the id; order = position in `frames`. */
  chainId: string;
}

export interface Placement {
  id: string;
  componentId: string;
  pageId: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  rotationDeg: number;
  z: number;
  fit: Fit;
  /** Crop offset in CSS px of the component (crop mode). */
  cropXPx?: number;
  cropYPx?: number;
  /** Crop mode: scale of the component inside the frame (default 1). */
  cropScale?: number;
  /** Crop mode: width the component is laid out at, CSS px (default: its captured width). */
  cropLayoutPx?: number;
  locked: boolean;
  groupId?: string;
  /** Part of a flow chain (auto-paginate / linked frames). */
  chainId?: string;
}

/** Computed slice of a flowed component shown in one frame. */
export interface FlowSlice {
  placementId: string;
  startPx: number;
  endPx: number;
  /** Repeated table header shown at the top of this frame. */
  header?: { startPx: number; endPx: number };
  overflow: boolean;
}

export interface Chain {
  id: string;
  componentId: string;
  placementIds: string[];
  slices: FlowSlice[];
}

export interface Guide {
  id: string;
  axis: 'x' | 'y';
  posMm: number;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  document: EditorDocument;
}

export interface Presets {
  hideChrome: boolean;
  expandInteractive: boolean;
  printMedia: boolean;
  linkUrls: boolean;
}

export const DEFAULT_PRESETS: Presets = { hideChrome: true, expandInteractive: true, printMedia: false, linkUrls: false };

export interface DecompositionSettings {
  /** 1 = top-level sections only … 4 = down to text blocks. */
  granularity: number;
  /** Saved rules: CSS selector → always a component / never a component. */
  rules: Array<{ selector: string; action: 'component' | 'ignore' }>;
  /** Manual edits on top of the automatic tree. */
  split: string[]; // wpIds whose children are shown instead
  promoted: string[]; // wpIds forced to be components
  demoted: string[]; // wpIds removed from the tree
  merged: Array<{ id: string; rootWpId: string; wpIds: string[] }>;
}

export interface EditorDocument {
  schemaVersion: 2;
  pageSetup: PageSetup;
  pages: Array<{ id: string }>;
  components: Record<string, ComponentDef>;
  placements: Placement[];
  chains: Chain[];
  overrides: Override[];
  guides: Guide[];
  decomposition: DecompositionSettings;
  presets: Presets;
  captureWidthPx: number;
  /** Recorded interactions replayed before capture ("Capture this state"). */
  setupSteps: Array<{ action: 'click'; selector: string }>;
  showGrid: boolean;
}
