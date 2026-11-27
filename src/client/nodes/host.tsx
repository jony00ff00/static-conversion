/** What the Nodes tab gets from the editor around it (the Editor tab's project, and switching tabs). */
import { createContext, useContext } from 'react';
import type { EditorDocument } from '../../model/types.js';
import { api } from '../api.js';
import type { GraphServices } from './engine.js';
import { measureFlowInBrowser } from '../../static/capture.js';

export interface NodesHost {
  projectId: string;
  /** The Editor tab's document (linked nodes read their settings from it). */
  document: EditorDocument;
  /** Entry page of the project's own source (for its live view). */
  mainEntry: string;
  /** Switch to the Editor tab, on the project's pages or a Layout node's. */
  openEditor(layoutId?: string): void;
  /** Re-capture the project page with new settings, as the Editor tab does (for linked Capture nodes). */
  recaptureProject(patch: Partial<EditorDocument>): Promise<void>;
}

export const HostContext = createContext<NodesHost | null>(null);

export function useHost(): NodesHost {
  const h = useContext(HostContext);
  if (!h) throw new Error('The Nodes tab needs its host');
  return h;
}

/** Capture and parsing for the graph, through the editor's API (server or browser build). */
export function clientServices(projectId: string): GraphServices {
  return {
    async capture(files, settings) {
      const c = await api.captureSource(projectId, files.sourceId, settings);
      return {
        analysis: c.analysis,
        frozenHtml: c.frozenHtml,
        bodyWpId: c.bodyWpId,
        presetReport: c.presetReport,
        baseUrl: api.sourceBaseUrl(projectId, files.sourceId, c.analysis.baseUrl),
      };
    },
    parseHtml: (html) => new DOMParser().parseFromString(html, 'text/html'),
    measureFlow: (html, widthPx) => measureFlowInBrowser(html, widthPx),
  };
}
