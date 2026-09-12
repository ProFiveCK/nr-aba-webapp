import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ForexTTDetail } from '../features/forex-tt/ForexTTDetail';
import type { ForexTTRequest } from '../features/forex-tt/forexTTTypes';

export function ForexTT() {
  const [requests, setRequests] = useState<ForexTTRequest[]>([]);
  const [selected, setSelected] = useState<ForexTTRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await apiClient.get<ForexTTRequest[]>('/forex-tt/my');
      setRequests(rows || []);
    } catch (err) {
      setError((err as Error).message || 'Failed to load requests.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (r: ForexTTRequest) => {
    setSelected(r);
    load();
  };

  if (selected) {
    return (
      <ForexTTDetail
        request={selected}
        onBack={() => setSelected(null)}
        onSaved={handleSaved}
        onSubmitted={(status) => {
          setSelected(null);
          setNotice(`TT request ${status.replace(/_/g, ' ')}.`);
          load();
        }}
        onDeleted={() => {
          setSelected(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">FOREX Telegraphic Transfers</h2>
          <p className="text-sm text-gray-500">Create and manage your foreign currency transfer requests.</p>
        </div>
        <button
          onClick={() => setSelected({} as ForexTTRequest)}
          className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          New Request
        </button>
      </div>

      {notice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          {requests.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No requests yet. Click “New Request” to start a FOREX TT.
            </div>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Request ID</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {requests.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-medium text-amber-700">{r.request_id}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">{r.department_code}</td>
                    <td className="px-4 py-3 text-zinc-500">{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-700',
    submitted: 'bg-amber-50 text-amber-700 border-amber-100',
    claimed: 'bg-blue-50 text-blue-700 border-blue-100',
    processing: 'bg-amber-50 text-amber-700 border-amber-100',
    needs_changes: 'bg-orange-50 text-orange-700 border-orange-100',
    approved: 'bg-green-50 text-green-700 border-green-100',
    cancelled: 'bg-red-50 text-red-700 border-red-100',
  };
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium capitalize ${color[status] || color.draft}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
