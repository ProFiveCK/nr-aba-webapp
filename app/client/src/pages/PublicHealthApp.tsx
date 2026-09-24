import { useState } from 'react';
import { ClipboardCheck, Settings2, UsersRound, WalletCards } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';
import { Participants } from './PublicHealth/Participants';
import { PayPeriods } from './PublicHealth/PayPeriods';
import { SettingsPanel } from './PublicHealth/Settings';
import { Review } from './PublicHealth/Review';
import './PublicHealth/wellness.css';

type Tab = 'participants' | 'periods' | 'settings' | 'review';

export function PublicHealthApp() {
  const { user } = useAuth();
  const isManager = user?.role === 'public_health' || user?.role === 'admin';
  const isReviewer = user?.role === 'reviewer' || user?.role === 'admin';

  const tabs: { id: Tab; label: string; detail: string; icon: typeof UsersRound; show: boolean }[] = [
    { id: 'participants', label: 'Participants', detail: 'People and levels', icon: UsersRound, show: isManager },
    { id: 'periods', label: 'Pay runs', detail: 'Prepare payments', icon: WalletCards, show: isManager },
    { id: 'settings', label: 'Settings', detail: 'Allowance tiers', icon: Settings2, show: isManager },
    { id: 'review', label: 'Review', detail: 'Approve batches', icon: ClipboardCheck, show: isReviewer },
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
    <div className="wellness space-y-5">
      <nav className="wellness-nav" aria-label="Wellness Program sections">
        <div className="wellness-nav-list">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => changeTab(t.id)}
              className={`wellness-nav-item ${tab === t.id ? 'is-active' : ''}`}
            >
              <t.icon size={19} strokeWidth={1.8} aria-hidden="true" />
              <span><strong>{t.label}</strong><small>{t.detail}</small></span>
            </button>
          ))}
        </div>
      </nav>

      {tab === 'participants' && <Participants />}
      {tab === 'periods' && <PayPeriods />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'review' && <Review />}
    </div>
  );
}
