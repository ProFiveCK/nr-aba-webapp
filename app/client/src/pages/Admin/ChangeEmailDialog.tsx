import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Modal, ModalActions } from '../../components/Ui';
import { apiClient } from '../../lib/api';

/**
 * Changes the address an account signs in with. The server does the whole change in
 * one step; this explains what it means, because it signs the person out everywhere.
 */
export function ChangeEmailDialog({ account, isSelf, onClose, onChanged }: {
    account: { id: string; email: string };
    isSelf: boolean;
    onClose: () => void;
    onChanged: (email: string) => void;
}) {
    const [email, setEmail] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const busy = useRef(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy.current) return;
        busy.current = true; setSaving(true); setError('');
        try {
            const result = await apiClient.post<{ email: string }>(`/reviewers/${account.id}/email`, { email: email.trim(), reason: reason.trim() });
            onChanged(result.email);
        } catch (err) {
            setError((err as Error).message || 'Unable to change the email address.');
        } finally { busy.current = false; setSaving(false); }
    }

    return <Modal title="Change sign-in email" description={`Currently ${account.email}`} onClose={onClose} closeDisabled={saving} size="lg">
        <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">New email address
                <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium text-gray-700">Reason
                <textarea required minLength={10} maxLength={1000} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="e.g. Moved to a new work address" />
            </label>
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                <li>{isSelf ? 'You will be signed out' : 'They will be signed out'} everywhere and must sign in with the new address.</li>
                <li>Password-reset and activation links already sent stop working.</li>
                <li>Their Google sign-in link is removed; Google works again on the new address.</li>
                <li>A linked staff record’s contact email is updated to match.</li>
                <li>Both addresses are sent a notice.</li>
            </ul>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <ModalActions>
                <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button type="submit" loading={saving}>{saving ? 'Changing…' : 'Change email'}</Button>
            </ModalActions>
        </form>
    </Modal>;
}
