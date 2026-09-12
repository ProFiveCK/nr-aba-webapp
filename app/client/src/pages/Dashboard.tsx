import { useAuth } from '../contexts/useAuth';
import { getAllowedApps, SYSTEM_PAGES, type AppId } from '../lib/apps';

interface DashboardProps {
  onOpenApp: (appId: AppId) => void;
}

export function Dashboard({ onOpenApp }: DashboardProps) {
  const { user } = useAuth();
  const allowed = getAllowedApps(user);

  return (
    <div className="space-y-6">
      <section aria-label="Applications">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Apps</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allowed.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.id}
                onClick={() => onOpenApp(app.id)}
                className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white ${app.color}`}>
                  <Icon className="h-6 w-6" strokeWidth={2} />
                </span>
                <div>
                  <h4 className="text-base font-semibold text-gray-900">{app.label}</h4>
                  <p className="mt-1 text-sm text-gray-600 leading-snug">{app.description}</p>
                </div>
              </button>
            );
          })}

          {SYSTEM_PAGES.filter((app) => app.id !== 'dashboard' && (app.id !== 'admin' || user?.role === 'admin')).map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.id}
                onClick={() => onOpenApp(app.id)}
                className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white ${app.color}`}>
                  <Icon className="h-6 w-6" strokeWidth={2} />
                </span>
                <div>
                  <h4 className="text-base font-semibold text-gray-900">{app.label}</h4>
                  <p className="mt-1 text-sm text-gray-600 leading-snug">{app.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
