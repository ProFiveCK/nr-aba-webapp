import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import './AppSectionNav.css';

interface Section<T extends string> {
  id: T;
  label: string;
  detail: string;
  icon: LucideIcon;
}

export function AppSectionNav<T extends string>({ label, sections, activeId, onChange }: {
  label: string;
  sections: Section<T>[];
  activeId: T | undefined;
  onChange: (id: T) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active) return;
    // Reveal the selected section horizontally without moving the page.
    list.scrollLeft = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
  }, [activeId]);

  return (
    <nav className="app-section-nav" aria-label={label}>
      <label className="app-section-picker">
        <span>Section</span>
        <select value={activeId ?? ''} onChange={(event) => {
          const section = sections.find((item) => item.id === event.target.value);
          if (section) onChange(section.id);
        }}>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
        </select>
      </label>
      <div ref={listRef} className="app-section-list">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={activeId === section.id ? 'page' : undefined}
            onClick={() => onChange(section.id)}
            className="app-section-item"
          >
            <section.icon size={19} strokeWidth={1.8} aria-hidden="true" />
            <span><strong>{section.label}</strong><small>{section.detail}</small></span>
          </button>
        ))}
      </div>
    </nav>
  );
}
