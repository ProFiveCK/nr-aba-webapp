import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { formatIsoDateTime, formatPdNumber, getBatchStageBadgeClasses, getBatchStageMetadata } from '../lib/utils';
import { BatchDetailModal } from './MyBatches/BatchDetailModal';
import type { Batch, BatchDetail } from './MyBatches/types';

export function MyBatches() {
    const [batches, setBatches] = useState<Batch[]>([]);
    const [filteredBatches, setFilteredBatches] = useState<Batch[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);

    // Load batches from API
    const loadBatches = async () => {
        if (loading) return;

        setLoading(true);
        setError(null);

        try {
            const data = await apiClient.get<Batch[]>('/my/batches');
            setBatches(data || []);
            setFilteredBatches(data || []);
        } catch (err) {
            setError((err as Error)?.message || 'Failed to load batches');
            setBatches([]);
            setFilteredBatches([]);
        } finally {
            setLoading(false);
        }
    };

    // Load batch detail
    const loadBatchDetail = async (code: string) => {
        try {
            const data = await apiClient.get<BatchDetail>(`/my/batches/${encodeURIComponent(code)}`);
            setSelectedBatch(data);
        } catch (err) {
            setError((err as Error)?.message || 'Failed to load batch details');
        }
    };

    // Filter batches based on search term
    useEffect(() => {
        if (!searchTerm.trim()) {
            setFilteredBatches(batches);
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = batches.filter((batch) => {
            const code = batch.code?.toLowerCase() || '';
            const pd = batch.pd_number?.toLowerCase() || '';
            const dept = batch.department_code?.toLowerCase() || '';
            const stage = batch.stage?.toLowerCase() || '';
            return code.includes(term) || pd.includes(term) || dept.includes(term) || stage.includes(term);
        });
        setFilteredBatches(filtered);
    }, [searchTerm, batches]);

    // Load batches on mount
    useEffect(() => {
        loadBatches();
    }, []);

    return (
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">My Batches</h1>
                        <p className="text-sm text-gray-600">View and track submissions that you have generated.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="text"
                            placeholder="Search code or PD#"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                            onClick={() => loadBatches()}
                            disabled={loading}
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? 'Loading…' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                )}

                <div className="overflow-hidden rounded-xl border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Code</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Status</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">PD#</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Department</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Created</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Last Updated</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-700">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading && batches.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading your batches…</td>
                                </tr>
                            ) : filteredBatches.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                        {searchTerm ? 'No batches match your search.' : 'No batches found.'}
                                    </td>
                                </tr>
                            ) : (
                                filteredBatches.map((batch) => {
                                    const stageMetadata = getBatchStageMetadata(batch.stage);
                                    const badgeClasses = getBatchStageBadgeClasses(batch.stage);

                                    return (
                                        <tr key={batch.code} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 text-sm font-mono text-gray-900">{batch.code}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClasses}`}>
                                                    {stageMetadata.label}
                                                </span>
                                                {batch.is_draft && (
                                                    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                                                        Draft
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900">
                                                {batch.pd_number ? formatPdNumber(batch.pd_number) : 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{batch.department_code || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{formatIsoDateTime(batch.created_at)}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">
                                                {formatIsoDateTime(batch.stage_updated_at || batch.created_at)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => loadBatchDetail(batch.code)}
                                                    className="px-3 py-1.5 rounded-md bg-indigo-500 text-xs font-medium text-white hover:bg-indigo-600"
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                {!loading && filteredBatches.length > 0 && (
                    <div className="text-sm text-gray-600">
                        Showing {filteredBatches.length} of {batches.length} batch{batches.length === 1 ? '' : 'es'}
                    </div>
                )}
            </section>

            {selectedBatch && (
                <BatchDetailModal
                    batch={selectedBatch}
                    onClose={() => setSelectedBatch(null)}
                />
            )}
        </div>
    );

}
