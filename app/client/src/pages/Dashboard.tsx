import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardCheck, Users } from 'lucide-react';
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
  const canUseLeave = allowed.some(app => app.id === 'hr');
  const permissions = user?.permissions;
  const quickActions = [
    { visible: permissions?.hr_leave_apply, to: '/leave/my-leave', label: 'My leave', detail: 'Check balances and request time off', icon: CalendarDays },
    { visible: permissions?.hr_leave_approve || permissions?.hr_admin, to: '/leave/approvals', label: 'Review applications', detail: 'Decide requests waiting for approval', icon: ClipboardCheck },
    { visible: permissions?.hr_staff_manage || permissions?.hr_admin || permissions?.hr_balance_manage, to: '/leave/employees', label: 'Employees', detail: 'Add employees and manage their leave', icon: Users },
  ].filter(action => action.visible);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="rounded-2xl border border-brand/10 bg-gradient-to-br from-blue-50 via-white to-white p-6 sm:p-8">
        <p className="text-sm font-medium text-brand">Treasury portal</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">Welcome{user?.display_name ? `, ${user.display_name}` : ''}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">Your workspace for the day. Open an application or go straight to a task.</p>
      </header>
      {canUseLeave && quickActions.length > 0 && <section aria-labelledby="dashboard-leave-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="dashboard-leave-title" className="text-lg font-semibold text-gray-950">Leave management</h3>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-4" to={permissions?.hr_admin ? '/leave/overview' : '/leave/calendar'}>{permissions?.hr_admin ? 'View overview' : 'View calendar'}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className={`grid gap-4 ${quickActions.length === 2 ? 'md:grid-cols-2' : quickActions.length > 2 ? 'md:grid-cols-3' : ''}`}>
          {quickActions.map(({to, label, detail, icon: Icon}) => <Link key={to} to={to} className="group rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand/30 hover:bg-blue-50/30 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2">
            <div className="flex items-center justify-between"><Icon size={22} className="text-brand" aria-hidden="true" /><ArrowRight size={18} className="text-gray-400 group-hover:text-brand" aria-hidden="true" /></div>
            <h4 className="mt-4 font-semibold text-gray-950">{label}</h4><p className="mt-1 text-sm leading-6 text-gray-600">{detail}</p>
          </Link>)}
        </div>
      </section>}
      <section aria-label="Applications">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Applications</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...allowed, ...systemPages].map((app) => <AppCard key={app.id} app={app} />)}
        </div>
      </section>
    </div>
  );
}
