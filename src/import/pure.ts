/**
 * Import helpers with no Node or browser dependencies, shared by the server
 * and the static (GitHub Pages) build.
 */

/** Limits for zip imports (protect against zip bombs and junk uploads). */
export const ZIP_LIMITS = {
  maxFiles: 5_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
} as const;

/**
 * Build a full document from pasted code. `html` may be a full document or a
 * fragment; `css` is added as a <style> at the end of <head>, `js` as a
 * <script> at the end of <body>.
 */
export function buildPastedHtml(input: { html: string; css?: string; js?: string }): string {
  let html = input.html.trim();
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Pasted</title></head>\n<body>\n${html}\n</body>\n</html>`;
  } else if (!/<!doctype/i.test(html)) {
    html = `<!DOCTYPE html>\n${html}`;
  }
  if (!/<head[\s>]/i.test(html)) html = html.replace(/<html([^>]*)>/i, '<html$1><head><meta charset="utf-8"></head>');
  if (input.css) {
    const style = `<style data-ve-pasted>\n${input.css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
    html = html.replace(/<\/head>/i, `${style}\n</head>`);
  }
  if (input.js) {
    const script = `<script data-ve-pasted>\n${input.js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}\n</body>`) : html + script;
  }
  return html;
}

/** Reject absolute paths, drive letters and any `..` segment (zip-slip). */
export function safeZipPath(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/**
 * Pick the entry HTML file from relative paths ('/'-separated): index.html at
 * the root, else index.html in the only top-level folder, else the shallowest
 * .html file (alphabetical).
 */
export function pickEntry(htmls: string[]): string | null {
  if (!htmls.length) return null;
  const depth = (p: string) => p.split('/').length;
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  const index = htmls.filter((p) => /^index\.html?$/i.test(base(p))).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  if (index[0] && depth(index[0]) <= 2) return index[0];
  return [...htmls].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]!;
}
