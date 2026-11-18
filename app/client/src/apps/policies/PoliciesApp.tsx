import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { LoadingState } from '../../components/Ui';
import { PolicyLibrary } from './PolicyLibrary';
import { PolicyPage } from './PolicyPage';
import type { PolicyMeta } from './types';

// The editor brings a whole word processor with it, so only people who open
// it download it; readers never do.
const PolicyEditor = lazy(() => import('./PolicyEditor').then((m) => ({ default: m.PolicyEditor })));

/**
 * Policies & Procedures: a library every signed-in account reads, and the
 * drafting and publishing behind it for those ticked to do it.
 */
export function PoliciesApp() {
    const [meta, setMeta] = useState<PolicyMeta | null>(null);
    const [error, setError] = useState('');
    // Moved on when a register entry changes, so new categories reach the filters.
    const [generation, setGeneration] = useState(0);
    const loadMeta = useCallback(async () => setGeneration((n) => n + 1), []);

    useEffect(() => {
        const controller = new AbortController();
        apiClient.get<PolicyMeta>('/policies/meta', { signal: controller.signal })
            .then((loaded) => { setMeta(loaded); setError(''); })
            .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || 'The library could not be loaded.'); });
        return () => controller.abort();
    }, [generation]);

    if (error) return <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;
    if (!meta) return <LoadingState label="Opening the library…" />;

    return (
        <div className="text-sm leading-6">
            <Routes>
                <Route index element={<PolicyLibrary meta={meta} onMetaChanged={loadMeta} />} />
                <Route path=":id" element={<PolicyPage meta={meta} onMetaChanged={loadMeta} />} />
                <Route path=":id/versions/:versionId" element={<PolicyPage meta={meta} onMetaChanged={loadMeta} />} />
                {meta.can_edit && (
                    <Route path=":id/edit" element={<Suspense fallback={<LoadingState label="Opening the editor…" />}><PolicyEditor /></Suspense>} />
                )}
                <Route path="*" element={<Navigate to="/policies" replace />} />
            </Routes>
        </div>
    );
}
