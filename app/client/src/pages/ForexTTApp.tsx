import { useState } from 'react';
import { ForexTT } from '../pages/ForexTT';
import { ForexTTReview } from '../pages/ForexTTReview';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';

type ForexTab = 'submit' | 'review';

export function ForexTTApp() {
  const { user } = useAuth();
  const perms = user?.permissions || {};
  const canReview = perms.review_forex_tt === true || user?.role === 'admin';
  const canSubmit = perms.submit_forex_tt === true || user?.role === 'admin';
  const [tab, setTab] = useState<ForexTab>(() => {
    const fromHash = readHash().tab as ForexTab;
    if (fromHash === 'review' && canReview) return 'review';
    if (fromHash === 'submit' && canSubmit) return 'submit';
    return canSubmit ? 'submit' : 'review';
  });

  const changeTab = (next: ForexTab) => {
    setTab(next);
    setHash('forex-tt', next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {canSubmit && (
            <button
              onClick={() => changeTab('submit')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'submit' ? 'bg-sky-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My FOREX TTs
            </button>
          )}
          {canReview && (
            <button
              onClick={() => changeTab('review')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'review' ? 'bg-sky-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Review Queue
            </button>
          )}
        </div>
      </div>

      {tab === 'submit' && <ForexTT />}
      {tab === 'review' && <ForexTTReview />}
    </div>
  );
}
