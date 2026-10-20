import { useId, useRef, useState } from 'react';
import { Button } from '../../components/Ui';
export type ApplicationAction = { label: string; onSelect: () => void; disabled?: boolean };

export function ApplicationActions({ actions, disabled = false }: { actions: ApplicationAction[]; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    if (!actions.length) return null;
    return <div className="space-y-2" onKeyDown={event => { if (open && event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.stopPropagation(); } }}>
        <Button variant="secondary" disabled={disabled} aria-expanded={open && !disabled} aria-controls={id} onClick={event => { trigger.current = event.currentTarget; setOpen(!open); }}>Application actions</Button>
        {open && !disabled && <div id={id} role="group" aria-label="Application actions" className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3">{actions.map(action => <Button key={action.label} variant="secondary" disabled={action.disabled} onClick={() => { setOpen(false); trigger.current?.focus(); action.onSelect(); }}>{action.label}</Button>)}</div>}
    </div>;
}
