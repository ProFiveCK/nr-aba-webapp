import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import { getAllowedApps, pathForApp, SYSTEM_PAGES, type AppDef } from '../lib/apps';

/** One app on the launcher. A link, so it can be opened in a new tab. */
function AppCard({ app }: { app: AppDef }) {
  const Icon = app.icon;
  return (
    <Link
      to={pathForApp(app)}
      className="group flex h-full items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 text-left shadow-sm transition hover:border-brand/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white ${app.color}`}>
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-base font-semibold text-gray-900">{app.label}</h4>
        <p className="mt-1 text-sm text-gray-600 leading-snug">{app.description}</p>
      </div>
      <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-gray-400 group-hover:text-brand" />
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
    <div className="mx-auto max-w-7xl space-y-8">
      <section aria-label="Applications">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Applications</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...allowed, ...systemPages].map((app) => <AppCard key={app.id} app={app} />)}
        </div>
      </section>
    </div>
  );
}
