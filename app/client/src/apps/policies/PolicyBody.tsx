import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { headingAnchors, portalLinkTarget } from './policyContent';

export interface PolicySection {
    id: string;
    text: string;
    level: 2 | 3;
}

/**
 * A policy's text. The server cleaned it before storing it (see the backend's
 * lib/policyHtml.js), so it is shown as it is. Each main heading gets a
 * section address for the contents list and for links straight to a section.
 */
export function PolicyBody({ html, onSections }: { html: string; onSections?: (sections: PolicySection[]) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const { hash } = useLocation();

    useLayoutEffect(() => {
        const headings = Array.from(ref.current?.querySelectorAll<HTMLHeadingElement>('h2, h3') ?? []);
        const ids = headingAnchors(headings.map((heading) => heading.textContent ?? ''));
        headings.forEach((heading, i) => { heading.id = ids[i]; });
        onSections?.(headings.map((heading, i) => ({ id: ids[i], text: heading.textContent ?? '', level: heading.tagName === 'H2' ? 2 : 3 })));
    }, [html, onSections]);

    useEffect(() => {
        if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    }, [html, hash]);

    // A link to another page of the portal opens in place, like any other link in it.
    const followPortalLink = (event: MouseEvent<HTMLDivElement>) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const target = portalLinkTarget(anchor?.getAttribute('href') ?? null);
        if (!target || anchor?.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(target);
    };

    return <div ref={ref} className="policy-content" onClick={followPortalLink} dangerouslySetInnerHTML={{ __html: html }} />;
}
