import { createContext, useContext, useEffect } from 'react';

export interface AppSection {
    /** Where the section lives, e.g. `/leave/staff`. */
    to: string;
    label: string;
}

interface AppChrome {
    sections: AppSection[];
    setSections: (sections: AppSection[]) => void;
}

export const AppChromeContext = createContext<AppChrome>({
    sections: [],
    setSections: () => {},
});

/**
 * Publishes an app's sections to the portal bar, which renders them as the
 * level-one menu for as long as that app is open.
 *
 * The sections belong to the app — only it knows which ones this account may
 * open — but they have to be drawn in the sticky bar at the top of the page
 * rather than inside the scrolling content, so that scrolling a long staff
 * list does not scroll the navigation away with it. Hence the handover.
 *
 * `useEffect` keyed on the section list, not its identity: an app rebuilding
 * the same array on every render must not loop.
 */
export function useAppSections(sections: AppSection[]): void {
    const { setSections } = useContext(AppChromeContext);
    const key = sections.map((section) => `${section.to}|${section.label}`).join(',');
    useEffect(() => {
        setSections(sections);
        return () => setSections([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, setSections]);
}

export function useAppChrome(): AppChrome {
    return useContext(AppChromeContext);
}
