/**
 * Minimal hash-based routing. The app has no server-side routes, so the URL
 * hash (`#<app>/<tab>`) is used for deep-linking and to survive a browser
 * refresh without losing the active workspace.
 */

export function readHash(): { app: string; tab: string } {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  const clean = raw.split('?')[0];
  const [app = '', tab = ''] = clean.split('/');
  return { app, tab };
}

export function setHash(app: string, tab?: string): void {
  if (typeof window === 'undefined') return;
  const target = tab ? `#${app}/${tab}` : `#${app}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
