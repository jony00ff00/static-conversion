// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/ui/canvas/SaveDialog.tsx at c22a45d, reworded for graph files.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { editorStore } from '../store.js';
import { download } from '../download.js';

import { PROJECT_EXTENSION, savePickerOptions } from './save-options.js';

export { PROJECT_EXTENSION };

const NAME_KEY = 'static-conversion:graph-name';

/** The browser's "save as" dialog (Chromium-based browsers): lets people pick the folder and confirm. */
interface SaveFilePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/** A file name from what was typed: no characters file systems refuse, and the project extension. */
export function projectFileName(input: string): string {
  const base = input
    .trim()
    .replace(/\.web2print\.json$|\.json$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  return `${base || 'graph'}${PROJECT_EXTENSION}`;
}

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'graph';
  } catch {
    return 'graph';
  }
}

/** Name the project file and choose where it goes before it is saved. */
export function SaveDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(rememberedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const picker = (window as SaveFilePicker).showSaveFilePicker;
  const fileName = projectFileName(name);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const content = editorStore.getState().exportProject();
    let saved = fileName;
    if (picker) {
      setBusy(true);
      setError(undefined);
      try {
        const handle = await picker.call(window, savePickerOptions(fileName));
        const writable = await handle.createWritable();
        await writable.write(new Blob([content], { type: 'application/json' }));
        await writable.close();
        saved = handle.name;
      } catch (err) {
        setBusy(false);
        // Cancelled in the browser's dialog: stay here so the name can be changed or the save cancelled.
        if ((err as Error).name !== 'AbortError') setError(`Could not save: ${(err as Error).message}`);
        return;
      }
    } else {
      download(fileName, content, 'application/json');
    }
    try {
      localStorage.setItem(NAME_KEY, saved.replace(/\.web2print\.json$|\.json$/i, ''));
    } catch {
      // not remembered
    }
    editorStore.getState().notify('info', `Saved the graph as “${saved}”`);
    onClose();
  };

  return (
    <dialog ref={dialog} className="save-dialog" aria-labelledby="save-dialog-title" onCancel={onClose}>
      <form method="dialog" onSubmit={save}>
        <h3 id="save-dialog-title">Save graph file</h3>
        <p className="muted small">The graph in one file you can open again later. Pages imported into Web Source nodes stay in this project.</p>
        <label className="field">
          <span className="field-label">File name</span>
          <span className="file-name-input">
            <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} aria-describedby="save-dialog-file" />
            <span className="muted">{PROJECT_EXTENSION}</span>
          </span>
        </label>
        <p id="save-dialog-file" className="hint">
          Saved as <strong>{fileName}</strong>
        </p>
        <p className="hint">
          {picker
            ? 'Next, choose the folder in your browser’s save dialog and confirm there.'
            : 'Your browser saves it to its downloads folder, or asks where if it is set up to.'}
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="button-row dialog-buttons">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {picker ? 'Choose location and save…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
