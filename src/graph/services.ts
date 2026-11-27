/**
 * What graph nodes need from outside the pure engine. The editor supplies these
 * (capture on the server or in a browser iframe, HTML parsing with DOMParser);
 * tests supply their own.
 */
import type { CaptureSettings, CaptureValue, FilesValue } from './values.js';
import type { FlowLayout } from '../flow/breaks.js';

export interface GraphServices {
  /** Capture a source page with these settings (may be slow; the evaluator caches results). */
  capture(files: FilesValue, settings: CaptureSettings): Promise<Omit<CaptureValue, 'key' | 'settings' | 'sourceId'>>;
  /** Parse HTML into a DOM document, for CSS selectors (DOMParser in a browser). */
  parseHtml(html: string): Document;
  /** Where an isolated component can break across frames, laid out at exactly `widthPx` (flow layout). */
  measureFlow(isolatedHtml: string, widthPx: number): Promise<FlowLayout>;
}
