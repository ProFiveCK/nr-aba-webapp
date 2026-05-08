import type { ReactNode, SVGProps } from 'react';

type IconName =
    | 'alert'
    | 'check'
    | 'chevronLeft'
    | 'chevronRight'
    | 'download'
    | 'eye'
    | 'external'
    | 'refresh'
    | 'search'
    | 'trash'
    | 'x';

interface IconProps extends SVGProps<SVGSVGElement> {
    name: IconName;
}

const iconPaths: Record<IconName, ReactNode> = {
    alert: (
        <>
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
        </>
    ),
    check: (
        <>
            <path d="M20 6 9 17l-5-5" />
        </>
    ),
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    download: (
        <>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
        </>
    ),
    eye: (
        <>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
        </>
    ),
    external: (
        <>
            <path d="M14 3h7v7" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
        </>
    ),
    refresh: (
        <>
            <path d="M21 12a9 9 0 0 1-15.1 6.6" />
            <path d="M3 12A9 9 0 0 1 18.1 5.4" />
            <path d="M18 2v4h-4" />
            <path d="M6 22v-4h4" />
        </>
    ),
    search: (
        <>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </>
    ),
    trash: (
        <>
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m19 6-1 14H6L5 6" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
        </>
    ),
    x: (
        <>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </>
    ),
};

export function Icon({ name, className = 'h-4 w-4', ...props }: IconProps) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            {iconPaths[name]}
        </svg>
    );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="state-surface">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-600" />
            <span>{label}</span>
        </div>
    );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="state-surface">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                <Icon name="search" />
            </div>
            <div>
                <p className="font-medium text-zinc-700">{title}</p>
                {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
            </div>
        </div>
    );
}
