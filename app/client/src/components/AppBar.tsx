import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft, ChevronDown, LayoutGrid } from 'lucide-react';
import { pathForApp, type AppDef } from '../lib/apps';
import type { AppSection } from './appChrome';

/**
 * The bar directly under the portal header, while inside an app.
 *
 * It shows the app you are in, not every app there is. The portal used to
 * keep the full application list on screen at all times, so an app never felt
 * like a place you had entered — Leave in particular read as one tab in a row
 * of nine, with its own seven sections stacked underneath. Here the row
 * belongs to the current app: a way back to the dashboard, the app's name,
 * and a menu for people who do hop between apps all day.
 */
export function AppBar({ app, apps, sections }: { app: AppDef; apps: AppDef[]; sections: AppSection[] }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const Icon = app.icon;

    // A menu that stays open after you click away, or swallows Escape, is
    // worse than no menu.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const others = apps.filter((candidate) => candidate.id !== app.id);

    return (
        <div className="border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <Link
                        to="/"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-blue-50 hover:text-brand"
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        <span className="max-[400px]:sr-only">Dashboard</span>
                    </Link>
                    <span aria-hidden="true" className="h-5 w-px shrink-0 bg-gray-200" />
                    <span className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white ${app.color}`}>
                            <Icon size={16} strokeWidth={2.1} aria-hidden="true" />
                        </span>
                        <span className="truncate text-sm font-semibold text-gray-900">{app.label}</span>
                    </span>
                </div>

                {others.length > 0 && (
                    <div ref={menuRef} className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setOpen((value) => !value)}
                            aria-expanded={open}
                            aria-haspopup="menu"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-blue-50 hover:text-brand"
                        >
                            <LayoutGrid size={15} aria-hidden="true" />
                            <span className="max-sm:sr-only">Switch app</span>
                            <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        {open && (
                            <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                                {others.map((other) => {
                                    const OtherIcon = other.icon;
                                    return (
                                        <NavLink
                                            key={other.id}
                                            to={pathForApp(other)}
                                            role="menuitem"
                                            onClick={() => setOpen(false)}
                                            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-brand"
                                        >
                                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-white ${other.color}`}>
                                                <OtherIcon size={14} strokeWidth={2.1} aria-hidden="true" />
                                            </span>
                                            {other.label}
                                        </NavLink>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* The app's own menu, promoted into the sticky bar so it stays
                put while the page scrolls. */}
            {sections.length > 0 && (
                <nav aria-label={`${app.label} sections`} className="mx-auto max-w-7xl">
                    <div className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {sections.map((section) => (
                            <NavLink
                                key={section.to}
                                to={section.to}
                                className={({ isActive }) => `shrink-0 whitespace-nowrap border-b-2 pb-2 pt-0.5 text-sm font-medium transition-colors ${
                                    isActive
                                        ? 'border-accent text-brand'
                                        : 'border-transparent text-gray-600 hover:text-brand'
                                }`}
                            >
                                {section.label}
                            </NavLink>
                        ))}
                    </div>
                </nav>
            )}
        </div>
    );
}
