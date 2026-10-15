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

    return <span className="relative block min-w-0 w-full rounded-lg focus-within:ring-2 focus-within:ring-brand/30">
        <input {...props} ref={visible} type="text" value={text} disabled={disabled}
            readOnly={readOnly} required={required} placeholder="DD/MM/YYYY" inputMode="numeric"
            className={`${className ?? ''} pr-10`} maxLength={10}
            onChange={event => change(event, event.target.value)}
            onBlur={event => {
                if (iso) setDraft({ iso, text: formatDate(iso) });
                onBlur?.(event);
            }} />
        <input ref={stored} name={name} type="hidden" value={iso} disabled={disabled} />
        <span className="pointer-events-none absolute inset-y-0 right-1 flex w-10 items-center justify-center rounded text-gray-600" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
        </span>
        <input type="date" lang="en-AU" aria-label={`Choose date${name ? ` for ${name.replace(/_/g, ' ')}` : ''}`}
            className="absolute inset-y-0 right-0 w-11 cursor-pointer opacity-0"
            value={iso} min={min} max={max} disabled={disabled || readOnly}
            onClick={event => { try { event.currentTarget.showPicker?.(); } catch { /* The native date control remains available. */ } }}
            onChange={event => change(event, event.target.value ? formatDate(event.target.value) : '')} />
    </span>;
}
