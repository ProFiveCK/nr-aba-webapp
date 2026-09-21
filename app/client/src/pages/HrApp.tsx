import { useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';
import { MyLeave } from './Hr/MyLeave';
import { Approvals } from './Hr/Approvals';
import { Staff } from './Hr/Staff';
import { Policies } from './Hr/Policies';

type Tab = 'my-leave' | 'approvals' | 'staff' | 'policies';

export function HrApp() {
  const { user } = useAuth();
  const can = (capability: string) => user?.permissions?.[capability] === true;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'my-leave', label: 'My Leave', show: can('hr_leave_apply') },
    { id: 'approvals', label: 'Approvals', show: can('hr_leave_approve') || can('hr_admin') },
    { id: 'staff', label: 'Staff', show: can('hr_staff_manage') || can('hr_admin') },
    { id: 'policies', label: 'Leave Policies', show: can('hr_admin') },
  ];
  const visible = tabs.filter((t) => t.show);
  const validIds = visible.map((t) => t.id);
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = readHash().tab as Tab;
    return validIds.includes(fromHash) ? fromHash : (validIds[0] ?? 'my-leave');
  });

  const changeTab = (next: Tab) => {
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
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-[#002B7F] text-white' : 'text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'my-leave' && <MyLeave />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'staff' && <Staff />}
      {tab === 'policies' && <Policies />}
    </div>
  );
}
