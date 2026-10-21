/**
 * API Client
 * Typed wrapper for backend API communication
 */

import { API_BASE } from './constants';

interface ApiError extends Error {
    status?: number;
    details?: unknown;
}

interface ApiErrorPayload {
    message?: string;
    error?: string;
}

export interface ApiRequestOptions extends RequestInit {
    suppressAuthExpired?: boolean;
    /** Deadline includes downloading the response body. Uploads default to two minutes. */
    timeoutMs?: number;
}

declare global {
    interface Window {
        handleAuthExpired?: () => void;
    }
}

function asErrorPayload(value: unknown): ApiErrorPayload {
    return value && typeof value === 'object' ? (value as ApiErrorPayload) : {};
}

class ApiClient {
    private baseURL: string;
    private authToken: string | null = null;

    constructor(baseURL = API_BASE) {
        this.baseURL = baseURL;
    }

    /**
     * Set authentication token
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Get authentication token
     */
    getAuthToken(): string | null {
        return this.authToken;
    }

    /**
     * Clear authentication token
     */
    clearAuthToken(): void {
        this.authToken = null;
    }

    /** Always settle a request, including stalled bodies, and release caller loading states. */
    private async withDeadline<T>(options: ApiRequestOptions, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? 30_000;
        const readOnly = !options.method || options.method === 'GET' || options.method === 'HEAD';
        const timeout = new Error(readOnly
            ? 'The server took too long to respond. Please try again.'
            : 'The server took too long to confirm this action. Check the latest record before trying again; the change may have been saved.');
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: () => void = () => {};
        const interrupted = new Promise<never>((_, reject) => {
            abort = () => {
                const reason = options.signal?.reason ?? new DOMException('Request cancelled', 'AbortError');
                reject(reason);
                controller.abort(reason);
            };
            if (options.signal?.aborted) abort();
            else options.signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => {
                reject(timeout);
                controller.abort(timeout);
            }, timeoutMs);
        });
        try {
            return await Promise.race([
                interrupted,
                controller.signal.aborted ? Promise.reject(controller.signal.reason) : work(controller.signal),
            ]);
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
        }
    }

    /**
     * Make an API request
     */
    private async request<T = unknown>(
        path: string,
        options: ApiRequestOptions = {},
        skipAuth = false
    ): Promise<T> {
        const { suppressAuthExpired = false, timeoutMs = 30_000, ...fetchOptions } = options;
        const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };

        // Set Content-Type for JSON requests
        if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }

        // Add authentication token (cookie-based auth uses credentials: 'include' below).
        // The Authorization header is kept as a fallback for backward compatibility.
        if (this.authToken && !skipAuth) {
            headers.Authorization = `Bearer ${this.authToken}`;
        }

        const url = `${this.baseURL}${path}`;
        return this.withDeadline({ ...options, timeoutMs }, async signal => {
            let response: Response;

            try {
                response = await fetch(url, {
                    ...fetchOptions,
                    headers,
                    credentials: 'include',
                    signal,
                });
            } catch (err) {
                const error = new Error((err as Error)?.message || 'Network request failed') as ApiError;
                throw error;
            }

            // Handle 204 No Content
            if (response.status === 204) {
                return null as T;
            }

            // Parse response
            const text = await response.text();
            let parsed: unknown = null;
            if (text) {
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = null;
                }
            }

            // Handle 401 Unauthorized (session expired)
            if (response.status === 401) {
                if (!suppressAuthExpired) {
                    this.clearAuthToken();
                    // Trigger auth expiration handler.
                    if (typeof window !== 'undefined' && window.handleAuthExpired) {
                        window.handleAuthExpired();
                    }
                }
            }

            // Handle error responses
            if (!response.ok) {
                const errorPayload = asErrorPayload(parsed);
                const apiError = new Error(
                    errorPayload.message ||
                    errorPayload.error ||
                    text ||
                    response.statusText ||
                    'API request failed'
                ) as ApiError;
                apiError.status = response.status;
                if (parsed && typeof parsed === 'object') {
                    apiError.details = parsed;
                }
                throw apiError;
            }

            return (parsed ?? null) as T;
        });
    }

    /**
     * GET request
     */
    async get<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, { ...options, method: 'GET' });
    }

    /** GET a binary response while preserving the session and API error handling. */
    async getBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
        return this.withDeadline({ ...options, method: 'GET' }, async signal => {
            const headers: Record<string, string> = {};
            if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
            const response = await fetch(`${this.baseURL}${path}`, { method: 'GET', headers, credentials: 'include', signal });
            if (response.status === 401 && !options.suppressAuthExpired) {
                this.clearAuthToken();
                if (typeof window !== 'undefined') window.handleAuthExpired?.();
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
                throw new Error(payload?.message || payload?.error || response.statusText || 'Unable to download file');
            }
            return response.blob();
        });
    }

    /**
     * POST request
     */
    async post<T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'POST',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * Multipart POST request (for file uploads)
     */
    async upload<T = unknown>(path: string, formData: FormData, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, {
            timeoutMs: 120_000,
            ...options,
            method: 'POST',
            body: formData,
        });
    }

    /**
     * PUT request
     */
    async put<T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'PUT',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * PATCH request
     */
    async patch<T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'PATCH',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * DELETE request
     */
    async delete<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
        return this.request<T>(path, { ...options, method: 'DELETE' });
    }
}

// Create singleton instance
export const apiClient = new ApiClient();

// Export class for custom instances if needed
export default ApiClient;
