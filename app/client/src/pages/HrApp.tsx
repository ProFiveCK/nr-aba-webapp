import { useEffect, useState } from 'react';
import { CalendarDays, ChartNoAxesCombined, ClipboardCheck, FileChartColumn, FileText, Palmtree, UsersRound } from 'lucide-react';
import { AppSectionNav } from '../components/AppSectionNav';
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

  const tabs: { id: Tab; label: string; detail: string; icon: typeof CalendarDays; show: boolean }[] = [
    { id: 'overview', label: 'Overview', detail: 'Leave at a glance', icon: ChartNoAxesCombined, show: can('hr_admin') },
    { id: 'my-leave', label: 'My Leave', detail: 'Balances and requests', icon: Palmtree, show: can('hr_leave_apply') },
    { id: 'approvals', label: 'Approvals', detail: 'Review requests', icon: ClipboardCheck, show: can('hr_leave_approve') || can('hr_admin') },
    { id: 'calendar', label: 'Calendar', detail: 'Who is away', icon: CalendarDays, show: can('hr_access') },
    { id: 'staff', label: 'Staff', detail: 'People and balances', icon: UsersRound, show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'report', label: 'Report', detail: 'Leave reporting', icon: FileChartColumn, show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'policies', label: 'Leave Policies', detail: 'Rules and entitlements', icon: FileText, show: can('hr_admin') },
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
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-zinc-900">No leave functions are enabled for your account</p>
        <p className="mt-1 text-sm text-zinc-500">Ask an administrator to grant you leave access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AppSectionNav label="Leave sections" sections={visible} activeId={activeTab} onChange={changeTab} />

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
