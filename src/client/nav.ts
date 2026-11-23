/** URLs inside the app: paths on the dev server, hash routes on GitHub Pages. */
import { IS_STATIC } from '../static/env.js';

export const homeHref = () => (IS_STATIC ? '#/' : '/');
export const projectHref = (id: string) => (IS_STATIC ? `#/project/${id}` : `/project/${id}`);

export function currentProjectId(): string | null {
  const route = IS_STATIC ? location.hash.replace(/^#/, '') : location.pathname;
  return /^\/project\/([a-z0-9-]+)/.exec(route)?.[1] ?? null;
}

export function goToProject(id: string) {
  if (IS_STATIC) {
    location.hash = `/project/${id}`;
  } else {
    history.pushState(null, '', `/project/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }
}
