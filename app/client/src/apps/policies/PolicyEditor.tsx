import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import {
    ArrowLeft, Bold, FileUp, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Paperclip, Quote,
    Redo2, Strikethrough, Table, Underline, Undo2, Unlink,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { useConfirm } from '../../contexts/useConfirm';
import { useToast } from '../../contexts/useToast';
import { Button, Card, LoadingState } from '../../components/Ui';
import type { PolicyDocument, PolicyFile } from './types';

const PICTURES = '.png,.jpg,.jpeg,.gif,.webp';
const ATTACHMENTS = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.png,.jpg,.jpeg,.gif,.webp';

// Only the library's own stored pictures are pictures here, as on the server:
// one pasted from another site or as raw data is dropped at once, rather than
// showing in the editor and vanishing on save.
const LibraryImage = Image.extend({
    parseHTML() {
        return [{ tag: 'img[src^="/api/policies/files/"]' }];
    },
}).configure({ allowBase64: false });

const EXTENSIONS = [
    StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TableKit.configure({ table: { resizable: false } }),
    LibraryImage,
];

/** Loads the document, then hands it to the workspace, which starts from it once. */
export function PolicyEditor() {
    const { id = '' } = useParams();
    const [policy, setPolicy] = useState<PolicyDocument | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        apiClient.get<PolicyDocument>(`/policies/${id}`, { signal: controller.signal })
            .then(setPolicy)
            .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || 'This document could not be opened.'); });
        return () => controller.abort();
    }, [id]);

    if (error) return <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</p>;
    if (!policy) return <LoadingState label="Opening the document…" />;
    if (policy.retired_at) {
        return (
            <Card>
                <p>This document has been withdrawn. Restore it before changing it.</p>
                <Link to={`/policies/${id}`} className="mt-2 inline-block font-medium text-brand hover:underline">Back to the document</Link>
            </Card>
        );
    }
    return <EditorWorkspace key={policy.id} policy={policy} />;
}

function ToolButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
    return (
        // Pressing a tool must not take the cursor out of the text, or the
        // next keystroke lands on the button instead of in the document.
        <button type="button" onMouseDown={keepCursor} onClick={onClick} disabled={disabled} title={label} aria-label={label}
            aria-pressed={active === undefined ? undefined : active}
            className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-gray-700 transition-colors hover:bg-blue-50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-blue-100 text-brand' : ''}`}>
            {children}
        </button>
    );
}

const keepCursor = (event: MouseEvent) => event.preventDefault();

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-gray-200" />;

