import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button, Modal, ModalActions } from '../../components/Ui';
import { aYearAfter } from './policyContent';
import type { PolicyDocument, PolicyVersion } from './types';

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Puts the draft the publisher has just read into force. */
export function PublishModal({ policy, draft, onClose, onPublished }: {
    policy: PolicyDocument;
    draft: PolicyVersion;
    onClose: () => void;
    onPublished: (published: PolicyDocument) => void;
}) {
    const today = todayIsoDate();
    const [summary, setSummary] = useState(draft.change_summary ?? (policy.published ? '' : 'First version.'));
    // Keep a review date still ahead; otherwise suggest a year from today.
    const [reviewDue, setReviewDue] = useState(policy.review_due && policy.review_due > today ? policy.review_due : aYearAfter(today));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            onPublished(await apiClient.post<PolicyDocument>(`/policies/${policy.id}/publish`, {
                revision: draft.revision, change_summary: summary, review_due: reviewDue || null,
            }));
        } catch (err) {
            setError((err as Error).message || 'The draft could not be published.');
            setSaving(false);
        }
    };

    return (
        <Modal title={`Publish version ${draft.version_no}`} onClose={onClose} closeDisabled={saving} size="lg"
            description={policy.published
                ? `Version ${draft.version_no} goes into force now, for everyone signed in to the portal. Version ${policy.published.version_no} stays in the history.`
                : 'This version goes into force now, for everyone signed in to the portal.'}>
            <form onSubmit={submit} className="space-y-4">
                <label className="block">
                    <span className="mb-1 block font-medium text-gray-700">What this version changes</span>
                    <textarea required maxLength={500} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} className={field}
                        placeholder="For example: Adds the second signature for payments over $10,000." />
                    <span className="mt-1 block text-xs text-gray-500">Shown in the version history, so readers can see what changed and when.</span>
                </label>
                <label className="block sm:max-w-xs">
                    <span className="mb-1 block font-medium text-gray-700">Next review</span>
                    <AustralianDateInput value={reviewDue} min={today} onChange={(e) => setReviewDue(e.target.value)} className={field} />
                </label>
                {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
                <ModalActions>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" loading={saving}>Publish now</Button>
                </ModalActions>
            </form>
        </Modal>
    );
}
