import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const idRef = useRef(0);

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const addToast = useCallback(
        (message: string, type: ToastType = 'info') => {
            const id = ++idRef.current;
            setToasts((prev) => [...prev, { id, message, type }]);
            window.setTimeout(() => removeToast(id), 5000);
        },
        [removeToast]
    );

    const value = useMemo(() => ({ addToast }), [addToast]);

    const typeStyles: Record<ToastType, string> = {
        info: 'border-gray-200 bg-white text-gray-800',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        error: 'border-rose-200 bg-rose-50 text-rose-900',
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-3">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-lg ${typeStyles[toast.type]}`}
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-start gap-3">
                            <p className="text-sm font-medium leading-snug">{toast.message}</p>
                            <button
                                type="button"
                                onClick={() => removeToast(toast.id)}
                                className="text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800"
                                aria-label="Dismiss notification"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

