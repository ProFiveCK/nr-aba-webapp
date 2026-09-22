import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Building2, ChevronDown, LayoutGrid, Loader2, LockKeyhole, Mail, User } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import { apiClient } from '../lib/api';
import { loadGoogleIdentity } from '../lib/googleSignIn';
import type { AuthConfig } from '../lib/googleSignIn';

interface DepartmentOption {
    id: string;
    department_code: string;
    division_code: string;
    name: string | null;
}

const fieldClass =
    'w-full h-11 pl-10 pr-3 bg-white border border-gray-300 rounded-md text-sm transition-colors focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-[#002B7F]/20 disabled:opacity-60 disabled:bg-gray-50';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';
const iconClass = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400';
const submitClass =
    'w-full h-11 inline-flex items-center justify-center rounded-md bg-[#E8842C] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#d4761f] focus:outline-none focus:ring-2 focus:ring-[#E8842C] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const linkClass =
    'text-sm font-medium text-[#002B7F] underline-offset-4 transition-colors hover:text-[#E8842C] hover:underline';

export function Login() {
    const { login, loginWithGoogle } = useAuth();
    const googleButtonRef = useRef<HTMLDivElement | null>(null);
    const [googleEnabled, setGoogleEnabled] = useState(false);
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
    const [signupApps, setSignupApps] = useState<string[]>([]);
    const [availableApps, setAvailableApps] = useState<{ id: string; label: string }[]>([]);
    const [departments, setDepartments] = useState<DepartmentOption[]>([]);
    const [departmentsLoading, setDepartmentsLoading] = useState(false);
    const [departmentsError, setDepartmentsError] = useState('');

    // Load available departments for the signup dropdown
    const loadDepartments = useCallback(async (signal?: AbortSignal) => {
        setDepartmentsLoading(true);
        setDepartmentsError('');
        try {
            const data = await apiClient.get<DepartmentOption[]>('/department-profiles/active', { signal });
            if (!signal?.aborted) {
                setDepartments(data || []);
            }
        } catch (err) {
            if (!signal?.aborted) {
                const message = (err as Error)?.message || 'Could not load departments.';
                console.error('Failed to load departments for signup', err);
                setDepartmentsError(message);
            }
        } finally {
            if (!signal?.aborted) {
                setDepartmentsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!isLogin) {
            const controller = new AbortController();
            loadDepartments(controller.signal);
            apiClient
                .get<AuthConfig>('/auth/config', { signal: controller.signal })
                .then((config) => setAvailableApps(config?.signup_apps || []))
                .catch(() => undefined);
            return () => {
                controller.abort();
            };
        }
    }, [isLogin, loadDepartments]);

    const toggleSignupApp = (id: string, checked: boolean) => {
        setSignupApps((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((a) => a !== id)));
    };

    // Google sign-in: only rendered once the backend confirms it is configured.
    // Any failure here leaves password login untouched.
    useEffect(() => {
        if (!isLogin) return;
        let cancelled = false;

        (async () => {
            try {
                const config = await apiClient.get<AuthConfig>('/auth/config');
                if (cancelled || !config?.google_enabled || !config.google_client_id) return;

                const api = await loadGoogleIdentity();
                if (cancelled) return;

                api.initialize({
                    client_id: config.google_client_id,
                    callback: async (response) => {
                        if (!response.credential) return;
                        setError('');
                        setIsLoading(true);
                        try {
                            await loginWithGoogle(response.credential);
                        } catch (err) {
                            setError((err as Error)?.message || 'Google sign-in failed.');
                        } finally {
                            setIsLoading(false);
                        }
                    },
                    cancel_on_tap_outside: true,
                });

                setGoogleEnabled(true);
                if (googleButtonRef.current) {
                    api.renderButton(googleButtonRef.current, {
                        type: 'standard',
                        theme: 'outline',
                        size: 'large',
                        text: 'continue_with',
                        shape: 'rectangular',
                        logo_alignment: 'center',
                        width: 320,
                    });
                }
            } catch (err) {
                console.warn('Google sign-in unavailable', err);
            }
        })();

        return () => {
            cancelled = true;
            setGoogleEnabled(false);
            // Google injects its button/iframe straight into this container outside
            // React's tree; clear it explicitly so it can never survive a switch
            // away from the login view (e.g. onto the signup form).
            if (googleButtonRef.current) {
                googleButtonRef.current.innerHTML = '';
            }
        };
    }, [isLogin, loginWithGoogle]);

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
            setError('Please select a Department from the list.');
            return;
        }
        if (!signupApps.length) {
            setIsLoading(false);
            setError('Please select at least one app you need access to.');
            return;
        }

        try {
            await apiClient.post('/auth/signup', {
                email: signupEmail.trim(),
                name: signupName.trim(),
                password: signupPassword,
                department_code: trimmedDept,
                requested_apps: signupApps,
            });
            setSuccessMessage('Signup request submitted! Please wait for admin approval.');
            // Clear form
            setSignupName('');
            setSignupEmail('');
            setSignupPassword('');
            setSignupDept('');
            setSignupApps([]);
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
        <div className="min-h-svh lg:grid lg:grid-cols-[minmax(0,480px)_1fr] xl:grid-cols-[minmax(0,560px)_1fr]">
            {/* ===== Left: sign-in panel ===== */}
            <div className="flex min-h-svh flex-col bg-white px-6 py-10 sm:px-12 lg:min-h-0">
                <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
                    {/* Crest + wordmark */}
                    <div className="mb-8">
                        <img src="/logo.png" alt="Republic of Naoero coat of arms" className="h-16 w-auto" />
                        <h1 className="mt-4 text-xl font-bold tracking-tight text-[#002B7F]">
                            Naoero Treasury Portal
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {isLogin
                                ? 'Sign in to access your Treasury applications.'
                                : 'Request access to the Treasury Portal.'}
                        </p>
                    </div>

                    <h2 className="mb-5 text-base font-semibold text-gray-900">
                        {isLogin ? 'Log on using your details' : 'Create an access request'}
                    </h2>

                    {error && (
                        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div className="mb-5 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                            {successMessage}
                        </div>
                    )}

                    {isLogin ? (
                        /* Login Form */
                        <form key="login-form" onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label htmlFor="email" className={labelClass}>Email address</label>
                                <div className="relative">
                                    <Mail className={iconClass} />
                                    <input
                                        id="email"
                                        type="email"
                                        required
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className={fieldClass}
                                        placeholder="name@example.nr"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="password" className={labelClass}>Password</label>
                                <div className="relative">
                                    <LockKeyhole className={iconClass} />
                                    <input
                                        id="password"
                                        type="password"
                                        required
                                        minLength={6}
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className={fieldClass}
                                        placeholder="••••••••"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <button type="submit" disabled={isLoading} className={submitClass}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Signing in...
                                    </>
                                ) : (
                                    'Log On'
                                )}
                            </button>

                            {/* Rendered by Google Identity Services; hidden entirely when unconfigured. */}
                            <div className={googleEnabled ? 'block' : 'hidden'}>
                                <div className="relative py-1">
                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                        <div className="w-full border-t border-gray-200" />
                                    </div>
                                    <div className="relative flex justify-center">
                                        <span className="bg-white px-3 text-xs uppercase tracking-wide text-gray-400">or</span>
                                    </div>
                                </div>
                                <div ref={googleButtonRef} className="flex justify-center pt-3" />
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsLogin(false);
                                        setError('');
                                        setSuccessMessage('');
                                    }}
                                    className={linkClass}
                                >
                                    Need an account?
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setResetOpen(true)}
                                    className={linkClass}
                                    disabled={isLoading}
                                >
                                    Forgotten password?
                                </button>
                            </div>
                        </form>
                    ) : (
                        /* Signup Form */
                        <form key="signup-form" onSubmit={handleSignup} className="space-y-4">
                            <div>
                                <label htmlFor="signup-name" className={labelClass}>Full name</label>
                                <div className="relative">
                                    <User className={iconClass} />
                                    <input
                                        id="signup-name"
                                        type="text"
                                        required
                                        maxLength={40}
                                        value={signupName}
                                        onChange={(e) => setSignupName(e.target.value)}
                                        className={fieldClass}
                                        placeholder="Your name"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="signup-email" className={labelClass}>Email address</label>
                                <div className="relative">
                                    <Mail className={iconClass} />
                                    <input
                                        id="signup-email"
                                        type="email"
                                        required
                                        autoComplete="email"
                                        value={signupEmail}
                                        onChange={(e) => setSignupEmail(e.target.value)}
                                        className={fieldClass}
                                        placeholder="name@example.nr"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="signup-password" className={labelClass}>Password</label>
                                <div className="relative">
                                    <LockKeyhole className={iconClass} />
                                    <input
                                        id="signup-password"
                                        type="password"
                                        required
                                        minLength={6}
                                        autoComplete="new-password"
                                        value={signupPassword}
                                        onChange={(e) => setSignupPassword(e.target.value)}
                                        className={fieldClass}
                                        placeholder="••••••••"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div>
                                <span className={labelClass}>
                                    <LayoutGrid className="mr-1.5 inline h-4 w-4 align-text-bottom text-gray-400" />
                                    Which apps do you need?
                                </span>
                                <div className="space-y-1 rounded-md border border-gray-300 bg-white p-2">
                                    {availableApps.length ? (
                                        availableApps.map((app) => {
                                            const checked = signupApps.includes(app.id);
                                            return (
                                                <label
                                                    key={app.id}
                                                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                                                        checked ? 'bg-[#002B7F]/5 text-[#002B7F]' : 'text-gray-700 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(e) => toggleSignupApp(app.id, e.target.checked)}
                                                        disabled={isLoading}
                                                        className="h-4 w-4 rounded border-gray-300 text-[#002B7F] focus:ring-[#002B7F]/40"
                                                    />
                                                    {app.label}
                                                </label>
                                            );
                                        })
                                    ) : (
                                        <p className="px-2 py-1.5 text-sm text-gray-500">Loading apps…</p>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-gray-500">Select every app you need — you can be given more than one.</p>
                            </div>

                            <div>
                                <label htmlFor="signup-dept" className={labelClass}>Department</label>
                                <div className="relative">
                                    <Building2 className={iconClass} />
                                    <select
                                        id="signup-dept"
                                        required
                                        value={signupDept}
                                        onChange={(e) => setSignupDept(e.target.value)}
                                        className={`${fieldClass} appearance-none bg-white pr-9`}
                                        disabled={isLoading || departmentsLoading}
                                    >
                                        <option value="" disabled>
                                            {departmentsLoading ? 'Loading departments...' : 'Select a department'}
                                        </option>
                                        {departments.map((dept) => (
                                            <option key={dept.id} value={dept.department_code}>
                                                {dept.name ? `${dept.name} (${dept.department_code})` : `Department ${dept.department_code}`}
                                            </option>
                                        ))}
                                    </select>
                                    {departmentsLoading ? (
                                        <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                                    ) : (
                                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    )}
                                </div>
                                {departmentsError && (
                                    <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
                                        <span>{departmentsError}</span>
                                        <button
                                            type="button"
                                            onClick={() => loadDepartments()}
                                            className="font-medium text-[#002B7F] underline hover:text-[#E8842C]"
                                            disabled={departmentsLoading}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button type="submit" disabled={isLoading} className={submitClass}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    'Request Access'
                                )}
                            </button>

                            <div className="border-t border-gray-200 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsLogin(true);
                                        setError('');
                                        setSuccessMessage('');
                                    }}
                                    className={linkClass}
                                >
                                    Already have an account? Sign in
                                </button>
                            </div>
                        </form>
                    )}

                    <p className="mt-8 text-xs text-gray-500">
                        Contact your administrator if you need assistance accessing your account.
                    </p>
                </div>

                <p className="mx-auto mt-8 w-full max-w-sm text-xs text-gray-400">
                    &copy; {new Date().getFullYear()} Republic of Naoero — Department of Finance
                </p>
            </div>

            {/* ===== Right: hero ===== */}
            <div className="relative hidden lg:block">
                <img
                    src="/nauru-anibare-bay.jpg"
                    alt="Coral pinnacles in the shallows of Anibare Bay, Naoero"
                    className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#002B7F]/90 via-[#002B7F]/35 to-[#002B7F]/10" />

                <div className="relative flex h-full flex-col justify-end p-12 text-white">
                    <div className="h-1 w-16 rounded-full bg-[#E8842C]" />
                    <h2 className="mt-6 text-4xl font-bold tracking-tight drop-shadow-sm">
                        Republic of Naoero
                    </h2>
                    <p className="mt-3 max-w-md text-lg text-white/85">
                        One sign-in for Treasury payments, banking, payroll and programme administration.
                    </p>
                    <p className="mt-10 text-xs text-white/50">
                        Anibare Bay — photo by Hadi Zaher,{' '}
                        <a
                            href="https://creativecommons.org/licenses/by/2.0/"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2 hover:text-white/80"
                        >
                            CC BY 2.0
                        </a>
                    </p>
                </div>
            </div>
        </div>

        {resetOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setResetOpen(false)}>
                <div
                    className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-[#002B7F]">Reset Password</h2>
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
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-1 focus:ring-[#002B7F]"
                                placeholder="name@example.nr"
                            />
                        </label>
                        {resetMessage && <p className="text-sm text-gray-600">{resetMessage}</p>}
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setResetOpen(false)}
                                className="rounded-md border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                disabled={resetLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={resetLoading}
                                className="rounded-md bg-[#E8842C] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#d4761f] disabled:opacity-60"
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
