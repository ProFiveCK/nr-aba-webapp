import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';
import { Overview } from './Hr/Overview';
import { MyLeave } from './Hr/MyLeave';
import { Approvals } from './Hr/Approvals';
import { Staff } from './Hr/Staff';
import { Policies } from './Hr/Policies';
import { Calendar } from './Hr/Calendar';
import { Report } from './Hr/Report';

type Tab = 'overview' | 'my-leave' | 'approvals' | 'calendar' | 'staff' | 'report' | 'policies';

export function HrApp() {
  const { user } = useAuth();
  const can = (capability: string) => user?.permissions?.[capability] === true;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: can('hr_admin') },
    { id: 'my-leave', label: 'My Leave', show: can('hr_leave_apply') },
    { id: 'approvals', label: 'Approvals', show: can('hr_leave_approve') || can('hr_admin') },
    { id: 'calendar', label: 'Calendar', show: can('hr_access') },
    { id: 'staff', label: 'Staff', show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'report', label: 'Report', show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'policies', label: 'Policies', show: can('hr_admin') },
  ];
  const visible = tabs.filter((t) => t.show);
  const validIds = visible.map((t) => t.id);
  const visibleKey = validIds.join('|');
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = readHash().tab as Tab;
    return validIds.includes(fromHash) ? fromHash : (validIds[0] ?? 'my-leave');
  });

  useEffect(() => {
    const syncTab = () => {
      const requested = readHash().tab as Tab;
      const allowed = visibleKey.split('|');
      setTab(allowed.includes(requested) ? requested : ((allowed[0] || 'my-leave') as Tab));
    };
    syncTab();
    window.addEventListener('hashchange', syncTab);
    return () => window.removeEventListener('hashchange', syncTab);
  }, [visibleKey]);

  const activeTab = validIds.includes(tab) ? tab : validIds[0];
  const changeTab = (next: Tab) => {
    if (!validIds.includes(next)) return;
    setTab(next);
    setHash('hr', next);
  };

  // hr_access can be granted without any of the action capabilities.
  if (!visible.length) {
    return (
      <div className="space-y-5">
        <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Leave</h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-zinc-900">No leave functions are enabled for your account</p>
          <p className="mt-1 text-sm text-zinc-500">Ask an administrator to grant you leave access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Leave owns its page header (Layout skips it) so the title and the
          section tabs read as one block instead of two stacked panels. */}
      <div className="border-b border-slate-200">
        <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Leave</h2>
        <nav aria-label="Leave sections" className="-mb-px mt-3 flex gap-6 overflow-x-auto [scrollbar-width:none]">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => changeTab(t.id)}
              aria-current={activeTab === t.id ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? 'border-[#E8842C] text-[#002B7F]'
                  : 'border-transparent text-slate-600 hover:text-[#002B7F]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && <Overview onNavigate={changeTab} />}
      {activeTab === 'my-leave' && <MyLeave />}
      {activeTab === 'approvals' && <Approvals />}
      {activeTab === 'calendar' && <Calendar />}
      {activeTab === 'staff' && <Staff />}
      {activeTab === 'report' && <Report />}
      {activeTab === 'policies' && <Policies />}
    </div>
  );
}
