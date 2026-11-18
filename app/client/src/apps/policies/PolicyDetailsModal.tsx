import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button, Modal, ModalActions } from '../../components/Ui';
import { categoryLabel, categoryTree } from './policyContent';
import type { PolicyDetails, PolicyDocument, PolicyMeta } from './types';

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * Tags a document with categories from the managed list: manuals and their
 * sections as ticks, with a filter for when the list is long. Nobody types a
 * category here, so the library never gains near-duplicates.
 */
function CategoryPicker({ meta, value, onChange }: { meta: PolicyMeta; value: string[]; onChange: (ids: string[]) => void }) {
    const [filter, setFilter] = useState('');
    const tree = useMemo(() => categoryTree(meta.categories), [meta.categories]);
    const words = filter.trim().toLowerCase();
    const matches = (name: string) => !words || name.toLowerCase().includes(words);
    const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    const shown = tree
        .map((m) => ({ ...m, sections: matches(m.name) ? m.sections : m.sections.filter((s) => matches(s.name)) }))
        .filter((m) => matches(m.name) || m.sections.length);

    if (!tree.length) {
        return (
            <p className="rounded-lg border border-dashed border-gray-300 p-3 text-gray-500">
                No categories yet. {meta.can_publish ? 'Add manuals and sections under Manage categories in the library.' : 'Someone with Approve and publish adds them.'}
            </p>
        );
    }
    return (
        <div className="rounded-lg border border-gray-300">
            {!!value.length && (
                <ul className="flex flex-wrap gap-1.5 border-b border-gray-200 p-2" aria-label="Chosen categories">
                    {value.map((id) => (
                        <li key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand ring-1 ring-inset ring-blue-200">
                            {categoryLabel(meta.categories, id)}
                            <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${categoryLabel(meta.categories, id)}`} className="rounded-full p-0.5 hover:bg-blue-100">
                                <X size={12} aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {meta.categories.length > 8 && (
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a category"
                    aria-label="Find a category" className="w-full border-b border-gray-200 px-3 py-2 focus:outline-none" />
            )}
            <div className="max-h-56 overflow-y-auto p-2">
                {shown.map((m) => (
                    <div key={m.id} className="py-0.5">
                        <label className="flex items-center gap-2 rounded px-1 py-0.5 font-medium text-gray-800 hover:bg-gray-50">
                            <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} />
                            {m.name}
                        </label>
                        {m.sections.map((s) => (
                            <label key={s.id} className="ml-6 flex items-center gap-2 rounded px-1 py-0.5 text-gray-700 hover:bg-gray-50">
                                <input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} />
                                {s.name}
                            </label>
                        ))}
                    </div>
                ))}
                {!shown.length && <p className="px-1 text-gray-500">No category matches.</p>}
            </div>
        </div>
    );
}

/** The register entry for a document: registering a new one, or changing an existing one. */
export function PolicyDetailsModal({ meta, policy, presetCategory, onClose, onSaved }: {
    meta: PolicyMeta;
    policy?: PolicyDocument;
    /** For a new document, the category being browsed, ticked to start with. */
    presetCategory?: string;
    onClose: () => void;
    onSaved: (saved: PolicyDocument) => void | Promise<void>;
}) {
    const [form, setForm] = useState<PolicyDetails>({
        code: policy?.code ?? '',
        title: policy?.title ?? '',
        doc_type: policy?.doc_type ?? meta.types[0]?.key ?? '',
        category_ids: policy ? policy.categories.map((c) => c.id) : presetCategory ? [presetCategory] : [],
        department_id: policy?.department_id ?? '',
        review_due: policy?.review_due ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (key: Exclude<keyof PolicyDetails, 'category_ids'>, value: string) => setForm((current) => ({ ...current, [key]: value }));

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
            size="2xl"
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
                <fieldset>
                    <legend className="mb-1 font-medium text-gray-700">Categories <span className="font-normal text-gray-500">(where it sits in the library; choose one or more)</span></legend>
                    <CategoryPicker meta={meta} value={form.category_ids} onChange={(ids) => setForm((current) => ({ ...current, category_ids: ids }))} />
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block">
                        <span className="mb-1 block font-medium text-gray-700">Kind</span>
                        <select value={form.doc_type} onChange={(e) => set('doc_type', e.target.value)} className={field}>
                            {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
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
