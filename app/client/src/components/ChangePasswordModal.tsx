import { useState } from 'react';
import { apiClient } from '../lib/api';
import { useToast } from '../contexts/useToast';
import { useAuth } from '../contexts/useAuth';
import type { User } from '../contexts/auth-types';
import { Button, Modal, ModalActions } from './Ui';

interface ChangePasswordModalProps {
    onClose: () => void;
}

export function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
    const { replaceSession } = useAuth();
    const { addToast } = useToast();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (newPassword.length < 6) {
            setError('New password must be at least 6 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New password and confirmation do not match.');
            return;
        }
        if (newPassword === currentPassword) {
            setError('Choose a password you have not used before.');
            return;
        }

        setLoading(true);
        try {
            const response = await apiClient.post<{ token: string; expires_at: string; reviewer: User }>(
                '/auth/change-password',
                {
                    current_password: currentPassword,
                    new_password: newPassword,
                }
            );
            if (response?.token && response?.reviewer) {
                replaceSession(response.token, response.reviewer);
            }
            addToast('Password updated. You are now signed in with the new credentials.', 'success');
            onClose();
        } catch (err) {
            setError((err as Error)?.message || 'Unable to change password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="Change password"
            description="Enter your current password and a new password (minimum 6 characters)."
            onClose={onClose}
            closeDisabled={loading}
        >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="text-sm font-medium text-gray-700">
                        Current password
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            autoComplete="current-password"
                            required
                        />
                    </label>

                    <label className="text-sm font-medium text-gray-700">
                        New password
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            autoComplete="new-password"
                            minLength={6}
                            required
                        />
                    </label>

                    <label className="text-sm font-medium text-gray-700">
                        Confirm new password
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            autoComplete="new-password"
                            minLength={6}
                            required
                        />
                    </label>

                    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

                    <ModalActions>
                        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                        <Button type="submit" loading={loading}>{loading ? 'Updating…' : 'Update password'}</Button>
                    </ModalActions>
                </form>
        </Modal>
    );
}
