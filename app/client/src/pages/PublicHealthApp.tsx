import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useAppSections } from '../components/appChrome';
import { Participants } from './PublicHealth/Participants';
import { PayPeriods } from './PublicHealth/PayPeriods';
import { SettingsPanel } from './PublicHealth/Settings';
import { Review } from './PublicHealth/Review';
import './PublicHealth/wellness.css';

type Tab = 'participants' | 'periods' | 'settings' | 'review';

/**
 * Fit for Duty — the allowance programme formerly labelled Wellness Program.
 * Only the name people see changed: the capability is still
 * `public_health_access` and the tables are still `public_health_*`, because
 * renaming those would be a migration with nothing to show for it.
 */
export function PublicHealthApp() {
  const { user } = useAuth();
  const isManager = user?.role === 'public_health' || user?.role === 'admin';
  const isReviewer = user?.role === 'reviewer' || user?.role === 'admin';

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'participants', label: 'Participants', show: isManager },
    { id: 'periods', label: 'Pay runs', show: isManager },
    { id: 'settings', label: 'Settings', show: isManager },
    { id: 'review', label: 'Review', show: isReviewer },
  ];
  const visible = tabs.filter((tab) => tab.show);
  useAppSections(visible.map((tab) => ({ to: `/fit-for-duty/${tab.id}`, label: tab.label })));

  const fallback = visible[0]?.id;
  if (!fallback) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-xl font-semibold">Fit for Duty access required</h2>
        <p className="mt-2 text-sm text-amber-800">No Fit for Duty functions are enabled for your account.</p>
      </div>
    );
  }
  const has = (id: Tab) => visible.some((tab) => tab.id === id);

  return (
    <div className="wellness">
      <Routes>
        <Route index element={<Navigate to={fallback} replace />} />
        {has('participants') && <Route path="participants" element={<Participants />} />}
        {has('periods') && <Route path="periods" element={<PayPeriods />} />}
        {has('settings') && <Route path="settings" element={<SettingsPanel />} />}
        {has('review') && <Route path="review" element={<Review />} />}
        <Route path="*" element={<Navigate to={fallback} replace />} />
      </Routes>
    </div>
  );
}
