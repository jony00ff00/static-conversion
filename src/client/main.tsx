import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Editor } from './Editor.js';

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
      history.pushState(null, '', `/project/${p.meta.id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const onZip = async (f: File | undefined) => {
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    await go('Importing zip…', { type: 'zip', base64: btoa(bin), title: f.name });
  };

  return (
    <main className="home">
      <h1>Static Conversion</h1>
      <p className="muted">Turn a web page into print-ready A4 pages.</p>
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
          <label>Zip file<input type="file" accept=".zip" aria-label="Zip file" onChange={(e) => onZip(e.target.files?.[0])} /></label>
          <label>Web address<input type="url" aria-label="Web address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <button disabled={!!busy || !url} onClick={() => go('Recording page…', { type: 'url', url })}>Import from URL</button>
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
                <a href={`/project/${p.id}`}>{p.title}</a> <span className="muted">{new Date(p.createdAt).toLocaleString()}</span>
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
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const m = /^\/project\/([a-z0-9-]+)/.exec(path);
  return m ? <Editor projectId={m[1]!} /> : <Home />;
}

createRoot(document.getElementById('root')!).render(<App />);
