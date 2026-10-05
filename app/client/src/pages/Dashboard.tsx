import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { getAllowedApps, pathForApp, SYSTEM_PAGES, type AppDef } from '../lib/apps';

/** One app on the launcher. A link, so it can be opened in a new tab. */
function AppCard({ app }: { app: AppDef }) {
  const Icon = app.icon;
  return (
    <Link
      to={pathForApp(app)}
      className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white ${app.color}`}>
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <div>
        <h4 className="text-base font-semibold text-gray-900">{app.label}</h4>
        <p className="mt-1 text-sm text-gray-600 leading-snug">{app.description}</p>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const allowed = getAllowedApps(user);
  const systemPages = SYSTEM_PAGES.filter(
    (app) => app.id !== 'dashboard' && (app.id !== 'admin' || user?.role === 'admin')
  );

  return (
    <div className="space-y-6">
      <section aria-label="Applications">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Apps</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...allowed, ...systemPages].map((app) => <AppCard key={app.id} app={app} />)}
        </div>
      </section>
    </div>
  );
}
