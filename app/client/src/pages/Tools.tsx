import { useState } from 'react';
import { Saas } from '../pages/Saas';

type ToolsTab = 'saas';

export function Tools() {
  const [tab] = useState<ToolsTab>('saas');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <div className="flex flex-wrap gap-1">
          <button className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white">SaaS</button>
        </div>
      </div>

      {tab === 'saas' && <Saas />}
    </div>
  );
}
