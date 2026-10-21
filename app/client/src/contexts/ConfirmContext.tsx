import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Modal, ModalActions } from '../components/Ui';
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
    const active = useRef<PendingRequest | null>(null);

    useEffect(() => () => {
        const request = active.current;
        active.current = null;
        if (request?.kind === 'confirm') request.resolve(false);
        else request?.resolve(null);
    }, []);

    const confirm = useCallback((options: ConfirmOptions | string) => {
        const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
        // A second click must never replace a promise that another action is awaiting.
        if (active.current) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            active.current = { kind: 'confirm', options: opts, resolve };
            setPending(active.current);
        });
    }, []);

    const prompt = useCallback((options: PromptOptions | string) => {
        const opts: PromptOptions = typeof options === 'string' ? { message: options } : options;
        if (active.current) return Promise.resolve(null);
        setInputValue(opts.defaultValue || '');
        return new Promise<string | null>((resolve) => {
            active.current = { kind: 'prompt', options: opts, resolve };
            setPending(active.current);
        });
    }, []);

    const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

    const close = (result: boolean | string | null) => {
        const current = active.current;
        active.current = null;
        setPending(null);
        if (current?.kind === 'confirm') current.resolve(result as boolean);
        else current?.resolve(result as string | null);
    };

    const isPrompt = pending?.kind === 'prompt';
    const requiredPrompt = isPrompt && pending.options.required !== false;
    const confirmDisabled = requiredPrompt && !inputValue.trim();

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            {pending && (
                <Modal
                    title={pending.options.title || (isPrompt ? 'Enter a value' : 'Please confirm')}
                    description={pending.options.message}
                    onClose={() => close(pending.kind === 'confirm' ? false : null)}
                >
                    {isPrompt && (
                        <input
                            autoFocus
                            type="text"
                            aria-label={pending.options.title || pending.options.message || 'Value'}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={pending.options.placeholder}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !confirmDisabled) close(inputValue.trim());
                            }}
                        />
                    )}

                    <ModalActions>
                        <Button variant="secondary" onClick={() => close(pending.kind === 'confirm' ? false : null)}>
                            {pending.options.cancelLabel || 'Cancel'}
                        </Button>
                        <Button
                            variant={pending.kind === 'confirm' && pending.options.tone === 'danger' ? 'danger' : 'primary'}
                            onClick={() => close(pending.kind === 'confirm' ? true : inputValue.trim())}
                            disabled={confirmDisabled}
                        >
                            {pending.options.confirmLabel || (pending.kind === 'confirm' ? 'Confirm' : 'OK')}
                        </Button>
                    </ModalActions>
                </Modal>
            )}
        </ConfirmContext.Provider>
    );
}
