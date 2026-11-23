/** True in the browser-only build published to GitHub Pages. */
export const IS_STATIC = typeof __STATIC__ !== 'undefined' && __STATIC__ === true;

/** Folder the static app is served from, e.g. https://user.github.io/static-conversion/ */
export const appBase = () => new URL('.', location.href.split('#')[0]).href;

/** URL a stored project file is served at by the service worker (with capture helpers injected). */
export const vfsUrl = (projectId: string, rel: string, mode: 'vfs' | 'live' = 'vfs') =>
  `${appBase()}${mode}/${projectId}/${rel.split('/').map(encodeURIComponent).join('/')}`;
