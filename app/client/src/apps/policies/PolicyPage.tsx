import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Pencil, Printer } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatDate, formatDateTime, todayIsoDate } from '../../lib/date';
import { useConfirm } from '../../contexts/useConfirm';
import { useToast } from '../../contexts/useToast';
import { Button, Card, LoadingState } from '../../components/Ui';
import { PolicyBody, type PolicySection } from './PolicyBody';
import { PolicyDetailsModal } from './PolicyDetailsModal';
import { PublishModal } from './PublishModal';
import { fileSize, typeLabel } from './policyContent';
import type { PolicyDocument, PolicyMeta, PolicyVersion } from './types';

function Notice({ tone, children }: { tone: 'blue' | 'amber' | 'gray'; children: ReactNode }) {
    const tones = { blue: 'border-blue-200 bg-blue-50 text-blue-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', gray: 'border-gray-200 bg-gray-50 text-gray-800' };
    return <div className={`rounded-xl border p-3 print:hidden ${tones[tone]}`}>{children}</div>;
}

function SideHeading({ children }: { children: string }) {
    return <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h2>;
}

/**
 * One policy. Readers get the version in force, with its contents, files
 * and history. People who write or publish also get its draft, and the
 * actions their ticks allow.
 */
export function PolicyPage({ meta, onMetaChanged }: { meta: PolicyMeta; onMetaChanged: () => Promise<void> }) {
    const { id = '', versionId } = useParams();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    // Back to the manual, section or search the reader came from, when they came from the library.
    const from = (useLocation().state as { from?: string } | null)?.from;
    const backTo = from?.startsWith('/policies') ? from : '/policies';
    const { confirm, prompt } = useConfirm();
    const { addToast } = useToast();
    const [policy, setPolicy] = useState<PolicyDocument | null>(null);
    const [older, setOlder] = useState<PolicyVersion | null>(null);
    const [error, setError] = useState('');
    const [sections, setSections] = useState<PolicySection[]>([]);
    const [editingDetails, setEditingDetails] = useState(false);
    const [publishing, setPublishing] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        Promise.all([
            apiClient.get<PolicyDocument>(`/policies/${id}`, { signal }),
            versionId ? apiClient.get<PolicyVersion>(`/policies/${id}/versions/${versionId}`, { signal }) : Promise.resolve(null),
        ])
            .then(([doc, version]) => { setPolicy(doc); setOlder(version); setError(''); })
            .catch((err) => { if (!signal.aborted) setError((err as Error).message || 'This document could not be loaded.'); });
        return () => controller.abort();
    }, [id, versionId]);

    if (error) {
        return (
            <div className="space-y-4">
                <Link to={backTo} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><ArrowLeft size={16} aria-hidden="true" />Back to the library</Link>
                <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</p>
            </div>
        );
    }
    if (!policy) return <LoadingState label="Opening the document…" />;

    const { draft, published } = policy;
    const retired = !!policy.retired_at;
    // Whose text is on screen: an earlier version, the draft, or the version in force.
    const showDraft = !older && !!draft && (params.get('view') === 'draft' || !published);
    const shown = older ?? (showDraft ? draft : published);
    const manager = meta.can_edit || meta.can_publish;
    const today = todayIsoDate();

    const replaceWith = (next: PolicyDocument, view?: 'draft') => {
        setPolicy(next);
        setParams(view ? { view } : {}, { replace: true });
    };
    const fail = (err: unknown) => addToast((err as Error).message || 'That did not work. Please try again.', 'error');

    const discard = async () => {
        if (!draft || !await confirm({ title: 'Discard the draft?', message: `Draft version ${draft.version_no} will be thrown away. The version in force stays as it is.`, confirmLabel: 'Discard draft', tone: 'danger' })) return;
        try { replaceWith(await apiClient.delete<PolicyDocument>(`/policies/${id}/draft?revision=${draft.revision}`)); addToast('Draft discarded.', 'success'); } catch (err) { fail(err); }
    };
    const withdraw = async () => {
        const reason = await prompt({ title: 'Withdraw this document?', message: 'Readers will no longer find it in the library. Its history is kept, and it can be restored.', placeholder: 'Why it is being withdrawn', confirmLabel: 'Withdraw' });
        if (!reason) return;
        try { replaceWith(await apiClient.post<PolicyDocument>(`/policies/${id}/withdraw`, { reason })); addToast('Document withdrawn.', 'success'); } catch (err) { fail(err); }
    };
    const restore = async () => {
        if (!await confirm({ title: 'Restore this document?', message: 'Readers will find it in the library again, at the version that was in force.', confirmLabel: 'Restore' })) return;
        try { replaceWith(await apiClient.post<PolicyDocument>(`/policies/${id}/restore`)); addToast('Document restored.', 'success'); } catch (err) { fail(err); }
    };
    const remove = async () => {
        if (!await confirm({ title: 'Delete this document?', message: 'It has never been published, so nothing is kept. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' })) return;
        try { await apiClient.delete(`/policies/${id}`); addToast('Document deleted.', 'success'); navigate('/policies'); } catch (err) { fail(err); }
    };

    const editLabel = draft ? 'Edit the draft' : published ? 'Start a new version' : 'Write the first version';

    return (
        <div className="policy-print space-y-4">
            <Link to={backTo} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline print:hidden"><ArrowLeft size={16} aria-hidden="true" />Back to the library</Link>

            {retired && (
                <Notice tone="gray">
                    <p><strong>Withdrawn</strong> on {formatDate(policy.retired_at)}{policy.retired_by_name ? ` by ${policy.retired_by_name}` : ''}: {policy.retired_reason}</p>
                    <p>Readers cannot find or open it.</p>
                </Notice>
            )}
            {older && (
                <Notice tone="amber">
                    {older.status === 'superseded'
                        ? <p>You are reading <strong>version {older.version_no}</strong>, in force from {formatDate(older.published_at)} to {formatDate(older.superseded_at)}. It has been replaced. <Link to={`/policies/${id}`} className="font-medium underline">Read the version in force</Link></p>
                        : <p>This is the version in force. <Link to={`/policies/${id}`} className="font-medium underline">Open the document</Link></p>}
                </Notice>
            )}
            {showDraft && draft && (
                <Notice tone="blue">
                    <p><strong>Draft of version {draft.version_no}.</strong> Only people who write or publish policies can see it.{' '}
                        {draft.updated_by_name && <>Last saved {formatDateTime(draft.updated_at)} by {draft.updated_by_name}.</>}</p>
                    {published && <p><button type="button" onClick={() => setParams({}, { replace: true })} className="font-medium underline">Read version {published.version_no}, in force</button></p>}
                </Notice>
            )}
            {!older && !showDraft && draft && manager && (
                <Notice tone="blue">
                    <p>There is a draft of version {draft.version_no}. <button type="button" onClick={() => setParams({ view: 'draft' }, { replace: true })} className="font-medium underline">Read the draft</button></p>
                </Notice>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] print:block">
                <Card className="p-5 sm:p-8 print:border-0 print:p-0 print:shadow-none">
                    <article>
                        <header className="mb-6 border-b border-gray-200 pb-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    {!!policy.categories.length && (
                                        <p className="mb-2 flex flex-wrap gap-1.5 text-xs font-medium text-gray-600">
                                            {policy.categories.map((tag) => (
                                                <span key={tag.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 print:bg-transparent print:px-0">
                                                    {tag.parent_id && tag.parent_name && (
                                                        <><Link to={`/policies?category=${tag.parent_id}`} className="hover:text-brand hover:underline">{tag.parent_name}</Link> › </>
                                                    )}
                                                    <Link to={`/policies?category=${tag.id}`} className="hover:text-brand hover:underline">{tag.name}</Link>
                                                </span>
                                            ))}
                                        </p>
                                    )}
                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        {policy.code} · {typeLabel(meta, policy.doc_type)}
                                    </p>
                                </div>
                                {shown && (
                                    <button type="button" onClick={() => window.print()} className="toolbar-button max-sm:hidden print:hidden">
                                        <Printer size={15} aria-hidden="true" />Print
                                    </button>
                                )}
                            </div>
                            <h1 className="mt-1 text-2xl font-bold text-gray-900">{policy.title}</h1>
                            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
                                {shown && <div><dt className="inline font-medium text-gray-700">Version </dt><dd className="inline">{shown.version_no}{shown.status === 'draft' ? ' (draft)' : ''}</dd></div>}
                                {shown?.published_at && <div><dt className="inline font-medium text-gray-700">In force from </dt><dd className="inline">{formatDate(shown.published_at)}</dd></div>}
                                {policy.department_name && <div><dt className="inline font-medium text-gray-700">Owner </dt><dd className="inline">{policy.department_name}</dd></div>}
                                {policy.review_due && (
                                    <div><dt className="inline font-medium text-gray-700">Next review </dt>
                                        <dd className={`inline ${manager && policy.review_due < today ? 'font-medium text-rose-700' : ''}`}>{formatDate(policy.review_due)}{manager && policy.review_due < today ? ' (overdue)' : ''}</dd></div>
                                )}
                            </dl>
                        </header>
                        {shown && shown.body_html
                            ? <PolicyBody html={shown.body_html} onSections={setSections} />
                            : <p className="text-gray-500">{meta.can_edit && !retired ? 'Nothing has been written yet.' : 'There is no text yet.'}</p>}
                        <p className="mt-8 hidden border-t border-gray-300 pt-2 text-xs text-gray-600 print:block">
                            {policy.code} version {shown?.version_no}{shown?.status === 'draft' ? ' (DRAFT, not in force)' : ''}. Printed {formatDate(today)}.
                            Uncontrolled when printed: the version in force is in the Treasury Portal under Policies &amp; Procedures.
                        </p>
                    </article>
                </Card>

                <aside className="space-y-4 print:hidden">
                    {manager && (
                        <Card>
                            <SideHeading>Manage</SideHeading>
                            <div className="flex flex-col gap-2">
                                {meta.can_edit && !retired && <Button onClick={() => navigate(`/policies/${id}/edit`)}><Pencil size={15} aria-hidden="true" />{editLabel}</Button>}
                                {meta.can_publish && !retired && showDraft && draft && <Button onClick={() => setPublishing(true)}>Publish version {draft.version_no}</Button>}
                                {meta.can_publish && !retired && draft && !showDraft && !older && (
                                    <p className="text-xs text-gray-500">To publish, read the draft first.</p>
                                )}
                                {meta.can_edit && <Button variant="secondary" onClick={() => setEditingDetails(true)}>Edit details</Button>}
                                {meta.can_edit && !retired && draft && published && <Button variant="secondary" onClick={discard}>Discard the draft</Button>}
                                {meta.can_publish && !retired && policy.was_published && <Button variant="secondary" onClick={withdraw}>Withdraw</Button>}
                                {meta.can_publish && retired && <Button variant="secondary" onClick={restore}>Restore</Button>}
                                {meta.can_edit && !policy.was_published && <Button variant="danger" onClick={remove}>Delete</Button>}
                            </div>
                        </Card>
                    )}

                    {sections.length > 1 && shown?.body_html && (
                        <Card>
                            <SideHeading>Contents</SideHeading>
                            <nav aria-label="Contents">
                                <ol className="space-y-1">
                                    {sections.map((section) => (
                                        <li key={section.id} className={section.level === 3 ? 'pl-3' : ''}>
                                            <a href={`#${section.id}`} className={`text-brand hover:underline ${section.level === 3 ? 'text-[13px]' : 'font-medium'}`}>{section.text}</a>
                                        </li>
                                    ))}
                                </ol>
                            </nav>
                        </Card>
                    )}

                    {!!shown?.attachments.length && (
                        <Card>
                            <SideHeading>Files</SideHeading>
                            <ul className="space-y-1.5">
                                {shown.attachments.map((file) => (
                                    <li key={file.id}>
                                        <a href={file.url} download={file.file_name} className="inline-flex items-start gap-1.5 font-medium text-brand hover:underline">
                                            <Download size={14} aria-hidden="true" className="mt-1 shrink-0" />
                                            <span>{file.file_name} <span className="font-normal text-gray-500">({fileSize(file.byte_size)})</span></span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}

                    {!!policy.versions.length && (
                        <Card>
                            <SideHeading>History</SideHeading>
                            <ol className="space-y-3">
                                {policy.versions.map((version) => {
                                    const current = (older ? older.id : showDraft ? null : published?.id) === version.id;
                                    const to = version.status === 'published' ? `/policies/${id}` : `/policies/${id}/versions/${version.id}`;
                                    return (
                                        <li key={version.id}>
                                            <p>
                                                {current
                                                    ? <span className="font-semibold text-gray-900">Version {version.version_no}</span>
                                                    : <Link to={to} className="font-semibold text-brand hover:underline">Version {version.version_no}</Link>}
                                                <span className="text-gray-500"> · {formatDate(version.published_at)}{version.status === 'published' ? ', in force' : ''}</span>
                                            </p>
                                            {version.change_summary && <p className="text-gray-600">{version.change_summary}</p>}
                                            {version.published_by_name && <p className="text-xs text-gray-500">Published by {version.published_by_name}</p>}
                                        </li>
                                    );
                                })}
                            </ol>
                        </Card>
                    )}
                </aside>
            </div>

            {editingDetails && (
                <PolicyDetailsModal meta={meta} policy={policy} onClose={() => setEditingDetails(false)}
                    onSaved={async (saved) => { setEditingDetails(false); setPolicy(saved); await onMetaChanged(); addToast('Details saved.', 'success'); }} />
            )}
            {publishing && draft && (
                <PublishModal policy={policy} draft={draft} onClose={() => setPublishing(false)}
                    onPublished={(next) => { setPublishing(false); replaceWith(next); addToast(`Version ${draft.version_no} is now in force.`, 'success'); }} />
            )}
        </div>
    );
}
