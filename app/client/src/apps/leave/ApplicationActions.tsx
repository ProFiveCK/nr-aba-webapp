import { useId, useRef, useState } from 'react';
import { Button } from '../../components/Ui';
export type ApplicationAction = { label: string; onSelect: () => void | Promise<void>; disabled?: boolean };

export function ApplicationActions({ actions, disabled = false, onError }: { actions: ApplicationAction[]; disabled?: boolean; onError?: (error: Error) => void }) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(''), [error, setError] = useState('');
    const running = useRef(false);
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    if (!actions.length) return null;
    return <div className="space-y-2" onKeyDown={event => { if (open && event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.stopPropagation(); } }}>
        <Button variant="secondary" loading={!!pending} disabled={disabled} aria-expanded={open && !disabled} aria-controls={id} onClick={event => { trigger.current = event.currentTarget; setOpen(!open); }}>{pending ? 'Preparing download…' : 'Application actions'}</Button>
        {open && !disabled && <div id={id} role="group" aria-label="Application actions" className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3">{actions.map(action => <Button key={action.label} variant="secondary" loading={pending === action.label} disabled={action.disabled || !!pending} onClick={async () => {
            if (running.current) return;
            running.current = true; setError(''); setOpen(false); trigger.current?.focus();
            try {
                const result = action.onSelect();
                if (result) { setPending(action.label); await result; }
            } catch (err) {
                setOpen(true);
                const failure = err instanceof Error ? err : new Error('Unable to complete this action.');
                if (onError) onError(failure); else setError(failure.message);
            } finally { running.current = false; setPending(''); }
        }}>{pending === action.label ? 'Preparing download…' : action.label}</Button>)}</div>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>;
}
