import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/useAuth';
import { ForexTTForm } from './ForexTTForm';
import type { ForexTTAttachment, ForexTTEvent, ForexTTRequest } from './forexTTTypes';

interface ForexTTDetailProps {
  request: ForexTTRequest;
  reviewMode?: boolean;
  onBack: () => void;
  onSaved: (r: ForexTTRequest) => void;
  onSubmitted: (status: string) => void;
  onDeleted: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  payment_voucher: 'Payment Voucher',
  supporting: 'Supporting Documents',
};

export function ForexTTDetail({ request, reviewMode, onBack, onSaved, onSubmitted, onDeleted }: ForexTTDetailProps) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<ForexTTRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const isNew = !request.id;
  const isOwner = Number(detail?.submitted_by) === Number(user?.id);
  const isReviewer = reviewMode || user?.permissions?.review_forex_tt || user?.role === 'admin';

  const load = () => {
    if (isNew) {
      setDetail(request);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    apiClient
      .get<ForexTTRequest>(`/forex-tt/${request.request_id}`)
      .then((r) => {
        setDetail(r);
        setError(null);
      })
      .catch((err) => setError((err as Error).message || 'Failed to load request.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.request_id]);

  const transition = async (status: string) => {
    if (!detail) return;
    if (status === 'cancelled') {
      if (!comments.trim()) {
        setError('Provide a cancellation reason before cancelling this request.');
        return;
      }
      if (!window.confirm(`Cancel ${detail.request_id}? The submitter will be notified.`)) return;
    }
    try {
      const body: Record<string, unknown> = { status, comments };
      if (status === 'approved' && detail.bank_confirmation) {
        body.bank_confirmation = detail.bank_confirmation;
      }
      await apiClient.patch(`/forex-tt/${detail.request_id}/status`, body);
      if (status === 'submitted' || status === 'cancelled' || status === 'approved' || status === 'rejected') {
        onSubmitted(status);
      } else {
        load();
      }
      setComments('');
    } catch (err) {
      setError((err as Error).message || `Failed to ${status} request.`);
    }
  };

  const deleteDraft = async () => {
    if (!detail || !window.confirm(`Delete draft ${detail.request_id}? This cannot be undone.`)) return;
    setIsDeleting(true);
    setError(null);
    try {
      await apiClient.delete(`/forex-tt/${detail.request_id}`);
      onDeleted();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete draft.');
      setIsDeleting(false);
    }
  };

  const groupedAttachments = useMemo(() => {
    const groups: Record<string, ForexTTAttachment[]> = {};
    detail?.attachments?.forEach((a) => {
      const key = a.category || 'supporting';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return groups;
  }, [detail?.attachments]);

  if (isLoading || (!isNew && detail?.request_id !== request.request_id)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500" />
      </div>
    );
  }

  if (error && !detail) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (isNew) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm text-amber-600 hover:underline">← Back</button>
        <ForexTTForm onSaved={onSaved} />
      </div>
    );
  }

  if (!detail) return null;

  const canEdit = ['draft', 'needs_changes'].includes(detail.status) && isOwner;
  const canSubmit = ['draft', 'needs_changes'].includes(detail.status) && isOwner;
  const canDelete = detail.status === 'draft' && isOwner;
  const canReview = isReviewer && detail.status !== 'approved' && detail.status !== 'cancelled';

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-amber-600 hover:underline">← Back</button>
        <div className="flex gap-2">
          {canDelete && (
            <button
              type="button"
              onClick={deleteDraft}
              disabled={isDeleting}
              className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete Draft'}
            </button>
          )}
          <a
            href={`${import.meta.env.VITE_API_BASE_URL || '/api'}/forex-tt/${detail.request_id}/pdf`}
            download
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Download PDF
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{detail.request_id}</h2>
            <p className="text-sm text-gray-500">Status: <span className="font-medium capitalize">{detail.status.replace(/_/g, ' ')}</span> · Version {detail.version}</p>
          </div>
          {canSubmit && (
            <button
              onClick={() => transition('submitted')}
              className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >
              Submit for Review
            </button>
          )}
        </div>
      </div>

      {canEdit && (
        <ForexTTForm
          request={detail}
          onSaved={(r) => {
            setDetail(r);
            onSaved(r);
          }}
        />
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Attached Files</h3>
        {Object.keys(groupedAttachments).length > 0 ? (
          <div className="space-y-4">
            {Object.entries(groupedAttachments).map(([category, items]) => (
              <div key={category}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {CATEGORY_LABELS[category] || category}
                </h4>
                <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-100">
                  {items.map((a: ForexTTAttachment) => (
                    <li key={a.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm">{a.file_name}</span>
                      <a
                        href={`${import.meta.env.VITE_API_BASE_URL || '/api'}/forex-tt/attachments/${a.id}`}
                        download
                        className="text-sm text-amber-600 hover:underline"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No attachments.</p>
        )}
      </section>

      {canReview && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Reviewer Actions</h3>
          <textarea
            className="mb-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Comments / instructions (visible to submitter)"
          />
          {(detail.status === 'claimed' || detail.status === 'processing') && detail.claimed_by === user?.id && (
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-zinc-700">Bank Confirmation</label>
              <textarea
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                rows={2}
                value={detail.bank_confirmation || ''}
                onChange={(e) => setDetail((prev) => (prev ? { ...prev, bank_confirmation: e.target.value } : prev))}
                placeholder="Reference number, receipt, or confirmation details (visible to submitter on approval)"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {detail.status === 'submitted' && (
              <button
                onClick={() => transition('claimed')}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Claim
              </button>
            )}
            {detail.status === 'claimed' && detail.claimed_by === user?.id && (
              <button
                onClick={() => transition('processing')}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Mark Processing
              </button>
            )}
            {(detail.status === 'claimed' || detail.status === 'processing') && detail.claimed_by === user?.id && (
              <button
                onClick={() => transition('needs_changes')}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
              >
                Request Changes
              </button>
            )}
            {(detail.status === 'claimed' || detail.status === 'processing') && detail.claimed_by === user?.id && (
              <button
                onClick={() => transition('approved')}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-500"
              >
                Approve
              </button>
            )}
            {isReviewer && detail.status !== 'approved' && detail.status !== 'cancelled' && (
              <button
                onClick={() => transition('cancelled')}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">History</h3>
        {detail.bank_confirmation && (
          <div className="mb-3 rounded-md border border-green-100 bg-green-50 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-green-700">Bank Confirmation</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm text-green-800">{detail.bank_confirmation}</p>
          </div>
        )}
        {detail.history && detail.history.length > 0 ? (
          <ul className="space-y-2">
            {detail.history.map((h: ForexTTEvent) => (
              <li key={h.id} className="text-sm">
                <span className="font-medium">{h.reviewer}</span>
                {' '}moved to <span className="capitalize">{h.status.replace(/_/g, ' ')}</span>
                {' '}<span className="text-zinc-500">· {new Date(h.created_at).toLocaleString()}</span>
                {h.comments && <p className="mt-1 text-zinc-600">“{h.comments}”</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        )}
      </section>
    </div>
  );
}
