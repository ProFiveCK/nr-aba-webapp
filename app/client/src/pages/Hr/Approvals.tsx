import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import type { LeaveApplication } from '../../features/hr/types';

export function Approvals() {
    const { addToast } = useToast();
    const [items, setItems] = useState<LeaveApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await apiClient.get<LeaveApplication[]>('/hr/approvals')) || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load approvals.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const decide = async (application: LeaveApplication, decision: 'approved' | 'rejected') => {
        let note = '';
        if (decision === 'rejected') {
            // The server also enforces this; asking here avoids a wasted round trip.
            const response = window.prompt(
                `Why are you rejecting ${application.employee_name}'s ${application.leave_type_name} leave?`,
                ''
            );
            if (response === null) return;
            note = response.trim();
            if (!note) {
                addToast('A reason is required when rejecting leave.', 'error');
                return;
            }
        }

        setBusyId(application.id);
        try {
            await apiClient.post(`/hr/leaves/${application.id}/decision`, {
                decision,
                reviewer_note: note || null,
            });
            addToast(`Leave ${decision}.`, 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to record the decision.', 'error');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) return <LoadingState label="Loading approvals…" />;

    if (!items.length) {
        return (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <EmptyState title="Nothing awaiting approval" detail="Leave from the people who report to you will appear here." />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((application) => (
                <div key={application.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="font-semibold text-zinc-900">{application.employee_name}</p>
                            <p className="text-sm text-zinc-600">
                                {application.leave_type_name} · {formatDate(application.start_date)} – {formatDate(application.end_date)} ·{' '}
                                <span className="font-medium">{application.days} working days</span>
                            </p>
                            {application.reason && (
                                <p className="mt-2 rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">{application.reason}</p>
                            )}
                            <p className="mt-2 text-xs text-zinc-400">Applied {formatDate(application.applied_at)}</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={busyId === application.id}
                                onClick={() => decide(application, 'approved')}
                                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                                Approve
                            </button>
                            <button
                                type="button"
                                disabled={busyId === application.id}
                                onClick={() => decide(application, 'rejected')}
                                className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
