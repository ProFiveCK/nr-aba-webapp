import { useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';
import { Participants } from './PublicHealth/Participants';
import { PayPeriods } from './PublicHealth/PayPeriods';
import { SettingsPanel } from './PublicHealth/Settings';
import { Review } from './PublicHealth/Review';

type Tab = 'participants' | 'periods' | 'settings' | 'review';

export function PublicHealthApp() {
  const { user } = useAuth();
  const isManager = user?.role === 'public_health' || user?.role === 'admin';
  const isReviewer = user?.role === 'reviewer' || user?.role === 'admin';

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'participants', label: 'Participants', show: isManager },
    { id: 'periods', label: 'Pay Periods', show: isManager },
    { id: 'settings', label: 'Settings', show: isManager },
    { id: 'review', label: 'Review', show: isReviewer },
  ];
  const visible = tabs.filter((t) => t.show);
  const validIds = visible.map((t) => t.id);
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = readHash().tab as Tab;
    return validIds.includes(fromHash) ? fromHash : (validIds[0] ?? 'review');
  });

  const changeTab = (next: Tab) => {
    setTab(next);
    setHash('public-health', next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-teal-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'participants' && <Participants />}
      {tab === 'periods' && <PayPeriods />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'review' && <Review />}
    </div>
  );
}
