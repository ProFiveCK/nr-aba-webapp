import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiClient } from '../lib/api';
import {
    formatIsoDateTime,
    formatBatchCode,
    formatPdNumber,
    getBatchStageBadgeClasses,
    formatBSB,
    normalizeBSBStrict,
    normalizeAccountStrict,
    parseBlacklistCsv,
} from '../lib/utils';
import { STAGE_META, BLACKLIST_IMPORT_LIMIT } from '../lib/constants';

type AdminSection = 'signups' | 'accounts' | 'blacklist' | 'archives' | 'testing' | 'smtp';

interface SignupRequest {
    id: number;
    email: string;
    name: string;
    department_code: string | null;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    reviewed_at: string | null;
    reviewer_name: string | null;
    reviewer_email: string | null;
    review_comment: string | null;
}

interface AdminAccount {
    id: string;
    email: string;
    display_name: string | null;
    role: 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll';
    status: 'active' | 'inactive';
    must_change_password: boolean;
    department_code: string | null;
    notify_on_submission: boolean | null;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
}

interface AdminArchiveEntry {
    code: string;
    stage: string;
    pd_number?: string | null;
    department_code?: string | null;
    submitted_email?: string | null;
    created_at: string;
    transactions?: {
        prepared_by?: string;
    } | null;
}

interface BlacklistEntry {
    id: number;
    bsb: string;
    account: string;
    label: string | null;
    notes: string | null;
    active: boolean;
    created_at?: string | null;
    updated_at?: string | null;
}

interface BlacklistFormState {
    id: number | null;
    bsb: string;
    account: string;
    label: string;
    notes: string;
    active: 'yes' | 'no';
}

interface TestingModeState {
    enabled: boolean;
    updated_at: string | null;
    set_by_name: string | null;
    set_by_email: string | null;
}

interface AccountFormState {
    id: string | null;
    email: string;
    display_name: string;
    role: AdminAccount['role'];
    department_code: string;
    notify_on_submission: boolean;
}

const EMPTY_FORM: AccountFormState = {
    id: null,
    email: '',
    display_name: '',
    role: 'reviewer',
    department_code: '',
    notify_on_submission: true,
};

const ADMIN_ARCHIVE_LIMIT = 200;

const EMPTY_BLACKLIST_FORM: BlacklistFormState = {
    id: null,
    bsb: '',
    account: '',
    label: '',
    notes: '',
    active: 'yes',
};

