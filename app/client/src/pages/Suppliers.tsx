import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { useToast } from '../contexts/useToast';
import { EmptyState, Icon, LoadingState } from '../components/Ui';
import { apiClient } from '../lib/api';

type SupplierStatus = 'blocked' | 'enabled' | 'removed';

interface Supplier {
    id: number;
    supplier_id: string;
    description: string;
    email: string | null;
    need_cba_bank_account: boolean;
    status: SupplierStatus;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

function cbaStatusMeta(need: boolean) {
    return need
        ? { label: 'Pending', badge: 'bg-amber-50 text-amber-800 border-amber-200' }
        : { label: 'Complete', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

interface SupplierPage {
    items: Supplier[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

const STATUS_META: Record<
    SupplierStatus,
    { label: string; badge: string; dot: string }
> = {
    blocked: {
        label: 'Blocked',
        badge: 'bg-red-50 text-red-700 border-red-100',
        dot: 'bg-red-500',
    },
    enabled: {
        label: 'Enabled',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        dot: 'bg-emerald-500',
    },
    removed: {
        label: 'Removed',
        badge: 'bg-zinc-100 text-zinc-600 border-zinc-200',
        dot: 'bg-zinc-400',
    },
};

const PAGE_SIZE = 50;

export function Suppliers() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [items, setItems] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<SupplierStatus | ''>('');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const canManage = user && ['banking', 'reviewer', 'admin'].includes(user.role);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            params.set('limit', String(PAGE_SIZE));
            params.set('offset', String(offset));
            if (search.trim()) params.set('search', search.trim());
            if (statusFilter) params.set('status', statusFilter);
            const data = await apiClient.get<SupplierPage>(`/suppliers?${params.toString()}`);
            setItems(Array.isArray(data.items) ? data.items : []);
            setTotal(data.total || 0);
            setHasMore(Boolean(data.hasMore));
        } catch (err) {
            setError((err as Error)?.message || 'Unable to load suppliers.');
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [offset, search, statusFilter]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setOffset(0);
            load();
        }, 250);
        return () => clearTimeout(timer);
    }, [search, statusFilter, load]);

    useEffect(() => {
        load();
    }, [offset, load]);

