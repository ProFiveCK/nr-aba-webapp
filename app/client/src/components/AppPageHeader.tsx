import { findApp, type AppId } from '../lib/apps';

/**
 * The standard page heading for an app that has not taken over its own.
 *
 * This used to live in `Layout`, guarded by `activeApp !== 'hr'` — the layout
 * knowing, by name, about the one app that wanted a different header. Each app
 * now decides for itself by rendering this or not, so adding another app that
 * owns its page needs no edit here.
 */
export function AppPageHeader({ appId }: { appId: AppId }) {
    const app = findApp(appId);
    const isDashboard = appId === 'dashboard';
    return (
        <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2a5ba5]">Treasury applications</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {isDashboard ? 'Dashboard' : app?.label || 'App'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
                {isDashboard ? 'Choose an app to get started' : app?.description || app?.label || 'App'}
            </p>
        </div>
    );
}
