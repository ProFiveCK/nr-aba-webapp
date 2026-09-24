import { useState } from 'react';
import { UserRound } from 'lucide-react';
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
    const [showAccountMenu, setShowAccountMenu] = useState(false);

    const handleSignOut = () => {
        setShowAccountMenu(false);
        setShowSignOutModal(true);
    };

    const confirmSignOut = () => {
        setShowSignOutModal(false);
        logout();
    };

    const handleChangePassword = () => {
        setShowAccountMenu(false);
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
        <div className="min-h-screen bg-[#f4f6fa]">
            <header className="sticky top-0 z-40 shadow-sm">
            <div className="border-b border-white/10 bg-[#002B7F] px-4 py-4 text-white sm:px-6 lg:px-8">
                <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Republic of Naoero coat of arms" className="h-12 w-12 rounded-lg bg-white p-1 object-contain" />
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200 max-[359px]:hidden">Republic of Naoero</p>
                            <h1 className="text-lg font-bold tracking-tight max-[359px]:whitespace-nowrap max-[359px]:text-base sm:text-xl">Treasury Portal</h1>
                        </div>
                    </div>
                    <div className="hidden items-center gap-2 sm:flex">
                        <span className="mr-2 max-w-40 truncate text-sm text-blue-100">{displayName}</span>
                        <button
                            onClick={handleChangePassword}
                            className="rounded-lg border border-white/25 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
                        >
                            Change Password
                        </button>
                        <button
                            onClick={handleSignOut}
                            className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#002B7F] transition-colors hover:bg-blue-50"
                        >
                            Sign Out
                        </button>
                    </div>
                    <div className="flex items-center gap-2 sm:hidden">
                        <button
                            type="button"
                            onClick={() => { setShowAccountMenu(false); setNavOpen((v) => !v); }}
                            className="rounded-lg border border-white/30 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
                            aria-label="Toggle navigation"
                            aria-expanded={navOpen}
                            aria-controls="primary-navigation"
                        >
                            ☰
                        </button>
                        <button
                            type="button"
                            onClick={() => { setNavOpen(false); setShowAccountMenu((open) => !open); }}
                            className="rounded-lg border border-white/30 p-2 text-white transition-colors hover:bg-white/10"
                            aria-label="Account actions"
                            aria-expanded={showAccountMenu}
                            aria-controls="mobile-account-menu"
                        >
                            <UserRound size={19} aria-hidden="true" />
                        </button>
                    </div>
                    {showAccountMenu && (
                        <div id="mobile-account-menu" className="absolute right-0 top-full z-30 mt-3 w-56 rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl sm:hidden">
                            <p className="truncate border-b border-slate-100 px-3 py-2 text-sm font-semibold">{displayName}</p>
                            <button type="button" onClick={handleChangePassword} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50">Change Password</button>
                            <button type="button" onClick={handleSignOut} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50">Sign Out</button>
                        </div>
                    )}
                </div>
            </div>
            <div className="border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8">
                <nav id="primary-navigation" aria-label="Applications" className={`mx-auto max-h-[60dvh] max-w-7xl overflow-y-auto sm:max-h-none sm:overflow-visible ${navOpen ? 'block' : 'hidden sm:block'}`}>
                    <div className="flex flex-wrap gap-1 py-2">
                        {navItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => { onAppChange(item.id); setNavOpen(false); }}
                                aria-current={activeApp === item.id ? 'page' : undefined}
                                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                    activeApp === item.id
                                        ? 'bg-[#002B7F] text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-blue-50 hover:text-[#002B7F]'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </nav>
            </div>
            </header>
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2a5ba5]">Treasury applications</p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{activeApp === 'dashboard' ? 'Dashboard' : app?.label || 'App'}</h2>
                    <p className="mt-1 text-sm text-slate-500">{activeApp === 'dashboard' ? 'Choose an app to get started' : app?.description || app?.label || 'App'}</p>
                </div>
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
