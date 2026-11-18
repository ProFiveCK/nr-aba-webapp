import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../../lib/api';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button, Modal, ModalActions } from '../../components/Ui';
import type { PolicyDetails, PolicyDocument, PolicyMeta } from './types';

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** The register entry for a policy: registering a new one, or changing an existing one. */
export function PolicyDetailsModal({ meta, policy, onClose, onSaved }: {
    meta: PolicyMeta;
    policy?: PolicyDocument;
    onClose: () => void;
    onSaved: (saved: PolicyDocument) => void | Promise<void>;
}) {
    const categoriesId = useId();
    const [form, setForm] = useState<PolicyDetails>({
        code: policy?.code ?? '',
        title: policy?.title ?? '',
        doc_type: policy?.doc_type ?? meta.types[0]?.key ?? '',
        category: policy?.category ?? '',
        department_id: policy?.department_id ?? '',
        review_due: policy?.review_due ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (key: keyof PolicyDetails, value: string) => setForm((current) => ({ ...current, [key]: value }));

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const body = { ...form, department_id: form.department_id || null, review_due: form.review_due || null };
            const saved = policy
                ? await apiClient.patch<PolicyDocument>(`/policies/${policy.id}`, body)
                : await apiClient.post<PolicyDocument>('/policies', body);
            await onSaved(saved);
        } catch (err) {
            setError((err as Error).message || 'The details could not be saved.');
            setSaving(false);
        }
    };

    return (
        <Modal
            title={policy ? 'Document details' : 'New document'}
            description={policy ? undefined : 'Register the document first. You write its text next, and it reaches readers once it is published.'}
            onClose={onClose}
            closeDisabled={saving}
            size="lg"
        >
            <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Code</span>
                        <input required maxLength={40} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="FIN-SOP-001" className={field} />
                    </label>
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Title</span>
                        <input required maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} className={field} />
                    </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Kind</span>
                        <select value={form.doc_type} onChange={(e) => set('doc_type', e.target.value)} className={field}>
                            {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Category <span className="font-normal text-gray-500">(optional)</span></span>
                        <input maxLength={80} list={categoriesId} value={form.category ?? ''} onChange={(e) => set('category', e.target.value)}
                            placeholder="For example, Payments" className={field} />
                        <datalist id={categoriesId}>{meta.categories.map((c) => <option key={c} value={c} />)}</datalist>
                    </label>
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Owning department <span className="font-normal text-gray-500">(optional)</span></span>
                        <select value={form.department_id ?? ''} onChange={(e) => set('department_id', e.target.value)} className={field}>
                            <option value="">Not set</option>
                            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Next review <span className="font-normal text-gray-500">(optional)</span></span>
                        <AustralianDateInput value={form.review_due ?? ''} onChange={(e) => set('review_due', e.target.value)} className={field} />
                    </label>
                </div>
                {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
                <ModalActions>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" loading={saving}>{policy ? 'Save details' : 'Register and start writing'}</Button>
                </ModalActions>
            </form>
        </Modal>
    );
}
