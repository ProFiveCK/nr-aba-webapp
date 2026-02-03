import { useState } from 'react';
import { apiClient } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

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
            const response = await apiClient.post<{ token: string; expires_at: string; reviewer: any }>(
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Change Password</h2>
                        <p className="text-sm text-gray-500 mt-1">Enter your current password and a new password (minimum 6 characters).</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        aria-label="Close change password modal"
                    >
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <label className="text-sm font-medium text-gray-700">
                        Current password
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            autoComplete="new-password"
                            minLength={6}
                            required
                        />
                    </label>

                    {error && <p className="text-sm text-rose-600">{error}</p>}

                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400 disabled:opacity-60"
                        >
                            {loading ? 'Updating…' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

