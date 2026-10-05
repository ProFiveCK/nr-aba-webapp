import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode, SVGProps } from 'react';

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
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-amber-500" />
            <span>{label}</span>
        </div>
    );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="state-surface">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <Icon name="search" />
            </div>
            <div>
                <p className="font-medium text-gray-700">{title}</p>
                {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
            </div>
        </div>
    );
}

/**
 * The standard surface everything sits on. `.app-panel` already carried these
 * styles in index.css but the pages hand-typed them instead, so the border and
 * shadow had 27 separate definitions to keep in step.
 *
 * `padded` is the common case; pass false when the content manages its own
 * padding, such as a table that needs its header flush to the edge.
 */
export function Card({
    children, padded = true, className = '',
}: { children: ReactNode; padded?: boolean; className?: string }) {
    return (
        <div className={`app-panel ${padded ? 'p-4' : ''} ${className}`.trim()}>
            {children}
        </div>
    );
}

/** A card's title row, with optional supporting text and controls on the right. */
export function CardHeading({
    title, subtitle, children,
}: { title: string; subtitle?: string; children?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
            </div>
            {children}
        </div>
    );
}

/**
 * A single headline figure.
 *
 * `emphasis` marks the one number a screen is really about, so a dashboard can
 * have a subject rather than a row of equally loud tiles.
 */
export function StatTile({
    label, value, hint, emphasis = false,
}: { label: string; value: string; hint?: string; emphasis?: boolean }) {
    return (
        <div className={`app-panel p-4 ${emphasis ? 'border-brand/25 bg-brand/[0.03]' : ''}`.trim()}>
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 font-semibold tabular-nums ${emphasis ? 'text-4xl text-brand' : 'text-2xl text-gray-900'}`}>
                {value}
            </p>
            {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
        </div>
    );
}

const buttonVariants = {
    primary: 'border-brand bg-brand text-white shadow-sm hover:bg-brand-hover',
    secondary: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    danger: 'border-rose-600 bg-rose-600 text-white shadow-sm hover:bg-rose-500',
    ghost: 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900',
};

/**
 * The portal's one button. `loading` disables it and shows a spinner, so a
 * double click cannot submit twice.
 */
export function Button({
    variant = 'primary', loading = false, disabled, className = '', type = 'button', children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants; loading?: boolean }) {
    return (
        <button
            {...props}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`.trim()}
        >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
            {children}
        </button>
    );
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const modalSizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' };

/**
 * An accessible dialog: labelled by its title, keeps Tab inside, closes on
 * Escape and backdrop click, and hands focus back to whatever opened it.
 * Render it conditionally (`{open && <Modal …/>}`); mounting is opening.
 *
 * `closeDisabled` blocks every way of closing (use while a request runs).
 * `placement="right"` turns it into a full-height side panel.
 */
export function Modal({
    title, description, onClose, children, size = 'md', placement = 'center',
    closeDisabled = false, closeOnBackdrop = true, closeLabel = 'Close dialog',
}: {
    title: ReactNode;
    description?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    size?: keyof typeof modalSizes;
    placement?: 'center' | 'right';
    closeDisabled?: boolean;
    closeOnBackdrop?: boolean;
    closeLabel?: string;
}) {
    const titleId = useId();
    const descriptionId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    // Read on the first render, before an autoFocus child moves focus inside.
    const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

    useEffect(() => {
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) panel.focus();
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
            opener?.focus();
        };
    }, [opener]);

    const requestClose = () => {
        if (!closeDisabled) onClose();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            requestClose();
            return;
        }
        if (event.key !== 'Tab' || !panelRef.current) return;
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panelRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const right = placement === 'right';
    return (
        <div className={`fixed inset-0 z-50 flex ${right ? 'justify-end' : 'items-center justify-center px-4 py-6'}`} onKeyDown={handleKeyDown}>
            <div className="absolute inset-0 bg-gray-900/60" aria-hidden="true" onClick={closeOnBackdrop ? requestClose : undefined} />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className={`relative flex w-full flex-col bg-white shadow-2xl focus:outline-none ${modalSizes[size]} ${right ? 'h-dvh' : 'max-h-full rounded-2xl'}`}
            >
                <div className={`flex shrink-0 items-start justify-between gap-4 px-6 pt-6 ${right ? 'border-b border-gray-200 pb-4' : ''}`}>
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-xl font-semibold text-gray-900">{title}</h2>
                        {description && <div id={descriptionId} className="mt-1 text-sm text-gray-500">{description}</div>}
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        disabled={closeDisabled}
                        aria-label={closeLabel}
                        className="-mr-2 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                    >
                        <Icon name="x" className="h-5 w-5" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
            </div>
        </div>
    );
}

/** Right-aligned action row for the bottom of a modal; stacks on phones. */
export function ModalActions({ children }: { children: ReactNode }) {
    return <div className="mt-6 flex flex-col-reverse first:mt-2 gap-2 sm:flex-row sm:justify-end">{children}</div>;
}
