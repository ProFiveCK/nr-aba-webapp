import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { Button, LoadingState, Modal } from '../../components/Ui';
import { diffParagraphs } from './policyDiff';
import type { PolicyVersion } from './types';

/**
 * What changed between two versions, from their plain texts: removed lines in
 * red, added in green, with long stretches of untouched text folded away.
 */
export function PolicyDiffModal({ policyId, from, to, onClose }: {
    policyId: string;
    from: Pick<PolicyVersion, 'id' | 'version_no'>;
    to: Pick<PolicyVersion, 'id' | 'version_no'>;
    onClose: () => void;
}) {
    const [older, setOlder] = useState<PolicyVersion | null>(null);
    const [newer, setNewer] = useState<PolicyVersion | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        Promise.all([
            apiClient.get<PolicyVersion>(`/policies/${policyId}/versions/${from.id}`, { signal: controller.signal }),
            apiClient.get<PolicyVersion>(`/policies/${policyId}/versions/${to.id}`, { signal: controller.signal }),
        ])
            .then(([a, b]) => { setOlder(a); setNewer(b); })
            .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || 'The versions could not be loaded.'); });
        return () => controller.abort();
    }, [policyId, from.id, to.id]);

    const rows = older && newer ? diffParagraphs(older.body_text ?? '', newer.body_text ?? '') : null;
    const changes = rows?.filter((row) => row.kind !== 'same').length ?? 0;

    return (
        <Modal title={`Version ${from.version_no} → ${to.version_no}`} description="What the texts changed. Removed lines first, as they stood before." size="xl" onClose={onClose}>
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
            {!rows && !error && <LoadingState label="Comparing the versions…" />}
            {rows && (
                <>
                    <p className="mb-3 text-sm text-gray-600">{changes} changed section{changes === 1 ? '' : 's'} between the two versions.</p>
                    <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                        {rows.map((row, i) => row.kind === 'same' && row.collapsed ? (
                            <p key={i} className="px-2 py-0.5 text-center text-xs text-gray-400">{row.text}</p>
                        ) : (
                            <p key={i} className={`rounded-md px-3 py-1.5 text-[13px] ${row.kind === 'removed' ? 'bg-rose-50 text-rose-900 line-through decoration-rose-300' : row.kind === 'added' ? 'bg-emerald-50 text-emerald-900' : 'text-gray-600'}`}>
                                {row.text}
                            </p>
                        ))}
                    </div>
                    <div className="flex justify-end pt-3"><Button variant="secondary" onClick={onClose}>Close</Button></div>
                </>
            )}
        </Modal>
    );
}
