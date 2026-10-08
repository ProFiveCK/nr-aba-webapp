import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { australianDateError, formatDate, parseAustralianDate, toDateInputValue } from '../lib/date';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & {
    value?: string;
    defaultValue?: string;
};

/** Display and type DD/MM/YYYY; forms and existing change handlers still receive ISO dates. */
export function AustralianDateInput({ value, defaultValue, name, className, onChange, onBlur,
    min, max, disabled, readOnly, required, ...props }: Props) {
    const initial = toDateInputValue(value ?? defaultValue);
    const [draft, setDraft] = useState({ iso: initial, text: initial ? formatDate(initial) : '' });
    const external = value === undefined ? draft.iso : toDateInputValue(value);
    // Update only when the owner changes the date; retain incomplete user entry otherwise.
    if (external !== draft.iso) setDraft({ iso: external, text: external ? formatDate(external) : '' });
    const text = external === draft.iso ? draft.text : external ? formatDate(external) : '';
    const iso = parseAustralianDate(text);
    const visible = useRef<HTMLInputElement>(null);
    const stored = useRef<HTMLInputElement>(null);
    const picker = useRef<HTMLInputElement>(null);
    const error = australianDateError(text, String(min ?? ''), String(max ?? ''));
    useLayoutEffect(() => { visible.current?.setCustomValidity(error); }, [error]);

    function change(event: ChangeEvent<HTMLInputElement>, nextText: string) {
        const nextIso = parseAustralianDate(nextText);
        setDraft({ iso: nextIso, text: nextText });
        if (stored.current) {
            stored.current.value = nextIso;
            onChange?.({ ...event, target: stored.current, currentTarget: stored.current });
        }
    }

    return <span className="relative block min-w-0 w-full">
        <input {...props} ref={visible} type="text" value={text} disabled={disabled}
            readOnly={readOnly} required={required} placeholder="DD/MM/YYYY" inputMode="numeric"
            className={`${className ?? ''} pr-10`} maxLength={10}
            onChange={event => change(event, event.target.value)}
            onBlur={event => {
                if (iso) setDraft({ iso, text: formatDate(iso) });
                onBlur?.(event);
            }} />
        <input ref={stored} name={name} type="hidden" value={iso} disabled={disabled} />
        <input ref={picker} type="date" lang="en-AU" tabIndex={-1} aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
            value={iso} min={min} max={max} disabled={disabled || readOnly}
            onChange={event => change(event, event.target.value ? formatDate(event.target.value) : '')} />
        <button type="button" disabled={disabled || readOnly}
            aria-label={`Choose date${name ? ` for ${name.replace(/_/g, ' ')}` : ''}`}
            className="absolute inset-y-0 right-1 my-1 rounded px-2 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
            onClick={() => {
                if (picker.current?.showPicker) picker.current.showPicker();
                else visible.current?.focus();
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
        </button>
    </span>;
}
