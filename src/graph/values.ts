/** Values that travel along connections, one per port type. */
import type { Analysis, ComponentDef, DecompositionSettings, EditorDocument, Override, Presets, SetupStep } from '../model/types.js';

/** `files`: an imported page. `sourceId` "main" is the project's own page (the Editor tab's). */
export interface FilesValue {
  sourceId: string;
  title: string;
  /** Entry HTML file inside the source. */
  entry: string;
}

export interface CaptureSettings {
  captureWidthPx: number;
  presets: Presets;
  setupSteps: SetupStep[];
  /** Saved component rules: CSS selector → always / never a component (applied while capturing). */
  rules: DecompositionSettings['rules'];
}

/** `capture`: a frozen page and what decomposition found in it. */
export interface CaptureValue {
  sourceId: string;
  /** Identifies this capture (source + settings); components refer to it. */
  key: string;
  settings: CaptureSettings;
  analysis: Analysis;
  frozenHtml: string;
  bodyWpId: string;
  /** Base URL the editor loads the page's images, styles and fonts from. */
  baseUrl: string;
  presetReport?: { hidden: number; expanded: number; links: number } | null;
}

/** `components`: components cut from one capture, in order, with their content edits. */
export interface ComponentSet {
  capture: CaptureValue;
  items: ComponentDef[];
  overrides: Override[];
}

/** `pages`: laid-out pages. Until Layout nodes are editable (N4), the Editor tab's document. */
export interface PagesValue {
  document: EditorDocument;
  capture: CaptureValue;
}

/** Decomposition settings the Components node owns (rules belong to the capture). */
export type LibrarySettings = Omit<DecompositionSettings, 'rules'>;

/** What the Editor tab currently holds, for nodes linked to it. */
export interface ProjectSnapshot {
  title: string;
  document: EditorDocument;
  capture: CaptureValue;
}
