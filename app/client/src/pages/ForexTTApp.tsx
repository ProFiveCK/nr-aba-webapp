import { Navigate, Route, Routes } from 'react-router-dom';
import { ForexTT } from '../pages/ForexTT';
import { ForexTTReview } from '../pages/ForexTTReview';
import { useAuth } from '../contexts/useAuth';
import { useAppSections } from '../components/appChrome';

export function ForexTTApp() {
  const { user } = useAuth();
  const perms = user?.permissions || {};
  const canReview = perms.review_forex_tt === true || user?.role === 'admin';
  const canSubmit = perms.submit_forex_tt === true || user?.role === 'admin';

  const sections = [
    ...(canSubmit ? [{ to: '/forex-tt/submit', label: 'My FOREX TTs' }] : []),
    ...(canReview ? [{ to: '/forex-tt/review', label: 'Review Queue' }] : []),
  ];
  useAppSections(sections);

  const fallback = canSubmit ? 'submit' : canReview ? 'review' : null;
  if (!fallback) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-xl font-semibold">FOREX TT access required</h2>
        <p className="mt-2 text-sm text-amber-800">No FOREX TT functions are enabled for your account.</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route index element={<Navigate to={fallback} replace />} />
      {canSubmit && <Route path="submit" element={<ForexTT />} />}
      {canReview && <Route path="review" element={<ForexTTReview />} />}
      <Route path="*" element={<Navigate to={fallback} replace />} />
    </Routes>
  );
}
