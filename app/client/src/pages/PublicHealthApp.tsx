import { useEffect, useState } from 'react';
import { ClipboardCheck, Settings2, UsersRound, WalletCards } from 'lucide-react';
import { AppSectionNav } from '../components/AppSectionNav';
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
  const visibleKey = validIds.join('|');
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = readHash().tab as Tab;
    return validIds.includes(fromHash) ? fromHash : (validIds[0] ?? 'review');
  });

  useEffect(() => {
    const syncTab = () => {
      const requested = readHash().tab as Tab;
      const allowed = visibleKey.split('|');
      setTab(allowed.includes(requested) ? requested : ((allowed[0] || 'review') as Tab));
    };
    syncTab();
    window.addEventListener('hashchange', syncTab);
    return () => window.removeEventListener('hashchange', syncTab);
  }, [visibleKey]);

  const activeTab = validIds.includes(tab) ? tab : validIds[0];
  const changeTab = (next: Tab) => {
    if (!validIds.includes(next)) return;
    setTab(next);
    setHash('public-health', next);
  };

  return (
    <div className="wellness space-y-5">
      <AppSectionNav label="Wellness Program sections" sections={visible} activeId={activeTab} onChange={changeTab} />

      {activeTab === 'participants' && <Participants />}
      {activeTab === 'periods' && <PayPeriods />}
      {activeTab === 'settings' && <SettingsPanel />}
      {activeTab === 'review' && <Review />}
    </div>
  );
}