export function Admin() {
    const { user } = useAuth();
    const [section, setSection] = useState<AdminSection>('signups');

    if (!user || user.role !== 'admin') {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                <h2 className="text-xl font-semibold">Admin access required</h2>
                <p className="mt-2 text-sm text-amber-800">
                    You need an administrator account to open the control panels. Please sign in with an admin user or contact Treasury support.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">System Control Centre</h1>
                        <p className="text-sm text-gray-600">Manage signups, user access, blacklist enforcement, and testing mode.</p>
                    </div>
                </div>
                <nav className="mt-6 flex flex-wrap gap-2">
                    {[
                        { id: 'signups', label: 'Signup Requests' },
                        { id: 'accounts', label: 'User Management' },
                        { id: 'blacklist', label: 'Blacklist' },
                        { id: 'archives', label: 'Archives' },
                        { id: 'testing', label: 'Testing Mode' },
                        { id: 'smtp', label: 'Email Settings' },
                    ].map(({ id, label }) => (
                        <button
                            key={id}
                            onClick={() => setSection(id as AdminSection)}
                            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                                section === id ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            </section>

            {section === 'signups' && <SignupRequestsPanel />}
            {section === 'accounts' && <UserManagementPanel />}
            {section === 'blacklist' && <BlacklistPanel />}
            {section === 'archives' && <AdminArchivesPanel />}
            {section === 'testing' && <TestingModePanel />}
            {section === 'smtp' && <SmtpSettingsPanel />}
        </div>
    );
}

function SignupRequestsPanel() {
    const [requests, setRequests] = useState<SignupRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionId, setActionId] = useState<number | null>(null);
    const { addToast } = useToast();

    const refresh = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.get<SignupRequest[]>('/admin/signup-requests');
            setRequests(Array.isArray(data) ? data : []);
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load signup requests.');
            setRequests([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    const pending = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
    const completed = useMemo(() => requests.filter((r) => r.status !== 'pending'), [requests]);

    const handleDecision = async (id: number, action: 'approve' | 'reject') => {
        let review_comment = '';
        if (action === 'reject') {
            const response = window.prompt('Provide a short reason for rejecting this request:', '');
            if (response === null) return;
            review_comment = response.trim();
            if (!review_comment) {
                addToast('Please include a short rejection reason before rejecting.', 'error');
                return;
            }
        } else {
            const response = window.prompt('Optional welcome note (press Cancel to skip):', '');
            if (response === null) return;
            review_comment = response.trim();
        }

        setActionId(id);
        try {
            await apiClient.post(`/admin/signup-requests/${id}/${action}`, review_comment ? { review_comment } : undefined);
            addToast(`Request ${action === 'approve' ? 'approved' : 'rejected'}.`, 'success');
            await refresh();
        } catch (err) {
            addToast((err as Error)?.message || `Unable to ${action} request.`, 'error');
        } finally {
            setActionId(null);
        }
    };

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Pending signup requests</h2>
                        <p className="text-sm text-gray-500">{pending.length} awaiting approval</p>
                    </div>
                    <button
                        type="button"
                        onClick={refresh}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Refresh
                    </button>
                </div>
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                            <tr>
                                <th className="px-3 py-2">Name</th>
                                <th className="px-3 py-2">Email</th>
                                <th className="px-3 py-2">Department</th>
                                <th className="px-3 py-2">Requested</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                        Loading…
                                    </td>
                                </tr>
                            ) : pending.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                        No pending signup requests.
                                    </td>
                                </tr>
                            ) : (
                                pending.map((req) => (
                                    <tr key={req.id}>
                                        <td className="px-3 py-2 font-medium text-gray-900">{req.name}</td>
                                        <td className="px-3 py-2 text-gray-600">{req.email}</td>
                                        <td className="px-3 py-2 text-gray-600">{req.department_code || '—'}</td>
                                        <td className="px-3 py-2 text-gray-600">{formatIsoDateTime(req.created_at)}</td>
                                        <td className="px-3 py-2 text-right space-x-2">
                                            <button
                                                type="button"
                                                onClick={() => handleDecision(req.id, 'approve')}
                                                disabled={actionId === req.id}
                                                className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                                            >
                                                Approve
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDecision(req.id, 'reject')}
                                                disabled={actionId === req.id}
                                                className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
                                            >
                                                Reject
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow">
                <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold text-gray-900">Recently processed</h2>
                    <p className="text-sm text-gray-500">Latest approvals and rejections · scroll to review more than 10</p>
                </div>
                <div className="mt-4 overflow-x-auto">
                    <div className="max-h-[420px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">Name</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Reviewer</th>
                                    <th className="px-3 py-2">Reviewed</th>
                                    <th className="px-3 py-2">Notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                            Loading…
                                        </td>
                                    </tr>
                                ) : completed.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                                            No recent decisions yet.
                                        </td>
                                    </tr>
                                ) : (
                                    completed.map((req) => (
                                        <tr key={req.id}>
                                            <td className="px-3 py-2 font-medium text-gray-900">
                                                <div>{req.name}</div>
                                                <div className="text-xs text-gray-500">{req.email}</div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                        req.status === 'approved'
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-rose-100 text-rose-700'
                                                    }`}
                                                >
                                                    {req.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">{req.reviewer_name || req.reviewer_email || '—'}</td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {req.reviewed_at ? formatIsoDateTime(req.reviewed_at) : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {req.review_comment ? req.review_comment : <span className="text-gray-400">—</span>}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}



function UserManagementPanel() {
    const { user: authUser, updateUser } = useAuth();
    const [accounts, setAccounts] = useState<AdminAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | AdminAccount['role']>('all');
    const [form, setForm] = useState<AccountFormState>({ ...EMPTY_FORM });
    const [isEditing, setIsEditing] = useState(false);
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const formRef = useRef<HTMLFormElement | null>(null);
    const { addToast } = useToast();

    const refresh = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.get<AdminAccount[]>('/reviewers');
            setAccounts(Array.isArray(data) ? data : []);
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load user accounts.');
            setAccounts([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    const filteredAccounts = useMemo(() => {
        const term = search.trim().toLowerCase();
        return accounts.filter((account) => {
            const matchesRole = roleFilter === 'all' || account.role === roleFilter;
            if (!matchesRole) return false;
            if (!term) return true;
            const haystack = [account.display_name, account.email, account.role]
                .map((part) => String(part || '').toLowerCase())
                .join(' ');
            return haystack.includes(term);
        });
    }, [accounts, search, roleFilter]);

    const resetForm = (clearSuccess = true) => {
        setForm({ ...EMPTY_FORM });
        setIsEditing(false);
        setFormError('');
        if (clearSuccess) setFormSuccess('');
    };

    const startEdit = (account: AdminAccount) => {
        setForm({
            id: account.id,
            email: account.email,
            display_name: account.display_name || '',
            role: account.role,
            department_code: account.department_code || '',
            notify_on_submission: account.notify_on_submission ?? (account.role === 'reviewer'),
        });
        setIsEditing(true);
        setFormError('');
        setFormSuccess('');
        setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    const handleStatusToggle = async (account: AdminAccount) => {
        const nextStatus = account.status === 'active' ? 'inactive' : 'active';
        try {
            await apiClient.put(`/reviewers/${account.id}`, { status: nextStatus });
            await refresh();
            addToast(`Account ${account.email} is now ${nextStatus}.`, 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update status.', 'error');
        }
    };

    const handleDelete = async (account: AdminAccount) => {
        const confirmed = window.confirm(`Delete ${account.email}? This cannot be undone.`);
        if (!confirmed) return;
        try {
            await apiClient.delete(`/reviewers/${account.id}`);
            if (isEditing && form.id === account.id) {
                resetForm();
            }
            await refresh();
            addToast(`Deleted account ${account.email}.`, 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to delete account.', 'error');
        }
    };

    const handleResetPassword = async (account: AdminAccount) => {
        try {
            const response = await apiClient.post<{ temporary_password?: string }>(`/reviewers/${account.id}/reset-password`, {
                send_email: false,
            });
            if (response?.temporary_password) {
                addToast(`Temporary password for ${account.email}: ${response.temporary_password}`, 'info');
            } else {
                addToast('Password reset. User must change it on next login.', 'success');
            }
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to reset password.', 'error');
        }
    };

    const handleFormSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setFormError('');
        setFormSuccess('');
        if (!form.email.trim() && !isEditing) {
            setFormError('Email is required.');
            return;
        }
        const trimmedDept = (form.department_code || '').trim();
        if (form.role === 'user') {
            if (!/^\d{2}$/.test(trimmedDept)) {
                setFormError('Users must have a two-digit Department Head code.');
                return;
            }
        } else if (trimmedDept && !/^\d{2}$/.test(trimmedDept)) {
            setFormError('Department codes must be two digits.');
            return;
        }

        const body: Record<string, unknown> = {
            display_name: form.display_name?.trim() || null,
            role: form.role,
        };

        body.department_code = trimmedDept || null;

        if (form.role === 'reviewer' || form.role === 'admin') {
            body.notify_on_submission = form.notify_on_submission === true;
        } else {
            body.notify_on_submission = false;
        }

        setSaving(true);
        try {
            if (isEditing && form.id) {
                await apiClient.put(`/reviewers/${form.id}`, body);
                setFormSuccess('Account updated.');
                if (authUser && String(authUser.id) === form.id) {
                    updateUser({
                        display_name: (body.display_name as string | null) || undefined,
                        role: body.role as AdminAccount['role'],
                        department_code: (body.department_code as string | null) || undefined,
                    });
                }
            } else {
                await apiClient.post('/reviewers', {
                    ...body,
                    email: form.email.trim().toLowerCase(),
                    send_email: false,
                });
                setFormSuccess('Account created.');
            }
            await refresh();
            resetForm(false);
        } catch (err) {
            setFormError((err as Error)?.message || 'Unable to save account.');
        } finally {
            setSaving(false);
        }
    };

    const canReceiveNotifications = form.role === 'reviewer' || form.role === 'admin';

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow">
                <div className="mb-4 flex flex-col gap-1">
                    <h2 className="text-xl font-semibold text-gray-900">{isEditing ? 'Edit user' : 'Add user'}</h2>
                    <p className="text-sm text-gray-500">
                        {isEditing
                            ? "Update a user's role, department, and notification preferences."
                            : 'Create a new account for a submitter, banking officer, payroll user, reviewer, or admin.'}
                    </p>
                </div>
                <form ref={formRef} onSubmit={handleFormSubmit} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                            Email
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                disabled={isEditing}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                            />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Display name
                            <input
                                type="text"
                                value={form.display_name || ''}
                                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                            Role
                            <select
                                value={form.role}
                                onChange={(e) => {
                                    const nextRole = e.target.value as AdminAccount['role'];
                                    setForm({
                                        ...form,
                                        role: nextRole,
                                        notify_on_submission:
                                            nextRole === 'reviewer' || nextRole === 'admin'
                                                ? form.notify_on_submission
                                                : false,
                                    });
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                                <option value="user">User</option>
                                <option value="banking">Banking</option>
                                <option value="payroll">Payroll</option>
                                <option value="reviewer">Reviewer</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Department head code {form.role === 'user' ? '(required)' : '(optional)'}
                            <input
                                type="text"
                                value={form.department_code || ''}
                                onChange={(e) => setForm({ ...form, department_code: e.target.value })}
                                maxLength={2}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                                placeholder="e.g. 12"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                Used to auto-fill batch submissions and audit metadata.
                            </p>
                        </label>
                    </div>

                    <label className={`inline-flex items-center gap-2 text-sm font-medium text-gray-700 ${!canReceiveNotifications ? 'opacity-60' : ''}`}>
                        <input
                            type="checkbox"
                            checked={Boolean(form.notify_on_submission)}
                            onChange={(e) => setForm({ ...form, notify_on_submission: e.target.checked })}
                            disabled={!canReceiveNotifications}
                        />
                        Receive submission notifications (reviewers & admins)
                    </label>

                    {formError && <p className="text-sm text-red-600">{formError}</p>}
                    {formSuccess && <p className="text-sm text-green-600">{formSuccess}</p>}

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
                        >
                            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create user'}
                        </button>
                        {isEditing && (
                            <button
                                type="button"
                                onClick={() => resetForm()}
                                className="rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-900">User list</h3>
                        <p className="text-sm text-gray-500">
                            {loading ? 'Loading…' : `${filteredAccounts.length} of ${accounts.length} accounts`} · Scroll to see more than 10
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="search"
                            placeholder="Search name or email"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <select
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="all">All roles</option>
                            <option value="user">User</option>
                            <option value="banking">Banking</option>
                            <option value="payroll">Payroll</option>
                            <option value="reviewer">Reviewer</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button
                            type="button"
                            onClick={refresh}
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="rounded-xl border border-gray-100">
                    <div className="max-h-[520px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">User</th>
                                    <th className="px-3 py-2">Role</th>
                                    <th className="px-3 py-2">Department</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Notify</th>
                                    <th className="px-3 py-2">Last Login</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                            Loading…
                                        </td>
                                    </tr>
                                ) : filteredAccounts.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                            No accounts match the current filters.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAccounts.map((account) => (
                                        <tr key={account.id}>
                                            <td className="px-3 py-2">
                                                <div className="font-semibold text-gray-900">{account.display_name || '—'}</div>
                                                <div className="text-xs text-gray-500">{account.email}</div>
                                            </td>
                                            <td className="px-3 py-2 capitalize">{account.role}</td>
                                            <td className="px-3 py-2 font-mono text-gray-600">{account.department_code || '—'}</td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                        account.status === 'active'
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-gray-200 text-gray-700'
                                                    }`}
                                                >
                                                    {account.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                {account.role === 'reviewer' || account.role === 'admin' ? (
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                            account.notify_on_submission ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                                                        }`}
                                                    >
                                                        {account.notify_on_submission ? 'On' : 'Off'}
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500">N/A</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {account.last_login_at ? formatIsoDateTime(account.last_login_at) : 'Never'}
                                            </td>
                                            <td className="px-3 py-2 text-right space-x-2">
                                                <button
                                                    type="button"
                                                    onClick={() => startEdit(account)}
                                                    className="text-xs text-indigo-600 hover:text-indigo-800"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleResetPassword(account)}
                                                    className="text-xs text-indigo-600 hover:text-indigo-800"
                                                >
                                                    Reset password
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleStatusToggle(account)}
                                                    className="text-xs text-amber-600 hover:text-amber-800"
                                                >
                                                    {account.status === 'active' ? 'Deactivate' : 'Activate'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(account)}
                                                    className="text-xs text-red-600 hover:text-red-800"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}

function AdminArchivesPanel() {
    const [archives, setArchives] = useState<AdminArchiveEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [showFullArchive, setShowFullArchive] = useState(false);
    const { addToast } = useToast();
    const [deleteTarget, setDeleteTarget] = useState<AdminArchiveEntry | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState('');

    const fetchArchives = useCallback(async (full: boolean) => {
        setLoading(true);
        setError('');
        try {
            const query = full ? '/archives?scope=all' : `/archives?limit=${ADMIN_ARCHIVE_LIMIT}`;
            const data = await apiClient.get<AdminArchiveEntry[]>(query);
            setArchives(Array.isArray(data) ? data : []);
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load archives.');
            setArchives([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchArchives(showFullArchive);
    }, [fetchArchives, showFullArchive]);

    const filteredArchives = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return archives;
        return archives.filter((archive) => {
            const haystack = [
                archive.code,
                archive.pd_number,
                archive.department_code,
                archive.submitted_email,
                archive.stage,
                archive.transactions?.prepared_by,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            const compactTerm = term.replace(/[^a-z0-9]/g, '');
            const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
            return haystack.includes(term) || (compactTerm && compactHaystack.includes(compactTerm));
        });
    }, [archives, searchTerm]);

    const archiveStats = useMemo(() => {
        const stats = {
            total: filteredArchives.length,
            submitted: 0,
            approved: 0,
            rejected: 0,
        };
        filteredArchives.forEach((archive) => {
            const stage = (archive.stage || '').toLowerCase();
            if (stage in stats) {
                stats[stage as keyof typeof stats] += 1;
            }
        });
        return stats;
    }, [filteredArchives]);

    const scopeHint = useMemo(() => {
        const scope = showFullArchive ? 'Scope: full archive' : 'Scope: recent';
        const filterSuffix = searchTerm.trim() ? ' • filters applied' : '';
        return `${scope}${filterSuffix}`;
    }, [showFullArchive, searchTerm]);

    const startDelete = (entry: AdminArchiveEntry) => {
        setDeleteTarget(entry);
        setDeleteError('');
    };

    const closeDeleteModal = () => {
        if (deleteLoading) return;
        setDeleteTarget(null);
        setDeleteError('');
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleteLoading(true);
        setDeleteError('');
        try {
            await apiClient.delete(`/batches/${encodeURIComponent(deleteTarget.code)}`);
            addToast(`Batch ${formatBatchCode(deleteTarget.code)} deleted.`, 'success');
            setDeleteTarget(null);
            await fetchArchives(showFullArchive);
        } catch (err) {
            setDeleteError((err as Error)?.message || 'Unable to delete batch.');
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-sm text-gray-500">Archive oversight</p>
                        <h2 className="text-2xl font-semibold text-gray-900">Batch archives</h2>
                        <p className="text-sm text-gray-600">View and hand off any batch in the system.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input
                        type="search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search code or PD#"
                        className="rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                        type="button"
                        onClick={() => setShowFullArchive((prev) => !prev)}
                        className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        {showFullArchive ? 'Show recent only' : 'Load full archive'}
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchArchives(showFullArchive)}
                        className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Refresh
                    </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total batches</p>
                        <p className="mt-1 text-3xl font-semibold text-gray-900">{archiveStats.total.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">{scopeHint}</p>
                    </div>
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Submitted</p>
                        <p className="mt-1 text-3xl font-semibold text-blue-900">{archiveStats.submitted.toLocaleString()}</p>
                        <p className="text-xs text-blue-700">Current view</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Approved</p>
                        <p className="mt-1 text-3xl font-semibold text-emerald-900">{archiveStats.approved.toLocaleString()}</p>
                        <p className="text-xs text-emerald-700">Current view</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Rejected</p>
                        <p className="mt-1 text-3xl font-semibold text-rose-900">{archiveStats.rejected.toLocaleString()}</p>
                        <p className="text-xs text-rose-700">Current view</p>
                    </div>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="overflow-hidden rounded-xl border border-gray-100">
                    <div className="max-h-[520px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">Code</th>
                                    <th className="px-3 py-2">Stage</th>
                                    <th className="px-3 py-2">PD#</th>
                                    <th className="px-3 py-2">Department</th>
                                    <th className="px-3 py-2">Submitted</th>
                                    <th className="px-3 py-2">Prepared by</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">Loading archives…</td>
                                    </tr>
                                ) : filteredArchives.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">No archives match your search.</td>
                                    </tr>
                                ) : (
                                    filteredArchives.map((archive) => {
                                        const badge = getBatchStageBadgeClasses(archive.stage);
                                        return (
                                            <tr key={archive.code}>
                                                <td className="px-3 py-2 font-mono text-indigo-600">{formatBatchCode(archive.code)}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                                                        {STAGE_META[archive.stage as keyof typeof STAGE_META]?.label || archive.stage}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">{archive.pd_number ? formatPdNumber(archive.pd_number) : '—'}</td>
                                                <td className="px-3 py-2">{archive.department_code || '—'}</td>
                                                <td className="px-3 py-2 text-sm text-gray-500">{formatIsoDateTime(archive.created_at)}</td>
                                                <td className="px-3 py-2 text-sm text-gray-600">{archive.transactions?.prepared_by || '—'}</td>
                                                <td className="px-3 py-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => startDelete(archive)}
                                                        className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={closeDeleteModal}>
                    <div
                        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Permanent action</p>
                                <h3 className="text-2xl font-semibold text-gray-900">Delete {formatBatchCode(deleteTarget.code)}?</h3>
                                <p className="mt-1 text-sm text-gray-600">
                                    This removes the batch from the archive and cannot be undone.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeDeleteModal}
                                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                            >
                                ×
                            </button>
                        </div>
                        {deleteError && <p className="mt-3 text-sm text-rose-600">{deleteError}</p>}
                        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeDeleteModal}
                                disabled={deleteLoading}
                                className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmDelete}
                                disabled={deleteLoading}
                                className="rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-rose-500 disabled:opacity-60"
                            >
                                {deleteLoading ? 'Deleting…' : 'Delete batch'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}




function BlacklistPanel() {
    const [entries, setEntries] = useState<BlacklistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [form, setForm] = useState<BlacklistFormState>({ ...EMPTY_BLACKLIST_FORM });
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [actionId, setActionId] = useState<number | null>(null);
    const [importSummary, setImportSummary] = useState('');
    const { addToast } = useToast();
    const [importError, setImportError] = useState('');
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);

    const parseActiveValue = (raw: string | boolean | null | undefined): boolean | null => {
        if (typeof raw === 'boolean') return raw;
        const normalized = String(raw ?? '')
            .trim()
            .toLowerCase();
        if (!normalized) return true;
        if (['true', 't', '1', 'yes', 'y', 'active', 'enabled'].includes(normalized)) return true;
        if (['false', 'f', '0', 'no', 'n', 'inactive', 'disabled'].includes(normalized)) return false;
        return null;
    };

    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.get<BlacklistEntry[]>('/blacklist');
            setEntries(Array.isArray(data) ? data : []);
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load blacklist entries.');
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const filteredEntries = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return entries;
        return entries.filter((entry) => {
            const haystack = [entry.bsb, entry.account, entry.label, entry.notes]
                .map((value) => String(value || '').toLowerCase())
                .join(' ');
            return haystack.includes(term);
        });
    }, [entries, search]);

    const handleFormChange = (field: keyof BlacklistFormState) => (value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setFormError('');
        setFormSuccess('');
    };

    const handleEdit = (entry: BlacklistEntry) => {
        setForm({
            id: entry.id,
            bsb: formatBSB(entry.bsb),
            account: entry.account || '',
            label: entry.label || '',
            notes: entry.notes || '',
            active: entry.active === false ? 'no' : 'yes',
        });
        setFormError('');
        setFormSuccess('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setForm({ ...EMPTY_BLACKLIST_FORM });
        setFormError('');
        setFormSuccess('');
    };

    const handleFormSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setFormError('');
        setFormSuccess('');
        const normalizedBsb = normalizeBSBStrict(form.bsb);
        const normalizedAccount = normalizeAccountStrict(form.account);
        if (!normalizedBsb) {
            setFormError('Enter a valid BSB in NNN-NNN format.');
            return;
        }
        if (!normalizedAccount || normalizedAccount.length < 5 || normalizedAccount.length > 16) {
            setFormError('Account number must be 5-16 digits.');
            return;
        }
        const payload = {
            bsb: normalizedBsb,
            account: normalizedAccount,
            label: form.label.trim() || null,
            notes: form.notes.trim() || null,
            active: form.active === 'yes',
        };
        setSaving(true);
        try {
            if (form.id) {
                await apiClient.put(`/blacklist/${form.id}`, payload);
                setFormSuccess('Entry updated.');
            } else {
                await apiClient.post('/blacklist', payload);
                setFormSuccess('Entry added.');
            }
            resetForm();
            await refresh();
        } catch (err) {
            setFormError((err as Error)?.message || 'Unable to save entry.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (entry: BlacklistEntry) => {
        setActionId(entry.id);
        try {
            await apiClient.put(`/blacklist/${entry.id}`, { active: !entry.active });
            await refresh();
            addToast(`Entry ${entry.bsb} · ${entry.account} ${entry.active ? 'disabled' : 'enabled'}.`, 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update entry.', 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleDelete = async (entry: BlacklistEntry) => {
        const confirmed = window.confirm(`Delete blacklist entry for ${entry.bsb} · ${entry.account}?`);
        if (!confirmed) return;
        setActionId(entry.id);
        try {
            await apiClient.delete(`/blacklist/${entry.id}`);
            if (form.id === entry.id) {
                resetForm();
            }
            await refresh();
            addToast(`Removed blacklist entry ${entry.bsb} · ${entry.account}.`, 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to delete entry.', 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setImportError('');
        setImportSummary('');
        setImporting(true);
        try {
            const text = await file.text();
            const { entries: rows, issues } = parseBlacklistCsv(text);
            if (!rows.length) {
                setImportError(issues[0] || 'File did not contain any blacklist entries.');
                return;
            }
            if (rows.length > BLACKLIST_IMPORT_LIMIT) {
                setImportError(`Import is limited to ${BLACKLIST_IMPORT_LIMIT} rows per file.`);
                return;
            }
            const localIssues = [...issues];
            const payload = rows
                .map((row) => {
                    const normalizedBsb = normalizeBSBStrict(row.bsb);
                    const normalizedAccount = normalizeAccountStrict(row.account);
                    const activeValue = parseActiveValue(row.active);
                    if (!normalizedBsb || !normalizedAccount) {
                        localIssues.push(`Row ${row.rowNumber}: invalid BSB or account number.`);
                        return null;
                    }
                    if (activeValue === null) {
                        localIssues.push(`Row ${row.rowNumber}: active flag must be yes/no.`);
                        return null;
                    }
                    return {
                        rowNumber: row.rowNumber,
                        bsb: normalizedBsb,
                        account: normalizedAccount,
                        label: row.label || null,
                        notes: row.notes || null,
                        active: activeValue,
                    };
                })
                .filter(Boolean) as Array<{
                    rowNumber: number;
                    bsb: string;
                    account: string;
                    label: string | null;
                    notes: string | null;
                    active: boolean;
                }>;
            if (!payload.length) {
                setImportError(localIssues[0] || 'No valid rows to import.');
                return;
            }
            const response = await apiClient.post<{
                inserted?: number;
                updated?: number;
                skipped?: number;
                errors?: { index?: number; message?: string }[];
            }>('/blacklist/import', { entries: payload });
            await refresh();
            const summaryParts = [
                `${response?.inserted ?? 0} inserted`,
                `${response?.updated ?? 0} updated`,
            ];
            if (response?.skipped) summaryParts.push(`${response.skipped} skipped on server`);
            if (localIssues.length) summaryParts.push(`${localIssues.length} skipped locally`);
            setImportSummary(summaryParts.join(' · '));

            const serverErrors = Array.isArray(response?.errors) ? response.errors : [];
            if (serverErrors.length) {
                const details = serverErrors.slice(0, 5).map((err) => {
                    const prefix = err?.index ? `Row ${err.index}` : 'Row ?';
                    return `${prefix}: ${err?.message || 'Import failed.'}`;
                });
                setImportError(details.join(' '));
            } else if (localIssues.length) {
                setImportError(localIssues.slice(0, 5).join(' '));
            } else {
                setImportError('');
            }
        } catch (err) {
            setImportError((err as Error)?.message || 'Unable to import file.');
        } finally {
            setImporting(false);
            if (event.target) event.target.value = '';
        }
    };

    const activeCount = entries.filter((entry) => entry.active !== false).length;

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Manage blacklist</h2>
                    <p className="text-sm text-gray-500">Block closed or compromised bank accounts. Active entries are enforced during submission.</p>
                </div>
                <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                            BSB
                            <input
                                type="text"
                                value={form.bsb}
                                onChange={(e) => handleFormChange('bsb')(e.target.value)}
                                placeholder="123-456"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase"
                            />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Account number
                            <input
                                type="text"
                                value={form.account}
                                onChange={(e) => handleFormChange('account')(e.target.value)}
                                placeholder="8-16 digits"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                            Label (optional)
                            <input
                                type="text"
                                value={form.label}
                                onChange={(e) => handleFormChange('label')(e.target.value)}
                                placeholder="e.g. Payroll closed"
                                maxLength={200}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Status
                            <select
                                value={form.active}
                                onChange={(e) => handleFormChange('active')(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="yes">Active (block transfers)</option>
                                <option value="no">Disabled</option>
                            </select>
                        </label>
                    </div>
                    <label className="text-sm font-medium text-gray-700">
                        Notes (internal, optional)
                        <textarea
                            value={form.notes}
                            onChange={(e) => handleFormChange('notes')(e.target.value)}
                            rows={3}
                            maxLength={2000}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            placeholder="Add quick context for other admins"
                        />
                    </label>
                    {formError && <p className="text-sm text-red-600">{formError}</p>}
                    {formSuccess && <p className="text-sm text-green-600">{formSuccess}</p>}
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
                        >
                            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add entry'}
                        </button>
                        {form.id && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Cancel edit
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow space-y-4">
                <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleImportFile}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-900">Blocked accounts</h3>
                        <p className="text-sm text-gray-500">{activeCount} active · {entries.length} total</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search BSB, account, or label"
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                            type="button"
                            onClick={refresh}
                            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Refresh
                        </button>
                        <button
                            type="button"
                            onClick={handleImportClick}
                            disabled={importing}
                            className="rounded-full border border-dashed border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-60"
                        >
                            {importing ? 'Importing…' : 'Import CSV'}
                        </button>
                    </div>
                </div>
                {(importSummary || importError) && (
                    <div className="text-sm space-y-1">
                        {importSummary && <p className="text-green-600">{importSummary}</p>}
                        {importError && <p className="text-red-600">{importError}</p>}
                    </div>
                )}
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="overflow-hidden rounded-xl border border-gray-100">
                    <div className="max-h-[520px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">BSB</th>
                                    <th className="px-3 py-2">Account</th>
                                    <th className="px-3 py-2">Label</th>
                                    <th className="px-3 py-2">Notes</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading entries…</td>
                                    </tr>
                                ) : filteredEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                                            {search ? 'No entries match the current search.' : 'No blacklist entries recorded yet.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredEntries.map((entry) => {
                                        const active = entry.active !== false;
                                        return (
                                            <tr key={entry.id}>
                                                <td className="px-3 py-2 font-mono text-indigo-600">{formatBSB(entry.bsb)}</td>
                                                <td className="px-3 py-2 font-mono text-gray-700">{entry.account}</td>
                                                <td className="px-3 py-2">{entry.label || '—'}</td>
                                                <td className="px-3 py-2 text-sm text-gray-600">{entry.notes || '—'}</td>
                                                <td className="px-3 py-2">
                                                    <span
                                                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                                            active ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                                                        }`}
                                                    >
                                                        {active ? 'Active' : 'Disabled'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-right space-x-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEdit(entry)}
                                                        className="text-xs text-indigo-600 hover:text-indigo-800"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggle(entry)}
                                                        disabled={actionId === entry.id}
                                                        className="text-xs text-amber-600 hover:text-amber-800 disabled:opacity-60"
                                                    >
                                                        {active ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(entry)}
                                                        disabled={actionId === entry.id}
                                                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-60"
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}

function TestingModePanel() {
    const [state, setState] = useState<TestingModeState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [feedbackTone, setFeedbackTone] = useState<'neutral' | 'success' | 'error'>('neutral');

    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.get<TestingModeState>('/admin/testing-mode');
            setState(data || { enabled: false, updated_at: null, set_by_email: null, set_by_name: null });
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load testing status.');
            setState(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleToggle = async () => {
        if (!state) return;
        setSaving(true);
        setFeedback('');
        setFeedbackTone('neutral');
        try {
            const updated = await apiClient.post<TestingModeState>('/admin/testing-mode', { enabled: !state.enabled });
            setState(updated);
            setFeedback(updated.enabled ? 'Testing mode enabled. Emails are now muted.' : 'Testing mode disabled. Emails will send normally.');
            setFeedbackTone('success');
        } catch (err) {
            setFeedback((err as Error)?.message || 'Unable to update testing mode.');
            setFeedbackTone('error');
        } finally {
            setSaving(false);
        }
    };

    const statusLabel = state?.enabled ? 'Testing mode is active' : 'Testing mode is off';
    const statusDescription = state?.enabled
        ? 'All outbound emails and SMS are currently suppressed.'
        : 'Emails will be delivered to real recipients.';
    const changedBy = state?.set_by_name || state?.set_by_email || 'another admin';
    const lastChangedSummary = state?.updated_at
        ? `Last changed ${formatIsoDateTime(state.updated_at)} by ${changedBy}.`
        : 'No prior changes recorded.';

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-semibold text-gray-900">Testing mode</h2>
                    <p className="text-sm text-gray-600">Use this switch to mute outbound notifications while troubleshooting or preparing new data.</p>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                    {loading ? (
                        <p>Loading status…</p>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-base font-semibold">{statusLabel}</p>
                            <p>{statusDescription}</p>
                            <p className="text-xs text-gray-500">{lastChangedSummary}</p>
                        </div>
                    )}
                </div>
                {state?.enabled && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        Warning: while testing mode is on, reviewers and submitters will not receive email notifications. Remember to disable it when finished.
                    </div>
                )}
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleToggle}
                        disabled={loading || saving}
                        className={`rounded-full px-6 py-2 text-sm font-semibold text-white shadow ${
                            state?.enabled
                                ? 'bg-red-600 hover:bg-red-500'
                                : 'bg-indigo-600 hover:bg-indigo-500'
                        } disabled:opacity-60`}
                    >
                        {saving ? 'Saving…' : state?.enabled ? 'Disable testing mode' : 'Enable testing mode'}
                    </button>
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={loading}
                        className="rounded-full border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                        Refresh status
                    </button>
                </div>
                {feedback && (
                    <p
                        className={`text-sm ${
                            feedbackTone === 'success'
                                ? 'text-green-600'
                                : feedbackTone === 'error'
                                    ? 'text-red-600'
                                    : 'text-gray-600'
                        }`}
                    >
                        {feedback}
                    </p>
                )}
            </div>
        </section>
    );
}

function SmtpSettingsPanel() {
    const { addToast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [testLoading, setTestLoading] = useState(false);
    const [settings, setSettings] = useState({
        smtp_host: '',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: '',
        smtp_pass: '',
        from_email: '',
        reply_to_email: '',
        support_email: ''
    });
    const [configured, setConfigured] = useState(false);
    const [source, setSource] = useState<'database' | 'environment'>('environment');

    const loadSettings = useCallback(async () => {
        try {
            const data = await apiClient.get<any>('/admin/smtp-settings');
            setSettings({
                smtp_host: data.smtp_host || '',
                smtp_port: data.smtp_port || 587,
                smtp_secure: data.smtp_secure || false,
                smtp_user: data.smtp_user || '',
                smtp_pass: '',
                from_email: data.from_email || '',
                reply_to_email: data.reply_to_email || '',
                support_email: data.support_email || ''
            });
            setConfigured(data.configured || false);
            setSource(data.source || 'environment');
        } catch (err) {
            addToast((err as Error).message || 'Failed to load SMTP settings', 'error');
        }
    }, [addToast]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await apiClient.post('/admin/smtp-settings', settings);
            addToast('SMTP settings saved successfully', 'success');
            await loadSettings();
        } catch (err) {
            addToast((err as Error).message || 'Failed to save SMTP settings', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleTest = async () => {
        setTestLoading(true);
        try {
            const result = await apiClient.post<{ success: boolean; message: string }>('/admin/smtp-settings/test', {
                test_email: user?.email
            });
            addToast(result.message, result.success ? 'success' : 'error');
        } catch (err) {
            addToast((err as Error).message || 'SMTP test failed', 'error');
        } finally {
            setTestLoading(false);
        }
    };

    return (
        <section className="rounded-2xl bg-white p-6 shadow">
            <div className="border-b border-gray-200 pb-4">
                <h2 className="text-xl font-semibold text-gray-900">Email (SMTP) Settings</h2>
                <p className="mt-1 text-sm text-gray-600">
                    Configure email server settings for notifications and alerts.
                    {source === 'environment' && configured && (
                        <span className="ml-2 text-amber-600">(Currently using environment variables)</span>
                    )}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <label htmlFor="smtp_host" className="block text-sm font-medium text-gray-700">
                            SMTP Host *
                        </label>
                        <input
                            type="text"
                            id="smtp_host"
                            required
                            value={settings.smtp_host}
                            onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                            placeholder="smtp.example.com"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="smtp_port" className="block text-sm font-medium text-gray-700">
                            SMTP Port *
                        </label>
                        <input
                            type="number"
                            id="smtp_port"
                            required
                            min="1"
                            max="65535"
                            value={settings.smtp_port}
                            onChange={(e) => setSettings({ ...settings, smtp_port: parseInt(e.target.value) })}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="smtp_secure"
                            checked={settings.smtp_secure}
                            onChange={(e) => setSettings({ ...settings, smtp_secure: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="smtp_secure" className="ml-2 block text-sm text-gray-700">
                            Use SSL/TLS (port 465)
                        </label>
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <label htmlFor="smtp_user" className="block text-sm font-medium text-gray-700">
                            SMTP Username
                        </label>
                        <input
                            type="text"
                            id="smtp_user"
                            value={settings.smtp_user}
                            onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                            placeholder="username@example.com"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="smtp_pass" className="block text-sm font-medium text-gray-700">
                            SMTP Password
                        </label>
                        <input
                            type="password"
                            id="smtp_pass"
                            value={settings.smtp_pass}
                            onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
                            placeholder="Leave blank to keep existing"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <label htmlFor="from_email" className="block text-sm font-medium text-gray-700">
                            From Email *
                        </label>
                        <input
                            type="email"
                            id="from_email"
                            required
                            value={settings.from_email}
                            onChange={(e) => setSettings({ ...settings, from_email: e.target.value })}
                            placeholder="noreply@example.com"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="reply_to_email" className="block text-sm font-medium text-gray-700">
                            Reply-To Email
                        </label>
                        <input
                            type="email"
                            id="reply_to_email"
                            value={settings.reply_to_email}
                            onChange={(e) => setSettings({ ...settings, reply_to_email: e.target.value })}
                            placeholder="support@example.com"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="support_email" className="block text-sm font-medium text-gray-700">
                        Support Email (Signup Notifications)
                    </label>
                    <input
                        type="email"
                        id="support_email"
                        value={settings.support_email}
                        onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
                        placeholder="support@example.com"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                        If specified, all signup request notifications will be sent to this email instead of all admins.
                    </p>
                </div>

                <div className="flex gap-3 border-t border-gray-200 pt-6">
                    <button
                        type="submit"
                        disabled={loading}
                        className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                        {loading ? 'Saving...' : 'Save Settings'}
                    </button>
                    <button
                        type="button"
                        onClick={handleTest}
                        disabled={testLoading || !configured}
                        className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                        {testLoading ? 'Testing...' : 'Send Test Email'}
                    </button>
                    <button
                        type="button"
                        onClick={loadSettings}
                        className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Reload
                    </button>
                </div>
            </form>
        </section>
    );
}
