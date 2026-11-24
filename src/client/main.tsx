import { createRoot } from 'react-dom/client';
import { zipSync } from 'fflate';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Editor } from './Editor.js';
import { currentProjectId, goToProject, projectHref } from './nav.js';
import { IS_STATIC, appBase } from '../static/env.js';
import { UNSUPPORTED_URL } from '../static/backend.js';
import { arrangeLooseFiles } from '../import/pure.js';

function Home() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; title: string; createdAt: string }>>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [html, setHtml] = useState('<h1>Hello</h1>\n<p>Paste your HTML here.</p>');
  const [css, setCss] = useState('');
  const [js, setJs] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    api.fixtures().then(setFixtures).catch((e) => setError(String(e)));
    api.projects().then(setProjects).catch(() => undefined);
  }, []);

  const go = async (label: string, input: Record<string, unknown>) => {
    setBusy(label);
    setError('');
    try {
      const p = await api.create(input);
      goToProject(p.meta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const toBase64 = (buf: Uint8Array) => {
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  /** A .zip, or .html file(s) with any CSS, JS, images and fonts they use (packed into a zip). */
  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) {
      const f = files[0]!;
      return go('Importing zip…', { type: 'zip', base64: toBase64(new Uint8Array(await f.arrayBuffer())), title: f.name });
    }
    const html = files.find((f) => /\.html?$/i.test(f.name));
    if (!html) {
      setError('Choose a .zip, or at least one .html file (with its CSS, JavaScript and images if it uses them).');
      return;
    }
    const loose: Record<string, Uint8Array> = {};
    for (const f of files) loose[f.name] = new Uint8Array(await f.arrayBuffer());
    // Put stylesheets, scripts and images where the page links them.
    const entries = arrangeLooseFiles(loose);
    await go(`Importing ${html.name}…`, { type: 'zip', base64: toBase64(zipSync(entries)), title: html.name });
  };

  return (
    <main className="home">
      <h1>Static Conversion</h1>
      <p className="muted">Turn a web page into print-ready A4 pages.</p>
      {IS_STATIC && (
        <p className="notice" data-testid="static-notice">
          Browser-only version: your projects stay in this browser. Importing from a web address, the Proof overlay and exact
          PDF files need the <a href="https://github.com/jony00ff00/static-conversion#readme">local version</a>; here, export
          opens the print dialog (choose “Save as PDF”, paper A4, margins none).
        </p>
      )}
      {busy && <p role="status" className="status">{busy}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <section className="home-grid">
        <div className="card">
          <h2>Paste code</h2>
          <label>HTML<textarea aria-label="HTML" value={html} onChange={(e) => setHtml(e.target.value)} rows={6} /></label>
          <label>CSS<textarea aria-label="CSS" value={css} onChange={(e) => setCss(e.target.value)} rows={3} /></label>
          <label>JavaScript<textarea aria-label="JavaScript" value={js} onChange={(e) => setJs(e.target.value)} rows={3} /></label>
          <button disabled={!!busy} onClick={() => go('Importing…', { type: 'paste', html, css, js })}>Import pasted code</button>
        </div>
        <div className="card">
          <h2>Upload or link</h2>
          <label>
            HTML or zip file
            <input
              type="file"
              multiple
              accept=".html,.htm,.zip,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.woff,.woff2,.ttf,.otf"
              aria-label="HTML or zip file"
              onChange={(e) => {
                const input = e.currentTarget;
                void onFiles(input.files).finally(() => (input.value = ''));
              }}
            />
          </label>
          <p className="muted small">An .html file, optionally selected together with its CSS, JavaScript and images; or a .zip of the whole site.</p>
          <label>Web address<input type="url" aria-label="Web address" placeholder="https://…" value={url} disabled={IS_STATIC} onChange={(e) => setUrl(e.target.value)} /></label>
          <button disabled={!!busy || !url || IS_STATIC} onClick={() => go('Recording page…', { type: 'url', url })}>Import from URL</button>
          {IS_STATIC && <p className="muted small">{UNSUPPORTED_URL}</p>}
        </div>
        <div className="card">
          <h2>Test pages</h2>
          <ul className="plain">
            {fixtures.map((f) => (
              <li key={f}>
                <button className="link" disabled={!!busy} onClick={() => go(`Importing ${f}…`, { type: 'fixture', name: f })} data-fixture={f}>
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Recent projects</h2>
          <ul className="plain">
            {projects.slice(0, 12).map((p) => (
              <li key={p.id}>
                <a href={projectHref(p.id)}>{p.title}</a> <span className="muted">{new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {!projects.length && <li className="muted">None yet.</li>}
          </ul>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [projectId, setProjectId] = useState(currentProjectId);
  useEffect(() => {
    const on = () => setProjectId(currentProjectId());
    addEventListener('popstate', on);
    addEventListener('hashchange', on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener('hashchange', on);
    };
  }, []);
  return projectId ? <Editor key={projectId} projectId={projectId} /> : <Home />;
}

/** Static build: imported files are served to the capture frames by a service worker. */
async function startServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers, which the browser-only version needs.');
  await navigator.serviceWorker.register(`${appBase()}sw.js`, { scope: appBase() });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      setTimeout(resolve, 3_000);
    });
  }
  if (!navigator.serviceWorker.controller) location.reload();
}

const root = createRoot(document.getElementById('root')!);
if (IS_STATIC) {
  startServiceWorker().then(
    () => root.render(<App />),
    (e) => root.render(<main className="home"><p role="alert" className="error">{(e as Error).message}</p></main>),
  );
} else {
  root.render(<App />);
}
