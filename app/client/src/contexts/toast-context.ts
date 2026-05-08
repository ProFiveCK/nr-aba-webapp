import { createContext } from 'react';

export type ToastType = 'info' | 'success' | 'error';

export interface ToastContextValue {
    addToast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);
