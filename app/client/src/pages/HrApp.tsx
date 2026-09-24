import { useEffect, useRef, useState } from 'react';
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
  const tabBarRef = useRef<HTMLDivElement>(null);
  const can = (capability: string) => user?.permissions?.[capability] === true;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: can('hr_admin') },
    { id: 'my-leave', label: 'My Leave', show: can('hr_leave_apply') },
    { id: 'approvals', label: 'Approvals', show: can('hr_leave_approve') || can('hr_admin') },
    { id: 'calendar', label: 'Calendar', show: can('hr_access') },
    { id: 'staff', label: 'Staff', show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'report', label: 'Report', show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'policies', label: 'Leave Policies', show: can('hr_admin') },
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
  useEffect(() => {
    tabBarRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeTab]);
  const changeTab = (next: Tab) => {
    if (!validIds.includes(next)) return;
    setTab(next);
    setHash('hr', next);
  };

  // hr_access can be granted without any of the action capabilities.
  if (!visible.length) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-zinc-900">No leave functions are enabled for your account</p>
        <p className="mt-1 text-sm text-zinc-500">Ask an administrator to grant you leave access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="hidden overflow-hidden rounded-2xl bg-[#002B7F] px-5 py-6 text-white shadow-sm sm:block sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">People & leave</p>
        <h3 className="mt-2 text-2xl font-bold tracking-tight">Manage time away with confidence</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Review balances, submit requests and keep the team calendar in one place.</p>
      </div>
      <nav aria-label="HR sections" className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div ref={tabBarRef} className="flex gap-1 overflow-x-auto">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => changeTab(t.id)}
              aria-current={activeTab === t.id ? 'page' : undefined}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === t.id ? 'bg-[#002B7F] text-white shadow-sm' : 'text-slate-600 hover:bg-blue-50 hover:text-[#002B7F]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

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
