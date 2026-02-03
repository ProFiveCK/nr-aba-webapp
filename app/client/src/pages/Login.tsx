import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';

export function Login() {
    const { login } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [resetOpen, setResetOpen] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetMessage, setResetMessage] = useState('');

    // Login State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Signup State
    const [signupName, setSignupName] = useState('');
    const [signupEmail, setSignupEmail] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupDept, setSignupDept] = useState('');

    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setIsLoading(true);

        try {
            await login(email.trim(), password);
        } catch (err) {
            const errorMessage = (err as Error)?.message || 'Login failed. Please check your credentials.';
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignup = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setIsLoading(true);

        const trimmedDept = signupDept.trim();
        if (!/^\d{2}$/.test(trimmedDept)) {
            setIsLoading(false);
            setError('Enter your two-digit Department Head code.');
            return;
        }

        try {
            await apiClient.post('/auth/signup', {
                email: signupEmail.trim(),
                name: signupName.trim(),
                password: signupPassword,
                department_code: trimmedDept,
            });
            setSuccessMessage('Signup request submitted! Please wait for admin approval.');
            // Clear form
            setSignupName('');
            setSignupEmail('');
            setSignupPassword('');
            setSignupDept('');
            // Switch back to login after a delay
            setTimeout(() => setIsLogin(true), 3000);
        } catch (err) {
            const errorMessage = (err as Error)?.message || 'Signup failed. Please try again.';
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async (event: FormEvent) => {
        event.preventDefault();
        setResetMessage('');
        setError('');
        setResetLoading(true);
        try {
            await apiClient.post('/auth/forgot-password', { email: resetEmail.trim() });
            setResetMessage('If this email is registered, a reset link has been sent.');
        } catch (err) {
            setResetMessage((err as Error)?.message || 'Unable to send reset email.');
        } finally {
            setResetLoading(false);
        }
    };

    return (
        <>
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-12">
            <div className="max-w-md w-full space-y-6">
                <div className="bg-white shadow-2xl rounded-2xl p-8">
                    {/* Logo */}
                    <div className="flex justify-center mb-6">
                        <div className="h-32 w-32 rounded-2xl flex items-center justify-center overflow-hidden shadow-md">
                            <img src="/logo.png" alt="RON Logo" className="h-full w-full object-cover" />
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl font-bold text-gray-900 text-center">Nauru Treasury</h1>
                    <p className="text-sm text-gray-600 text-center mt-2">
                        {isLogin ? 'Sign in to prepare, review, and manage ABA batches.' : 'Request access to the ABA Workflow Tools.'}
                    </p>

                    {/* Error Message */}
                    {error && (
                        <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                            {error}
                        </div>
                    )}

                    {/* Success Message */}
                    {successMessage && (
                        <div className="mt-4 text-xs text-green-600 bg-green-50 border border-green-200 rounded-md p-2">
                            {successMessage}
                        </div>
                    )}

                    {isLogin ? (
                        /* Login Form */
                        <form onSubmit={handleLogin} className="mt-6 space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                                    Email
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="name@example.nr"
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                    Password
                                </label>
                                <input
                                    id="password"
                                    type="password"
                                    required
                                    minLength={6}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="••••••••"
                                    disabled={isLoading}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full px-4 py-2.5 bg-amber-500 text-white font-semibold rounded-md shadow-sm hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? 'Signing in...' : 'Sign In'}
                            </button>

                            <button
                                type="button"
                                onClick={() => setResetOpen(true)}
                                className="w-full text-xs text-center text-indigo-600 hover:text-indigo-500 font-medium"
                                disabled={isLoading}
                            >
                                Forgot password?
                            </button>
                        </form>
                    ) : (
                        /* Signup Form */
                        <form onSubmit={handleSignup} className="mt-6 space-y-4">
                            <div>
                                <label htmlFor="signup-name" className="block text-sm font-medium text-gray-700">
                                    Full Name
                                </label>
                                <input
                                    id="signup-name"
                                    type="text"
                                    required
                                    maxLength={40}
                                    value={signupName}
                                    onChange={(e) => setSignupName(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="Your name"
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700">
                                    Email
                                </label>
                                <input
                                    id="signup-email"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={signupEmail}
                                    onChange={(e) => setSignupEmail(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="name@example.nr"
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label htmlFor="signup-password" className="block text-sm font-medium text-gray-700">
                                    Password
                                </label>
                                <input
                                    id="signup-password"
                                    type="password"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                    value={signupPassword}
                                    onChange={(e) => setSignupPassword(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="••••••••"
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label htmlFor="signup-dept" className="block text-sm font-medium text-gray-700">
                                    Department Head (2-digit FMIS)
                                </label>
                                <input
                                    id="signup-dept"
                                    type="text"
                                    required
                                    maxLength={2}
                                    pattern="\d{2}"
                                    title="Enter the two-digit Department Head code"
                                    value={signupDept}
                                    onChange={(e) => setSignupDept(e.target.value)}
                                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="e.g. 12"
                                    disabled={isLoading}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full px-4 py-2.5 bg-amber-500 text-white font-semibold rounded-md shadow-sm hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? 'Submitting...' : 'Request Access'}
                            </button>
                        </form>
                    )}

                    {/* Toggle Link */}
                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => {
                                setIsLogin(!isLogin);
                                setError('');
                                setSuccessMessage('');
                            }}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                        >
                            {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Sign In'}
                        </button>
                    </div>

                    {/* Help Text */}
                    <p className="mt-4 text-xs text-center text-gray-500">
                        Contact your administrator if you need assistance accessing your account.
                    </p>
                </div>
            </div>
        </div>

        {resetOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setResetOpen(false)}>
                <div
                    className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">Reset Password</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Enter your email and we’ll send reset instructions if the account exists.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setResetOpen(false)}
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        >
                            ×
                        </button>
                    </div>

                    <form onSubmit={handleResetPassword} className="mt-4 space-y-3">
                        <label className="text-sm font-medium text-gray-700">
                            Email address
                            <input
                                type="email"
                                required
                                value={resetEmail}
                                onChange={(e) => setResetEmail(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="name@example.nr"
                            />
                        </label>
                        {resetMessage && <p className="text-sm text-gray-600">{resetMessage}</p>}
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setResetOpen(false)}
                                className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                disabled={resetLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={resetLoading}
                                className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400 disabled:opacity-60"
                            >
                                {resetLoading ? 'Sending…' : 'Send reset link'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}
        </>
    );
}
