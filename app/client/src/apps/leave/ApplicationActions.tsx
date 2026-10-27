import { useRef, useState } from 'react';
import { Button } from '../../components/Ui';
export type ApplicationAction = { label: string; onSelect: () => void | Promise<void>; disabled?: boolean };

/** The few actions an application allows, shown as plain buttons. */
export function ApplicationActions({ actions, disabled = false, onError }: { actions: ApplicationAction[]; disabled?: boolean; onError?: (error: Error) => void }) {
    const [pending, setPending] = useState(''), [error, setError] = useState('');
    const running = useRef(false);
    if (!actions.length) return null;
    return <div className="space-y-2">
        <div className="flex flex-wrap gap-2">{actions.map(action => <Button key={action.label} variant="secondary" loading={pending === action.label} disabled={disabled || action.disabled || !!pending} onClick={async () => {
            if (running.current) return;
            running.current = true; setError('');
            try {
                const result = action.onSelect();
                if (result) { setPending(action.label); await result; }
            } catch (err) {
                const failure = err instanceof Error ? err : new Error('Unable to complete this action.');
                if (onError) onError(failure); else setError(failure.message);
            } finally { running.current = false; setPending(''); }
        }}>{pending === action.label ? 'Preparing download…' : action.label}</Button>)}</div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>;
}
