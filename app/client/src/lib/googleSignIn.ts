const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
    credential?: string;
}

interface GoogleIdApi {
    initialize(config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
    }): void;
    renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    disableAutoSelect(): void;
}

declare global {
    interface Window {
        google?: { accounts?: { id?: GoogleIdApi } };
    }
}

let scriptPromise: Promise<GoogleIdApi> | null = null;

/**
 * Loads the Google Identity Services script once per page and resolves with
 * its `accounts.id` API. Rejects if the script cannot be reached — callers
 * should treat that as "Google sign-in unavailable" and keep password login.
 */
export function loadGoogleIdentity(): Promise<GoogleIdApi> {
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<GoogleIdApi>((resolve, reject) => {
        const existing = window.google?.accounts?.id;
        if (existing) {
            resolve(existing);
            return;
        }

        const script = document.createElement('script');
        script.src = GIS_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            const api = window.google?.accounts?.id;
            if (api) resolve(api);
            else reject(new Error('Google Identity Services loaded but unavailable.'));
        };
        script.onerror = () => reject(new Error('Could not reach Google Identity Services.'));
        document.head.appendChild(script);
    }).catch((err) => {
        // Allow a later retry rather than caching the failure forever.
        scriptPromise = null;
        throw err;
    });

    return scriptPromise;
}

export interface AuthConfig {
    google_enabled: boolean;
    google_client_id: string;
}
