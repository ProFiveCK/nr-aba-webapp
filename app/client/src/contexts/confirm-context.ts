import { createContext } from 'react';

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'default' | 'danger';
}

export interface PromptOptions {
    title?: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Confirm stays disabled until the field is non-empty. Defaults to true. */
    required?: boolean;
}

export interface ConfirmContextValue {
    confirm: (options: ConfirmOptions | string) => Promise<boolean>;
    prompt: (options: PromptOptions | string) => Promise<string | null>;
}

export const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);
