import { useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { ChangePasswordModal } from './ChangePasswordModal';
import { getAllowedApps, SYSTEM_PAGES, type AppId, findApp } from '../lib/apps';

interface LayoutProps {
    children: React.ReactNode;
    activeApp: AppId;
    onAppChange: (appId: AppId) => void;
}

export function Layout({ children, activeApp, onAppChange }: LayoutProps) {
    const { user, logout } = useAuth();
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showSignOutModal, setShowSignOutModal] = useState(false);

    const handleSignOut = () => {
        setShowSignOutModal(true);
    };

    const confirmSignOut = () => {
        setShowSignOutModal(false);
        logout();
    };

    const handleChangePassword = () => {
        setShowPasswordModal(true);
    };

    const app = findApp(activeApp);
    const displayName = user?.display_name || user?.email || 'User';

    const allowedApps = getAllowedApps(user);
    const systemPages = SYSTEM_PAGES.filter(
        (p) => p.id !== 'dashboard' && (p.id !== 'admin' || user?.role === 'admin')
    );
    const navItems = [
        { id: 'dashboard' as AppId, label: 'Dashboard' },
        ...allowedApps.map((a) => ({ id: a.id, label: a.shortLabel })),
        ...systemPages.map((p) => ({ id: p.id, label: p.shortLabel })),
    ];
    const [navOpen, setNavOpen] = useState(false);

    return (
        <>
        <div className="min-h-screen bg-zinc-100 px-3 py-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-950">Treasury Portal</h1>
                            <button
                                type="button"
                                onClick={() => setNavOpen((v) => !v)}
                                className="ml-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 sm:hidden"
                                aria-label="Toggle navigation"
                            >
                                ☰
                            </button>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                            {activeApp === 'dashboard'
                                ? 'Choose an app to get started'
                                : app?.description || app?.label || 'App'}
                            {' · '}
                            Welcome back, <span className="font-medium">{displayName}</span>
                            {user?.role && (
                                <span className="ml-2 inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                                    {user.role}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={handleChangePassword}
                            className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
                        >
                            Change Password
                        </button>
                        <button
                            onClick={handleSignOut}
                            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>

                {/* Persistent navigation menu */}
                <nav className={`mb-4 ${navOpen ? 'block' : 'hidden sm:block'}`}>
                    <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
                        {navItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => { onAppChange(item.id); setNavOpen(false); }}
                                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                    activeApp === item.id
                                        ? 'bg-amber-500 text-white'
                                        : 'text-zinc-600 hover:bg-zinc-100'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <main>{children}</main>
            </div>
        </div>
        {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
        {showSignOutModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setShowSignOutModal(false)}>
                <div
                    className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">Sign out</h2>
                            <p className="text-sm text-gray-500 mt-1">You will need to enter your email and password again to sign back in.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowSignOutModal(false)}
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        >
                            ×
                        </button>
                    </div>
                    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={() => setShowSignOutModal(false)}
                            className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmSignOut}
                            className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
