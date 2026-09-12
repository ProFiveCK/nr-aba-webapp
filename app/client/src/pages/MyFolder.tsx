import { useState } from 'react';
import { MyBatches } from '../pages/MyBatches';
import { ForexTT } from '../pages/ForexTT';

type FolderTab = 'aba' | 'forex-tt';

export function MyFolder() {
  const [tab, setTab] = useState<FolderTab>('aba');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setTab('aba')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'aba' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            ABA Batches
          </button>
          <button
            onClick={() => setTab('forex-tt')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'forex-tt' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            FOREX TTs
          </button>
        </div>
      </div>

      {tab === 'aba' && <MyBatches />}
      {tab === 'forex-tt' && <ForexTT />}
    </div>
  );
}