    const updateStatus = async (supplier: Supplier, status: SupplierStatus, notes?: string) => {
        try {
            await apiClient.patch(`/suppliers/${supplier.id}`, {
                status,
                notes: notes !== undefined ? notes : supplier.notes,
            });
            addToast(`Supplier ${supplier.supplier_id} marked as ${STATUS_META[status].label.toLowerCase()}`, 'success');
            load();
        } catch (err) {
            addToast((err as Error)?.message || 'Failed to update supplier.', 'error');
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
                        <p className="text-sm text-gray-600 mt-1">
                            Search supplier records. Please provide CBA bank details and proof of account to enable a supplier in FMIS.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                                <Icon name="search" className="h-4 w-4" />
                            </span>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search ID, name or email"
                                className="w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-64"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => {
                                setStatusFilter(e.target.value as SupplierStatus | '');
                                setOffset(0);
                            }}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-44"
                        >
                            <option value="">All statuses</option>
                            <option value="blocked">Blocked</option>
                            <option value="enabled">Enabled</option>
                            <option value="removed">Removed</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow sm:p-6">
                {loading && items.length === 0 && (
                    <LoadingState label="Loading suppliers…" />
                )}

                {!loading && items.length === 0 && !error && (
                    <EmptyState
                        title="No suppliers found"
                        detail={search || statusFilter ? 'Try adjusting your search or status filter.' : 'Supplier list is empty.'}
                    />
                )}

                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                        <p className="font-medium">Unable to load suppliers</p>
                        <p className="mt-1 text-sm">{error}</p>
                    </div>
                )}

                {items.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    <th className="px-3 py-3">Supplier ID</th>
                                    <th className="px-3 py-3">Description</th>
                                    <th className="px-3 py-3">Email</th>
                                    <th className="px-3 py-3">Need CBA bank account</th>
                                    <th className="px-3 py-3">Status</th>
                                    {canManage && <th className="px-3 py-3 text-right">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {items.map((supplier) => (
                                    <SupplierRow
                                        key={supplier.id}
                                        supplier={supplier}
                                        canManage={Boolean(canManage)}
                                        onUpdate={updateStatus}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {items.length > 0 && (
                    <div className="mt-4 flex items-center justify-between text-sm text-zinc-600">
                        <span>
                            Showing {offset + 1}-{Math.min(offset + items.length, total)} of {total}
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                                disabled={offset === 0 || loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Icon name="chevronLeft" className="h-4 w-4" />
                                Previous
                            </button>
                            <button
                                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                                disabled={!hasMore || loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Next
                                <Icon name="chevronRight" className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SupplierRow({
    supplier,
    canManage,
    onUpdate,
}: {
    supplier: Supplier;
    canManage: boolean;
    onUpdate: (supplier: Supplier, status: SupplierStatus, notes?: string) => Promise<void>;
}) {
    const [showNotes, setShowNotes] = useState(false);
    const [notes, setNotes] = useState(supplier.notes || '');
    const [isUpdating, setIsUpdating] = useState(false);
    const statusMeta = STATUS_META[supplier.status];

    const handleStatusChange = async (status: SupplierStatus) => {
        setIsUpdating(true);
        await onUpdate(supplier, status, notes || undefined);
        setShowNotes(false);
        setIsUpdating(false);
    };

    return (
        <>
            <tr className="hover:bg-zinc-50">
                <td className="whitespace-nowrap px-3 py-3 font-medium text-zinc-900">{supplier.supplier_id}</td>
                <td className="px-3 py-3 text-zinc-700">{supplier.description}</td>
                <td className="px-3 py-3 text-zinc-600">
                    {supplier.email ? (
                        <a href={`mailto:${supplier.email}`} className="text-indigo-600 hover:underline">
                            {supplier.email}
                        </a>
                    ) : (
                        <span className="text-zinc-400">-</span>
                    )}
                </td>
                <td className="px-3 py-3">
                    {(() => {
                        const meta = cbaStatusMeta(supplier.need_cba_bank_account);
                        return (
                            <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                                {meta.label}
                            </span>
                        );
                    })()}
                </td>
                <td className="px-3 py-3">
                    <span
                        className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${statusMeta.badge}`}
                    >
                        <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                        {statusMeta.label}
                    </span>
                </td>
                {canManage && (
                    <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                            {supplier.status !== 'enabled' && (
                                <button
                                    onClick={() => handleStatusChange('enabled')}
                                    disabled={isUpdating}
                                    className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Enable
                                </button>
                            )}
                            {supplier.status !== 'blocked' && (
                                <button
                                    onClick={() => handleStatusChange('blocked')}
                                    disabled={isUpdating}
                                    className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Block
                                </button>
                            )}
                            {supplier.status !== 'removed' && (
                                <button
                                    onClick={() => setShowNotes(true)}
                                    disabled={isUpdating}
                                    className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </td>
                )}
            </tr>

            {showNotes && (
                <tr>
                    <td colSpan={canManage ? 6 : 5} className="bg-zinc-50 px-3 py-3">
                        <div className="rounded-lg border border-zinc-200 bg-white p-3">
                            <label htmlFor={`supplier-notes-${supplier.id}`} className="block text-xs font-medium text-zinc-700">
                                Reason / notes before removing
                            </label>
                            <textarea
                                id={`supplier-notes-${supplier.id}`}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="e.g. Supplier now has a valid CBA account"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                                <button
                                    onClick={() => setShowNotes(false)}
                                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleStatusChange('removed')}
                                    disabled={isUpdating}
                                    className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Confirm Remove
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
