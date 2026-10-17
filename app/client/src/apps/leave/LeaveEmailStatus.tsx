import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { Button } from '../../components/Ui';

type EmailNotice = {
  id: string;
  kind: 'approval_needed' | 'decision';
  status: 'pending' | 'sent' | 'skipped';
  recipient_email: string | null;
  display_name: string | null;
  last_error: string | null;
  sent_at: string | null;
};

export function LeaveEmailStatus({ requestId, refreshKey }: { requestId: string; refreshKey: string }) {
  const [version, setVersion] = useState(0);
  const [notices, setNotices] = useState<EmailNotice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void apiClient.get<{ notifications: EmailNotice[] }>(`/hr/government/workflow/requests/${requestId}/notifications`)
      .then(result => { if (live) { setNotices(result.notifications); setError(''); } })
      .catch(() => { if (live) setError('Email status could not be loaded. Try refreshing.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [requestId, refreshKey, version]);

  return <details className="rounded-lg border border-gray-200 bg-white p-3">
    <summary className="cursor-pointer text-sm font-medium">Email notifications</summary>
    <div className="mt-3 space-y-3 text-sm">
      <Button variant="secondary" onClick={() => { setLoading(true); setVersion(current => current + 1); }}>Refresh email status</Button>
      {loading ? <p>Loading email status…</p> : error ? <p role="alert" className="text-red-700">{error}</p> : notices.length === 0 ? <p>No email notifications have been recorded for this application.</p> :
        <ul className="space-y-2">{notices.map(notice => <li key={notice.id} className="rounded border border-gray-200 p-2">
          <p className="font-medium">{notice.kind === 'approval_needed' ? 'Approval request' : 'Decision confirmation'} · {notice.display_name || notice.recipient_email || 'Recipient'}</p>
          {notice.recipient_email && <p className="break-all">{notice.recipient_email}</p>}
          <p>{notice.status === 'sent' ? `Accepted by email server${notice.sent_at ? ` · ${formatDateTime(notice.sent_at)}` : ''}` : notice.status === 'skipped' ? 'Not sent' : notice.last_error ? 'Waiting to retry' : 'Waiting to send'}</p>
          {notice.last_error && <p className="break-words text-gray-600">{notice.last_error}</p>}
        </li>)}</ul>}
      <p className="text-gray-600">Email server acceptance does not confirm inbox delivery.</p>
    </div>
  </details>;
}
