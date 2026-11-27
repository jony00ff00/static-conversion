import { DEFAULT_PRESETS } from '../../model/types.js';
import { hashValue } from '../hash.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { CaptureSettings, CaptureValue, FilesValue } from '../values.js';

/**
 * `linked`: use the Editor tab's capture of the project's page (and its settings), so both tabs show the same
 * thing. Unlinked: capture with this node's own settings.
 */
export interface CaptureConfig extends CaptureSettings {
  linked: boolean;
}

export const capture: NodeDefinition<CaptureConfig> = {
  type: 'capture',
  label: 'Capture',
  description: 'Renders the page offline, freezes it and finds its components',
  inputs: [{ name: 'files', type: 'files', label: 'Page' }],
  outputs: [{ name: 'capture', type: 'capture', label: 'Capture' }],
  defaultConfig: () => ({ linked: false, captureWidthPx: 680, presets: { ...DEFAULT_PRESETS }, setupSteps: [], rules: [] }),
  dependencies: (config, ctx) => (config.linked ? ctx.project?.capture.key : undefined),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const files = inputs.files as FilesValue;
    const warnings: string[] = [];
    if (config.linked) {
      if (files.sourceId === 'main' && ctx.project) {
        const c = ctx.project.capture;
        return { outputs: { capture: c }, warnings: c.analysis.warnings, info: infoOf(c) };
      }
      warnings.push('Only the project page can use the Editor tab’s capture; captured with this node’s settings instead.');
    }
    const { linked: _linked, ...settings } = config;
    void _linked;
    const out = await ctx.services.capture(files, settings);
    const value: CaptureValue = { ...out, sourceId: files.sourceId, settings, key: hashValue({ source: files.sourceId, entry: files.entry, settings }) };
    return { outputs: { capture: value }, warnings: [...warnings, ...out.analysis.warnings], info: infoOf(value) };
  },
};

const infoOf = (c: CaptureValue) => ({
  width: `${c.analysis.captureWidthPx} px`,
  height: `${Math.round(c.analysis.documentHeightPx)} px`,
  elements: c.analysis.nodes.length,
});
