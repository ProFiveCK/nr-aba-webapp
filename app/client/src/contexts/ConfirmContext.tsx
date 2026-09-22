import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    ConfirmContext,
    type ConfirmOptions,
    type PromptOptions,
} from './confirm-context';

type PendingRequest =
    | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
    | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

/**
 * Replaces window.confirm/prompt with an in-app modal matching the portal's
 * look, so decisions never depend on the browser's own (unstyled, blocking)
 * dialog chrome. One dialog at a time is enough for this app.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingRequest | null>(null);
    const [inputValue, setInputValue] = useState('');

    const confirm = useCallback((options: ConfirmOptions | string) => {
        const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
        return new Promise<boolean>((resolve) => {
            setPending({ kind: 'confirm', options: opts, resolve });
        });
    }, []);

    const prompt = useCallback((options: PromptOptions | string) => {
        const opts: PromptOptions = typeof options === 'string' ? { message: options } : options;
        setInputValue(opts.defaultValue || '');
        return new Promise<string | null>((resolve) => {
            setPending({ kind: 'prompt', options: opts, resolve });
        });
    }, []);

    const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

    const close = (result: boolean | string | null) => {
        setPending((current) => {
            if (!current) return null;
            if (current.kind === 'confirm') current.resolve(result as boolean);
            else current.resolve(result as string | null);
            return null;
        });
    };

    const isPrompt = pending?.kind === 'prompt';
    const requiredPrompt = isPrompt && pending.options.required !== false;
    const confirmDisabled = requiredPrompt && !inputValue.trim();

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            {pending && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 px-4 py-6"
                    onClick={() => close(pending.kind === 'confirm' ? false : null)}
                >
                    <div
                        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                    >
                        {pending.options.title && (
                            <h2 className="text-lg font-semibold text-[#002B7F]">{pending.options.title}</h2>
                        )}
                        {pending.options.message && (
                            <p className={`text-sm text-gray-600 ${pending.options.title ? 'mt-1.5' : ''}`}>
                                {pending.options.message}
                            </p>
                        )}

                        {isPrompt && (
                            <input
                                autoFocus
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                placeholder={pending.options.placeholder}
                                className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-[#002B7F]/20"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !confirmDisabled) close(inputValue.trim());
                                }}
                            />
                        )}

                        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => close(pending.kind === 'confirm' ? false : null)}
                                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                {pending.options.cancelLabel || 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={() => close(pending.kind === 'confirm' ? true : inputValue.trim())}
                                disabled={confirmDisabled}
                                className={`rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                    pending.kind === 'confirm' && pending.options.tone === 'danger'
                                        ? 'bg-rose-600 hover:bg-rose-500'
                                        : 'bg-[#E8842C] hover:bg-[#d4761f]'
                                }`}
                            >
                                {pending.options.confirmLabel || (pending.kind === 'confirm' ? 'Confirm' : 'OK')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}
