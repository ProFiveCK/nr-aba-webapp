import { findApp, type AppId } from './apps';

/**
 * Turns a pre-router bookmark into the equivalent URL path.
 *
 * Navigation used to live entirely in the hash (`#hr/staff`). People have
 * those links bookmarked and pasted into emails, so they have to keep
 * arriving somewhere sensible — `#hr/staff` becomes `/leave/staff`.
 *
 * Run once, before React mounts, and only from the site root — a bookmark
 * from before routing lands there, with everything after the `#`. Anywhere
 * else the URL is already a route and there is nothing to translate.
 *
 * `#reset-password=<token>` is left alone — it is a password-reset link from
 * an email, not navigation, and App still reads it from the hash.
 *
 * Both the location it reads and the rewrite it performs are parameters, so
 * the decision can be tested without a DOM.
 */
export function migrateLegacyHash(
    location: { pathname: string; hash: string } = window.location,
    replaceUrl: (url: string) => void = (url) => window.history.replaceState(null, '', url),
): void {
    if (location.pathname !== '/') return;

    const raw = location.hash.replace(/^#/, '');
    if (!raw || raw.startsWith('reset-password=')) return;

    const [appId = '', section = ''] = raw.split('?')[0].split('/');
    const app = findApp(appId as AppId);
    if (!app) return;

    const path = app.path ? `/${app.path}` : '/';
    replaceUrl(section ? `${path}/${section}` : path);
}
