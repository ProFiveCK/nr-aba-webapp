import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
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
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto bg-white p-5 sm:p-6 rounded-2xl shadow-xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ABA Workflow Tools</h1>
                        <p className="text-sm text-gray-600 mt-1">
                            Welcome back, <span className="font-medium">{displayName}</span>
                            {user?.role && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                                    {user.role}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleChangePassword}
                            className="px-3 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 text-sm font-medium transition-colors"
                        >
                            Change Password
                        </button>
                        <button
                            onClick={handleSignOut}
                            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium transition-colors"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-6 mb-6 border-b border-gray-200 overflow-x-auto">
                    {visibleTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`pb-3 text-sm font-medium transition-colors whitespace-nowrap ${activeTab === tab.id
                                    ? 'text-indigo-600 border-b-2 border-indigo-600'
                                    : 'text-gray-500 hover:text-gray-700'
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
