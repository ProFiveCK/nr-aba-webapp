import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';
import { formatIsoDateTime } from '../lib/utils';

interface SaasConfig {
    method: string;
    immediateSync: boolean;
    description: string;
    windowsSyncUrl?: string | null;
    syncTriggerPath?: string | null;
    syncTimeout?: number;
}

interface SaasHistoryEntry {
    id: number;
    requested_at: string;
    requester_email?: string | null;
    requester_name?: string | null;
    status: string;
    completed_at?: string | null;
    error_message?: string | null;
    files_synced?: number | null;
    notes?: string | null;
}

export function Saas() {
    const { user } = useAuth();
    const [config, setConfig] = useState<SaasConfig | null>(null);
    const [history, setHistory] = useState<SaasHistoryEntry[]>([]);
    const [configLoading, setConfigLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyError, setHistoryError] = useState('');
    const [triggerMessage, setTriggerMessage] = useState('');
    const [triggerError, setTriggerError] = useState('');
    const [triggerLoading, setTriggerLoading] = useState(false);

    const isAdmin = user?.role === 'admin';

    const loadConfig = useCallback(async () => {
        setConfigLoading(true);
        try {
            const data = await apiClient.get<SaasConfig>('/saas/config');
            setConfig(data || null);
        } catch (err) {
            setConfig(null);
            setTriggerError((err as Error)?.message || 'Unable to load SaaS configuration.');
        } finally {
            setConfigLoading(false);
        }
    }, []);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        setHistoryError('');
        try {
            const data = await apiClient.get<SaasHistoryEntry[]>('/saas/sync-history?limit=15');
            setHistory(Array.isArray(data) ? data : []);
        } catch (err) {
            setHistoryError((err as Error)?.message || 'Unable to load sync history.');
            setHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfig();
        loadHistory();
    }, [loadConfig, loadHistory]);

    const handleManualSync = async () => {
        if (!isAdmin) return;
        setTriggerLoading(true);
        setTriggerMessage('');
        setTriggerError('');
        try {
            const response = await apiClient.post<{ message?: string }>('/saas/sync-trigger', {});
            setTriggerMessage(response?.message || 'Sync request submitted.');
            await loadHistory();
        } catch (err) {
            setTriggerError((err as Error)?.message || 'Unable to trigger sync.');
        } finally {
            setTriggerLoading(false);
        }
    };

    const statusBadge = (status: string) => {
        const statusLower = status.toLowerCase();
        if (statusLower === 'completed') return 'bg-emerald-100 text-emerald-700';
        if (statusLower === 'failed') return 'bg-red-100 text-red-700';
        if (statusLower === 'processing' || statusLower === 'pending') return 'bg-amber-100 text-amber-700';
        return 'bg-gray-100 text-gray-700';
    };

    return (
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">SaaS Sync Control</h1>
                    <p className="text-sm text-gray-600">
                        Monitor the connection to the SaaS SFTP folders. Only administrators can trigger a manual sync; everyone else can review status.
                    </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                    {configLoading ? (
                        <p>Loading configuration…</p>
                    ) : config ? (
                        <ul className="space-y-1">
                            <li>
                                <strong>Method:</strong> {config.method} · {config.description}
                            </li>
                            <li>
                                <strong>Immediate sync?</strong> {config.immediateSync ? 'Yes' : 'No (scheduled every 15 min)'}
                            </li>
                            {config.windowsSyncUrl && (
                                <li>
                                    <strong>Windows service:</strong> {config.windowsSyncUrl}
                                </li>
                            )}
                            {config.syncTriggerPath && (
                                <li>
                                    <strong>Trigger path:</strong> {config.syncTriggerPath}
                                </li>
                            )}
                            {typeof config.syncTimeout === 'number' && (
                                <li>
                                    <strong>Timeout:</strong> {Math.round(config.syncTimeout / 1000)}s
                                </li>
                            )}
                        </ul>
                    ) : (
                        <p>Configuration unavailable. Try refreshing.</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleManualSync}
                        disabled={!isAdmin || triggerLoading}
                        className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {triggerLoading ? 'Triggering…' : 'Trigger manual sync'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            loadConfig();
                            loadHistory();
                        }}
                        className="rounded-full border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Refresh data
                    </button>
                    {!isAdmin && <p className="text-xs text-gray-500">Only admins can trigger manual syncs.</p>}
                </div>
                {triggerMessage && <p className="text-sm text-emerald-700">{triggerMessage}</p>}
                {triggerError && <p className="text-sm text-red-600">{triggerError}</p>}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Recent sync requests</h2>
                    <p className="text-sm text-gray-500">Latest 15 entries</p>
                </div>
                {historyError && <p className="text-sm text-red-600">{historyError}</p>}
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                            <tr>
                                <th className="px-3 py-2">Requested</th>
                                <th className="px-3 py-2">Requested by</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Files</th>
                                <th className="px-3 py-2">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {historyLoading ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                        Loading history…
                                    </td>
                                </tr>
                            ) : history.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                        No sync activity recorded yet.
                                    </td>
                                </tr>
                            ) : (
                                history.map((entry) => (
                                    <tr key={entry.id}>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                            {formatIsoDateTime(entry.requested_at)}
                                            {entry.completed_at && (
                                                <span className="block text-xs text-gray-400">
                                                    Completed {formatIsoDateTime(entry.completed_at)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-700">
                                            <div>{entry.requester_name || '—'}</div>
                                            <div className="text-xs text-gray-500">{entry.requester_email || '—'}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(entry.status)}`}>
                                                {entry.status}
                                            </span>
                                            {entry.error_message && (
                                                <span className="block text-xs text-red-600">{entry.error_message}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">{typeof entry.files_synced === 'number' ? entry.files_synced : '—'}</td>
                                        <td className="px-3 py-2">{entry.notes || '—'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
