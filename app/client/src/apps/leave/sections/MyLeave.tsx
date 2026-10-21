import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { AsyncButton, Button, LoadingState } from '../../../components/Ui';
import { GovernmentMyLeave } from '../GovernmentRequests';
import { formatDate } from '../types';
import type { MyLeaveResponse, LeaveApplication } from '../types';
import { printApprovedLeaveForm } from '../payrollForm';

export function MyLeave() {
    const [summary, setSummary] = useState<MyLeaveResponse | null>(null);
    const [history, setHistory] = useState<LeaveApplication[] | null>(null);
    const [error, setError] = useState('');
    const [version, setVersion] = useState(0), [historyError, setHistoryError] = useState('');
    const historyLoading = useRef(false);
    useEffect(() => {
        let live = true;
        void apiClient.get<MyLeaveResponse>('/hr/me').then(data => { if (live) setSummary(data); })
            .catch((err: Error) => { if (live) setError(err.message); });
        return () => { live = false; };
    }, [version]);
    async function loadHistory() {
        if (historyLoading.current) return;
        historyLoading.current = true; setHistoryError('');
        try { setHistory(await apiClient.get<LeaveApplication[]>('/hr/leaves')); }
        catch (err) { setHistoryError((err as Error).message); }
        finally { historyLoading.current = false; }
    }
    return <div className="space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!summary && !error && <LoadingState label="Loading your leave…" />}
        {!summary && error && <Button variant="secondary" onClick={() => { setError(''); setVersion(value => value + 1); }}>Try loading your leave again</Button>}
        {summary && <>
            {summary.employee.leave_policy_regime === 'government' ? <GovernmentMyLeave employeeId={summary.employee.id} /> : <div className="app-panel space-y-2 p-5"><h2 className="text-xl font-semibold">My leave</h2><p role="status" className="text-sm text-gray-700">Your leave setup needs review. Ask HR to complete your leave setup and activation so you can apply under the current policy.</p></div>}
            <details className="app-panel p-4" onToggle={event => { if (event.currentTarget.open && history === null) void loadHistory(); }}>
                <summary className="cursor-pointer text-sm font-semibold">Leave history</summary>
                <div className="mt-3 space-y-3"><p className="text-sm text-gray-600">View your recorded applications, decisions and approved PDFs.</p>
                    {historyError ? <div className="space-y-2"><p role="alert" className="text-sm text-red-700">{historyError}</p><Button variant="secondary" onClick={() => void loadHistory()}>Try loading history again</Button></div> : history === null ? <LoadingState label="Loading leave history…" /> : !history.length ? <p className="text-sm text-gray-500">No additional leave records.</p> : history.map(application => <article key={application.id} className="rounded-lg border border-gray-200 p-3 text-sm"><p>{application.leave_type_name} · {formatDate(application.start_date)} to {formatDate(application.end_date)} · {application.status}</p>{application.status === 'pending' && <p className="mt-1 text-gray-600">This original request remains unresolved. Ask HR to review it.</p>}{application.status === 'approved' && <AsyncButton variant="secondary" className="mt-2" loadingLabel="Preparing PDF…" onClick={() => {setError('');return printApprovedLeaveForm(application.id);}} onError={err=>setError(err.message)}>Open approved PDF</AsyncButton>}</article>)}
                </div>
            </details>
        </>}
    </div>;
}
