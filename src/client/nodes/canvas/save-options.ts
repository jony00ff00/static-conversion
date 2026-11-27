// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/ui/canvas/save-options.ts at c22a45d.
// What the project file's "save as" dialog is asked for. In its own file, with no React, so tests can hand the
// very same options to a real browser.

export const PROJECT_EXTENSION = '.web2print.json';

/**
 * The browser's "save as" dialog takes only simple extensions in its file types: a dot, then letters, digits or
 * "+" (Chromium refuses ".web2print.json" for its "-"). So the type is ".json"; the suggested name still ends in
 * ".web2print.json", which also ends in ".json".
 */
export const PROJECT_FILE_TYPES = [{ description: 'Static Conversion graph', accept: { 'application/json': ['.json'] } }];

export const savePickerOptions = (suggestedName: string) => ({ suggestedName, types: PROJECT_FILE_TYPES });
