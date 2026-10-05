import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { SortDirection, SortState } from './tableSort';

/**
 * A sortable column heading.
 *
 * The caller supplies the `<th>`'s own classes, since each table's header is
 * styled (and stuck) differently; this owns the button, the arrow and the
 * `aria-sort` that tells a screen reader how the table is currently ordered.
 */
export function SortHeader<K extends string>({
    label, sortKey, sort, onSort, defaultDirection = 'desc', align = 'left', className = '',
}: {
    label: string;
    sortKey: K;
    sort: SortState<K>;
    onSort: (key: K, defaultDirection?: SortDirection) => void;
    defaultDirection?: SortDirection;
    align?: 'left' | 'right';
    className?: string;
}) {
    const active = sort.key === sortKey;
    const Arrow = !active ? ChevronsUpDown : sort.direction === 'asc' ? ChevronUp : ChevronDown;
    return (
        <th
            scope="col"
            aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={className}
        >
            <button
                type="button"
                onClick={() => onSort(sortKey, defaultDirection)}
                className={`group inline-flex w-full items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
                title={`Sort by ${label}`}
            >
                <span>{label}</span>
                <Arrow
                    size={13}
                    aria-hidden="true"
                    className={active ? 'shrink-0 text-[#002B7F]' : 'shrink-0 text-zinc-300 group-hover:text-zinc-500'}
                />
            </button>
        </th>
    );
}
