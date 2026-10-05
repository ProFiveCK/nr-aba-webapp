import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../lib/api';
import { Button, Modal, ModalActions } from './Ui';

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
        <Modal title="Reset your password" description="Enter your new password below." onClose={onClose} closeDisabled={loading}>
                {success ? (
                    <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-md p-3">
                        Password reset successful! You can now sign in with your new password.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
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
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
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
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                placeholder="Confirm new password"
                                disabled={loading}
                            />
                        </div>

                        <ModalActions>
                            <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                            <Button type="submit" loading={loading}>{loading ? 'Resetting…' : 'Reset password'}</Button>
                        </ModalActions>
                    </form>
                )}
        </Modal>
    );
}