function Toolbar({ editor, busy, onLink, onPicture, onAttachment, onWord }: {
    editor: Editor;
    busy: boolean;
    onLink: () => void;
    onPicture: () => void;
    onAttachment: () => void;
    onWord: () => void;
}) {
    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            block: e.isActive('heading', { level: 2 }) ? '2' : e.isActive('heading', { level: 3 }) ? '3' : e.isActive('heading', { level: 4 }) ? '4' : 'p',
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            quote: e.isActive('blockquote'),
            link: e.isActive('link'),
            table: e.isActive('table'),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
        }),
    });
    const run = () => editor.chain().focus();
    const setBlock = (value: string) => {
        if (value === 'p') run().setParagraph().run();
        else run().setHeading({ level: Number(value) as 2 | 3 | 4 }).run();
    };

    return (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5" role="toolbar" aria-label="Formatting">
            <select aria-label="Paragraph style" value={state.block} onChange={(e) => setBlock(e.target.value)}
                className="mr-1 h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
                <option value="p">Paragraph</option>
                <option value="2">Heading</option>
                <option value="3">Subheading</option>
                <option value="4">Minor heading</option>
            </select>
            <ToolButton label="Bold" active={state.bold} onClick={() => run().toggleBold().run()}><Bold size={16} /></ToolButton>
            <ToolButton label="Italic" active={state.italic} onClick={() => run().toggleItalic().run()}><Italic size={16} /></ToolButton>
            <ToolButton label="Underline" active={state.underline} onClick={() => run().toggleUnderline().run()}><Underline size={16} /></ToolButton>
            <ToolButton label="Strikethrough" active={state.strike} onClick={() => run().toggleStrike().run()}><Strikethrough size={16} /></ToolButton>
            <Divider />
            <ToolButton label="Bulleted list" active={state.bullet} onClick={() => run().toggleBulletList().run()}><List size={16} /></ToolButton>
            <ToolButton label="Numbered list" active={state.ordered} onClick={() => run().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
            <ToolButton label="Quote or note" active={state.quote} onClick={() => run().toggleBlockquote().run()}><Quote size={16} /></ToolButton>
            <ToolButton label="Dividing line" onClick={() => run().setHorizontalRule().run()}><Minus size={16} /></ToolButton>
            <Divider />
            {state.link
                ? <ToolButton label="Remove link" active onClick={() => run().extendMarkRange('link').unsetLink().run()}><Unlink size={16} /></ToolButton>
                : <ToolButton label="Add link" onClick={onLink}><Link2 size={16} /></ToolButton>}
            <ToolButton label="Insert table" disabled={state.table} onClick={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={16} /></ToolButton>
            <ToolButton label="Insert picture" disabled={busy} onClick={onPicture}><ImagePlus size={16} /></ToolButton>
            <ToolButton label="Attach a file" disabled={busy} onClick={onAttachment}><Paperclip size={16} /></ToolButton>
            <Divider />
            <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => run().undo().run()}><Undo2 size={16} /></ToolButton>
            <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => run().redo().run()}><Redo2 size={16} /></ToolButton>
            <span className="ml-auto" />
            <button type="button" onClick={onWord} disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-brand disabled:opacity-50">
                <FileUp size={15} aria-hidden="true" />Import from Word
            </button>
            {state.table && (
                <div className="flex w-full flex-wrap items-center gap-1 border-t border-gray-200 pt-1.5 text-xs" role="group" aria-label="Table">
                    <span className="mr-1 font-medium text-gray-500">Table:</span>
                    {([
                        ['Add row below', () => run().addRowAfter().run()],
                        ['Add column right', () => run().addColumnAfter().run()],
                        ['Header row on/off', () => run().toggleHeaderRow().run()],
                        ['Delete row', () => run().deleteRow().run()],
                        ['Delete column', () => run().deleteColumn().run()],
                        ['Delete table', () => run().deleteTable().run()],
                    ] as const).map(([label, action]) => (
                        <button key={label} type="button" onMouseDown={keepCursor} onClick={action} className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-blue-50 hover:text-brand">{label}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Writing a draft. It starts from the saved draft, or from the version in
 * force when there is no draft yet, and becomes the draft on the first save.
 * Readers see none of it until someone with "Approve and publish" publishes it.
 */
function EditorWorkspace({ policy }: { policy: PolicyDocument }) {
    const navigate = useNavigate();
    const { confirm, prompt } = useConfirm();
    const { addToast } = useToast();
    const [revision, setRevision] = useState<number | null>(policy.draft?.revision ?? null);
    const [versionNo, setVersionNo] = useState(policy.draft?.version_no ?? (policy.versions[0]?.version_no ?? 0) + 1);
    const [savedAt, setSavedAt] = useState(policy.draft ? { at: policy.draft.updated_at, by: policy.draft.updated_by_name } : null);
    const [summary, setSummary] = useState(policy.draft?.change_summary ?? '');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState('');
    const [notes, setNotes] = useState<string[]>([]);
    const [error, setError] = useState('');
    const pictureInput = useRef<HTMLInputElement>(null);
    const attachmentInput = useRef<HTMLInputElement>(null);
    const wordInput = useRef<HTMLInputElement>(null);

    const editor = useEditor({
        extensions: EXTENSIONS,
        content: policy.draft?.body_html ?? policy.published?.body_html ?? '',
        editorProps: { attributes: { class: 'policy-content min-h-[26rem] px-5 py-4 focus:outline-none', 'aria-label': 'Document text' } },
        onUpdate: () => setDirty(true),
    });

    // Leaving with unsaved changes asks first, in the browser's own words.
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const save = async (close: boolean) => {
        setSaving(true);
        setError('');
        try {
            const saved = await apiClient.put<PolicyDocument>(`/policies/${policy.id}/draft`, {
                body_html: editor.getHTML(), change_summary: summary, revision,
            });
            const draft = saved.draft!;
            setRevision(draft.revision);
            setVersionNo(draft.version_no);
            setSavedAt({ at: draft.updated_at, by: draft.updated_by_name });
            setDirty(false);
            if (close) navigate(`/policies/${policy.id}?view=draft`);
            else addToast('Draft saved.', 'success');
        } catch (err) {
            setError((err as Error).message || 'The draft could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    const leave = async () => {
        if (dirty && !await confirm({ title: 'Leave without saving?', message: 'Your changes since the last save will be lost.', confirmLabel: 'Leave', tone: 'danger' })) return;
        navigate(`/policies/${policy.id}${revision !== null ? '?view=draft' : ''}`);
    };

    const addLink = async () => {
        const entered = await prompt({ title: 'Add a link', message: 'A web address, an email address, or a portal address starting with /.', placeholder: 'https://', confirmLabel: 'Add link' });
        const text = entered?.trim();
        if (!text) return;
        const href = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text) ? `mailto:${text}`
            : /^(https?:|mailto:|\/|#)/i.test(text) ? text : `https://${text}`;
        const chain = editor.chain().focus();
        if (editor.state.selection.empty) chain.insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
        else chain.extendMarkRange('link').setLink({ href }).run();
    };

    const uploadTo = async (path: string, file: File) => {
        const form = new FormData();
        form.append('file', file);
        return apiClient.upload(path, form);
    };

    const onPicked = (kind: 'picture' | 'attachment' | 'word') => async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (kind === 'word' && !editor.isEmpty
            && !await confirm({ title: 'Replace the text?', message: `The text in the editor will be replaced with ${file.name}. Nothing is saved until you save the draft.`, confirmLabel: 'Replace' })) return;
        setBusy(kind);
        setError('');
        try {
            if (kind === 'word') {
                const result = await uploadTo(`/policies/${policy.id}/import-word`, file) as { html: string; notes: string[] };
                editor.commands.setContent(result.html, { emitUpdate: true });
                setNotes(result.notes);
                addToast(`${file.name} imported. Check it, then save the draft.`, 'success');
            } else {
                const stored = await uploadTo(`/policies/${policy.id}/files`, file) as PolicyFile;
                if (stored.is_picture && kind === 'picture') {
                    editor.chain().focus().setImage({ src: stored.url, alt: stored.file_name.replace(/\.[^.]+$/, '') }).run();
                } else {
                    editor.chain().focus().insertContent([
                        { type: 'text', text: stored.file_name, marks: [{ type: 'link', attrs: { href: stored.url } }] },
                        { type: 'text', text: ' ' },
                    ]).run();
                }
            }
        } catch (err) {
            setError((err as Error).message || 'The file could not be uploaded.');
        } finally {
            setBusy('');
        }
    };

    const status = savedAt
        ? `Draft of version ${versionNo}, last saved ${formatDateTime(savedAt.at)}${savedAt.by ? ` by ${savedAt.by}` : ''}.`
        : policy.published
            ? `A new draft of version ${versionNo}, starting from version ${policy.published.version_no}. It becomes the draft when you first save.`
            : `The first version. It becomes the draft when you first save.`;

    return (
        <div className="space-y-4">
            <button type="button" onClick={() => void leave()} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <ArrowLeft size={16} aria-hidden="true" />Back to the document
            </button>
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{policy.code}</p>
                <h2 className="text-xl font-semibold text-gray-900">{policy.title}</h2>
                <p className="text-gray-600">{status}{dirty ? ' You have unsaved changes.' : ''}</p>
            </div>

            <Card padded={false} className="overflow-hidden">
                <Toolbar editor={editor} busy={!!busy} onLink={() => void addLink()}
                    onPicture={() => pictureInput.current?.click()}
                    onAttachment={() => attachmentInput.current?.click()}
                    onWord={() => wordInput.current?.click()} />
                {busy && <p role="status" className="border-b border-gray-200 bg-blue-50 px-4 py-1.5 text-blue-900">{busy === 'word' ? 'Importing the Word document…' : 'Uploading…'}</p>}
                <div className="max-h-[70vh] overflow-y-auto">
                    <EditorContent editor={editor} />
                </div>
            </Card>
            <input ref={pictureInput} type="file" accept={PICTURES} hidden onChange={onPicked('picture')} />
            <input ref={attachmentInput} type="file" accept={ATTACHMENTS} hidden onChange={onPicked('attachment')} />
            <input ref={wordInput} type="file" accept=".docx" hidden onChange={onPicked('word')} />

            {!!notes.length && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">
                    <p className="font-medium">About the import</p>
                    <ul className="ml-5 list-disc">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
                </div>
            )}

            <Card>
                <label className="block">
                    <span className="mb-1 block font-medium text-gray-700">What this version changes <span className="font-normal text-gray-500">(for the version history)</span></span>
                    <input value={summary} maxLength={500} onChange={(e) => { setSummary(e.target.value); setDirty(true); }}
                        placeholder={policy.published ? 'For example: Adds the second signature for payments over $10,000.' : 'First version.'}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                </label>
                <p className="mt-2 text-xs text-gray-500">
                    Use Heading and Subheading for the sections: readers get a contents list from them. Pictures and files you add stay with this document.
                </p>
            </Card>

            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => void leave()} disabled={saving}>Cancel</Button>
                <Button variant="secondary" onClick={() => void save(false)} loading={saving}>Save draft</Button>
                <Button onClick={() => void save(true)} loading={saving}>Save and close</Button>
            </div>
        </div>
    );
}
