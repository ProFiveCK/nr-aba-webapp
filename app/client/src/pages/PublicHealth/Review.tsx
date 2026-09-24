import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { downloadBase64File, formatBatchCode, formatIsoDateTime, formatPdNumber, getBatchStageBadgeClasses } from '../../lib/utils';
import { STAGE_META } from '../../lib/constants';
import type { PublicHealthReviewItem } from '../../features/public-health/types';

interface BatchDetail {
  batch_id: string;
  code: string;
  stage: 'submitted' | 'approved' | 'rejected';
  pd_number: string | null;
  department_code: string | null;
  submitted_email: string | null;
  created_at: string;
  file_name: string | null;
  file_base64?: string | null;
  file_available?: boolean;
  transactions?: Record<string, unknown>;
}

export function Review() {
  const { addToast } = useToast();
  const [items, setItems] = useState<PublicHealthReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<BatchDetail | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [comments, setComments] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await apiClient.get<PublicHealthReviewItem[]>('/public-health/review');
      setItems(rows || []);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load review queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openBatch = async (code: string) => {
    setComments('');
    try {
      const batch = await apiClient.get<BatchDetail>(`/batches/${encodeURIComponent(formatBatchCode(code))}`);
      setSelected(batch);
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to load batch.', 'error');
    }
  };

  const decide = async (next: 'approved' | 'rejected') => {
    if (!selected) return;
    if (next === 'rejected' && !comments.trim()) {
      addToast('Provide a reason when rejecting.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.patch(`/batches/${encodeURIComponent(selected.code)}/stage`, {
        stage: next,
        comments: comments.trim() || undefined,
      });
      addToast(`Batch ${next}.`, 'success');
      setSelected(null);
      await load();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to record decision.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const download = () => {
    if (!selected?.file_base64) {
      addToast('ABA file is not available for this batch.', 'error');
      return;
    }
    downloadBase64File(selected.file_base64, selected.file_name || `${selected.code}.aba`);
  };

  return (
    <div className="space-y-6">
      <section className="app-panel p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="wellness-section-title">Payment reviews</h2>
            <p className="wellness-section-subtitle">Approve allowance payments before FMIS loading.</p>
          </div>
          <button onClick={load} className="toolbar-button self-start">Refresh</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="wellness-stat"><div className="wellness-stat-label">Total batches</div><div className="wellness-stat-value text-[#002b7f]">{items.length}</div></div>
            <div className="wellness-stat"><div className="wellness-stat-label">Awaiting decision</div><div className="wellness-stat-value text-amber-700">{items.filter((item) => item.stage === 'submitted').length}</div></div>
            <div className="wellness-stat"><div className="wellness-stat-label">Approved</div><div className="wellness-stat-value text-emerald-700">{items.filter((item) => item.stage === 'approved').length}</div></div>
          </div>
        )}
        <div className="data-table-wrap mt-4 hidden sm:block">
          <div className="data-table-scroll max-h-[420px]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}><LoadingState label="Loading review queue…" /></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={5}><EmptyState title="No public health batches awaiting review." /></td></tr>
                ) : (
                  items.map((b) => (
                    <tr key={b.code}>
                      <td className="px-3 py-2 font-mono text-teal-700">{formatBatchCode(b.code)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getBatchStageBadgeClasses(b.stage)}`}>{STAGE_META[b.stage]?.label || b.stage}</span>
                      </td>
                      <td className="px-3 py-2">{b.pd_number ? formatPdNumber(b.pd_number) : '—'}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{formatIsoDateTime(b.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openBatch(b.code)} className="wellness-row-action">View batch</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-4 space-y-2 sm:hidden">
          {loading ? <LoadingState label="Loading review queue…" /> : items.length === 0 ? (
            <EmptyState title="No public health batches awaiting review." />
          ) : items.map((b) => (
            <article key={b.code} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-mono text-sm font-semibold text-[#002b7f]">{formatBatchCode(b.code)}</p><p className="mt-1 text-xs text-slate-500">{formatIsoDateTime(b.created_at)}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getBatchStageBadgeClasses(b.stage)}`}>{STAGE_META[b.stage]?.label || b.stage}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-600">Ref {b.pd_number ? formatPdNumber(b.pd_number) : '—'}</span>
                <button onClick={() => openBatch(b.code)} className="wellness-row-action">View batch</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selected && (
        <section className="app-panel p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{formatBatchCode(selected.code)}</h2>
              <p className="text-sm text-gray-600">Reference: {selected.pd_number ? formatPdNumber(selected.pd_number) : '—'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={download} className="toolbar-button">Download ABA</button>
              <button onClick={() => decide('approved')} disabled={actionLoading || selected.stage === 'approved'} className="toolbar-button bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 disabled:opacity-60">
                {actionLoading ? 'Saving…' : 'Approve'}
              </button>
              <button onClick={() => decide('rejected')} disabled={actionLoading || selected.stage === 'rejected'} className="toolbar-button bg-rose-600 text-white border-rose-600 hover:bg-rose-700 disabled:opacity-60">
                {actionLoading ? 'Saving…' : 'Reject'}
              </button>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700">Comments
              <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="Required when rejecting" />
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
