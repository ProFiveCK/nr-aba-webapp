import { useState } from 'react';
import { Generator } from '../pages/Generator';
import { MyBatches } from '../pages/MyBatches';
import { Reader } from '../pages/Reader';
import { Reviewer } from '../pages/Reviewer';
import { useAuth } from '../contexts/useAuth';
import { readHash, setHash } from '../lib/hash';

type AbaTab = 'generator' | 'my-batches' | 'reader' | 'reviewer';

interface AbaWorkflowProps {
  onTabChange?: (tab: string) => void;
}

const ALL_TABS: { id: AbaTab; label: string; roles: ('user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health')[] }[] = [
  { id: 'generator', label: 'Generator', roles: ['user', 'reviewer', 'admin'] },
  { id: 'my-batches', label: 'My Batches', roles: ['user', 'reviewer', 'admin'] },
  { id: 'reader', label: 'Reader', roles: ['user', 'reviewer', 'admin'] },
  { id: 'reviewer', label: 'Repository', roles: ['reviewer', 'admin'] },
];

export function AbaWorkflow({ onTabChange }: AbaWorkflowProps) {
  const { user } = useAuth();
  const tabs = ALL_TABS.filter((t) => user?.role && t.roles.includes(user.role));
  const validIds = tabs.map((t) => t.id);
  const [tab, setTab] = useState<AbaTab>(() => {
    const fromHash = readHash().tab as AbaTab;
    return validIds.includes(fromHash) ? fromHash : (tabs[0]?.id || 'generator');
  });

  const changeTab = (next: AbaTab) => {
    setTab(next);
    setHash('aba', next);
    onTabChange?.('aba');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'generator' && <Generator />}
      {tab === 'my-batches' && <MyBatches />}
      {tab === 'reader' && <Reader onSwitchToGenerator={() => changeTab('generator')} />}
      {tab === 'reviewer' && <Reviewer onSwitchToReader={() => changeTab('reader')} />}
    </div>
  );
}
