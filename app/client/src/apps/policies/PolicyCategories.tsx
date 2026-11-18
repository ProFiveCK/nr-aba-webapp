import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useConfirm } from '../../contexts/useConfirm';
import { useToast } from '../../contexts/useToast';
import { Button, Card, EmptyState, Modal, ModalActions } from '../../components/Ui';
import { categoryTree } from './policyContent';
import type { PolicyCategory, PolicyMeta } from './types';

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Adding or changing one category: its name, and which manual it is a section of, if any. */
function CategoryModal({ meta, category, parentId, onClose, onSaved }: {
    meta: PolicyMeta;
    category?: PolicyCategory;
    parentId?: string | null;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const manuals = categoryTree(meta.categories).filter((m) => m.id !== category?.id);
    const hasSections = !!category && meta.categories.some((c) => c.parent_id === category.id);
    const [name, setName] = useState(category?.name ?? '');
    const [parent, setParent] = useState(category ? category.parent_id ?? '' : parentId ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const kind = parent ? 'section' : 'manual';

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const body = { name, parent_id: parent || null };
            if (category) await apiClient.patch(`/policies/categories/${category.id}`, body);
            else await apiClient.post('/policies/categories', body);
            await onSaved();
        } catch (err) {
            setError((err as Error).message || 'The category could not be saved.');
            setSaving(false);
        }
    };

    return (
        <Modal title={category ? `Change ${category.name}` : `Add a ${kind}`} onClose={onClose} closeDisabled={saving}>
            <form onSubmit={submit} className="space-y-4">
                <label className="block">
                    <span className="mb-1 block font-medium text-gray-700">Name</span>
                    <input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field}
                        placeholder={kind === 'manual' ? 'For example, Finance Manual' : 'For example, Payments'} />
                </label>
                <label className="block">
                    <span className="mb-1 block font-medium text-gray-700">Place in the library</span>
                    <select value={parent} onChange={(e) => setParent(e.target.value)} disabled={hasSections} className={field}>
                        <option value="">A manual of its own (top level)</option>
                        {manuals.map((m) => <option key={m.id} value={m.id}>A section of {m.name}</option>)}
                    </select>
                    {hasSections && <span className="mt-1 block text-xs text-gray-500">It has sections, so it stays a manual.</span>}
                </label>
                {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
                <ModalActions>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" loading={saving}>{category ? 'Save' : `Add ${kind}`}</Button>
                </ModalActions>
            </form>
        </Modal>
    );
}

function Row({ category, first, last, onEdit, onMove, onRemove, section = false }: {
    category: PolicyCategory;
    first: boolean;
    last: boolean;
    onEdit: () => void;
    onMove: (direction: 'up' | 'down') => void;
    onRemove: () => void;
    section?: boolean;
}) {
    return (
        <div className={`flex items-center justify-between gap-2 ${section ? 'border-t border-gray-100 py-1.5 pl-4' : ''}`}>
            <div className="min-w-0">
                <span className={section ? 'text-gray-800' : 'text-base font-semibold text-gray-900'}>{category.name}</span>
                <span className="ml-2 text-xs text-gray-500">{category.document_count} document{category.document_count === 1 ? '' : 's'}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="icon-button" onClick={() => onMove('up')} disabled={first} aria-label={`Move ${category.name} up`} title="Move up"><ArrowUp size={14} /></button>
                <button type="button" className="icon-button" onClick={() => onMove('down')} disabled={last} aria-label={`Move ${category.name} down`} title="Move down"><ArrowDown size={14} /></button>
                <button type="button" className="icon-button" onClick={onEdit} aria-label={`Rename or move ${category.name}`} title="Rename or move"><Pencil size={14} /></button>
                <button type="button" className="icon-button hover:!border-rose-200 hover:!bg-rose-50 hover:!text-rose-700" onClick={onRemove} aria-label={`Remove ${category.name}`} title="Remove"><Trash2 size={14} /></button>
            </div>
        </div>
    );
}

/**
 * The library's structure, for publishers: manuals and their sections, in
 * the order readers see them. Editors pick from this list when they tag a
 * document; nobody else adds categories.
 */
export function PolicyCategories({ meta, onMetaChanged }: { meta: PolicyMeta; onMetaChanged: () => Promise<void> }) {
    const { confirm } = useConfirm();
    const { addToast } = useToast();
    const tree = useMemo(() => categoryTree(meta.categories), [meta.categories]);
    const [editing, setEditing] = useState<{ category?: PolicyCategory; parentId?: string | null } | null>(null);
    const fail = (err: unknown) => addToast((err as Error).message || 'That did not work. Please try again.', 'error');

    const move = async (category: PolicyCategory, direction: 'up' | 'down') => {
        try { await apiClient.post(`/policies/categories/${category.id}/move`, { direction }); await onMetaChanged(); } catch (err) { fail(err); }
    };
    const remove = async (category: PolicyCategory) => {
        if (!await confirm({ title: `Remove ${category.name}?`, message: 'Only a category with no documents and no sections can be removed.', confirmLabel: 'Remove', tone: 'danger' })) return;
        try { await apiClient.delete(`/policies/categories/${category.id}`); await onMetaChanged(); addToast(`${category.name} removed.`, 'success'); } catch (err) { fail(err); }
    };
    const rowProps = (category: PolicyCategory, siblings: PolicyCategory[], index: number) => ({
        category,
        first: index === 0,
        last: index === siblings.length - 1,
        onEdit: () => setEditing({ category }),
        onMove: (direction: 'up' | 'down') => void move(category, direction),
        onRemove: () => void remove(category),
    });

    return (
        <div className="space-y-4">
            <Link to="/policies" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><ArrowLeft size={16} aria-hidden="true" />Back to the library</Link>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Categories</h2>
                    <p className="max-w-2xl text-gray-600">
                        Manuals and their sections organise the library, in the order set here. Editors tag each document with one or more of them.
                    </p>
                </div>
                <Button onClick={() => setEditing({ parentId: null })}><Plus size={16} aria-hidden="true" />Add a manual</Button>
            </div>

            {!tree.length && (
                <Card><EmptyState title="No categories yet." detail="Start with a manual, such as Finance Manual, then add its sections." /></Card>
            )}
            {tree.map((manual, i) => (
                <Card key={manual.id}>
                    <Row {...rowProps(manual, tree, i)} />
                    <div className="mt-2">
                        {manual.sections.map((s, j) => <Row key={s.id} section {...rowProps(s, manual.sections, j)} />)}
                    </div>
                    <button type="button" onClick={() => setEditing({ parentId: manual.id })}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-brand hover:bg-blue-50">
                        <FolderPlus size={14} aria-hidden="true" />Add a section to {manual.name}
                    </button>
                </Card>
            ))}

            {editing && (
                <CategoryModal meta={meta} category={editing.category} parentId={editing.parentId}
                    onClose={() => setEditing(null)}
                    onSaved={async () => { setEditing(null); await onMetaChanged(); addToast('Categories saved.', 'success'); }} />
            )}
        </div>
    );
}
