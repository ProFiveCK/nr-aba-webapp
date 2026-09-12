import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ForexTTDetail } from '../features/forex-tt/ForexTTDetail';
import type { ForexTTRequest } from '../features/forex-tt/forexTTTypes';

export function ForexTTReview() {
  const [queue, setQueue] = useState<ForexTTRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQueue = async (signal?: AbortSignal) => {
    try {
      setError(null);
      const rows = await apiClient.get<ForexTTRequest[]>('/forex-tt/review-queue', { signal });
      setQueue(rows || []);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Failed to load review queue.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadQueue(controller.signal);
    return () => controller.abort();
  }, []);

  const selected = selectedId ? queue.find((r) => r.id === selectedId) || null : null;

  if (selected) {
    return (
      <ForexTTDetail
        request={selected}
        reviewMode
        onBack={() => setSelectedId(null)}
        onSaved={(r) => setQueue((prev) => prev.map((x) => (x.id === r.id ? r : x)))}
        onSubmitted={(status) =>
          apiClient
            .get<ForexTTRequest[]>('/forex-tt/review-queue')
            .then((rows) => setQueue(rows || []))
            .finally(() => {
              setSelectedId(null);
              setNotice(`TT request ${status.replace(/_/g, ' ')}.`);
            })
        }
        onDeleted={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">FOREX TT Review Queue</h2>
        <p className="text-sm text-gray-500">Claim, process, and approve foreign currency transfer requests.</p>
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
          {queue.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No requests waiting for review.</div>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Request ID</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Claimed By</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {queue.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-medium text-amber-700">{r.request_id}</td>
                    <td className="px-4 py-3 capitalize">{r.status.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">{r.claimed_by_name || (r.claimed_by ? 'Me' : '—')}</td>
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
