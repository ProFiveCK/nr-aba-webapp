import { useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { ChangePasswordModal } from './ChangePasswordModal';
import { AiHelper } from './AiHelper';

interface LayoutProps {
    children: React.ReactNode;
    activeTab: string;
    onTabChange: (tab: string) => void;
}

const TABS = [
    { id: 'generator', label: 'Generator', roles: ['user', 'banking', 'reviewer', 'admin'] },
    { id: 'my-batches', label: 'My Batches', roles: ['user', 'banking', 'reviewer', 'admin'] },
    { id: 'reader', label: 'Reader', roles: ['user', 'banking', 'reviewer', 'admin'] },
    { id: 'banking', label: 'Banking', roles: ['banking', 'reviewer', 'admin'] },
    { id: 'payroll', label: 'Payroll', roles: ['payroll', 'admin'] },
    { id: 'saas', label: 'SaaS', roles: ['reviewer', 'admin'] },
    { id: 'reviewer', label: 'Reviewer', roles: ['reviewer', 'admin'] },
    { id: 'admin', label: 'Admin', roles: ['admin'] },
];

export function Layout({ children, activeTab, onTabChange }: LayoutProps) {
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

    // Filter tabs based on user role
    const visibleTabs = user ? TABS.filter(tab => tab.roles.includes(user.role)) : TABS;

    // Display name with fallback
    const displayName = user?.display_name || user?.email || 'User';

    return (
        <>
        <div className="min-h-screen bg-zinc-100 px-3 py-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-950">ABA Workflow Tools</h1>
                        <p className="text-sm text-gray-600 mt-1">
                            Welcome back, <span className="font-medium">{displayName}</span>
                            {user?.role && (
                                <span className="ml-2 inline-flex items-center rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                    {user.role}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleChangePassword}
                            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
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

                {/* Tabs */}
                <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
                    {visibleTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab.id
                                    ? 'bg-indigo-50 text-indigo-700'
                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
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
        <AiHelper />
        </>
    );
}
