import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../lib/api';

interface ResetPasswordModalProps {
    token: string;
    onClose: () => void;
    onSuccess: () => void;
}

export function ResetPasswordModal({ token, onClose, onSuccess }: ResetPasswordModalProps) {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');

        // Validate passwords match
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        // Validate password length
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);

        try {
            await apiClient.post('/auth/reset-password', {
                token,
                new_password: newPassword
            });
            
            setSuccess(true);
            
            // Close modal and redirect to login after 2 seconds
            setTimeout(() => {
                onSuccess();
                onClose();
            }, 2000);
        } catch (err) {
            setError((err as Error)?.message || 'Failed to reset password. The link may have expired.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Reset Your Password</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Enter your new password below
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        disabled={loading}
                    >
                        ×
                    </button>
                </div>

                {success ? (
                    <div className="mt-4 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md p-3">
                        Password reset successful! You can now sign in with your new password.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                        {error && (
                            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                                New Password
                            </label>
                            <input
                                id="new-password"
                                type="password"
                                required
                                minLength={6}
                                maxLength={128}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="Enter new password"
                                disabled={loading}
                                autoFocus
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                Minimum 6 characters
                            </p>
                        </div>

                        <div>
                            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                                Confirm Password
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                required
                                minLength={6}
                                maxLength={128}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="Confirm new password"
                                disabled={loading}
                            />
                        </div>

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
                                className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
                            >
                                {loading ? 'Resetting...' : 'Reset Password'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
