/**
 * API Client
 * Typed wrapper for backend API communication
 */

import { API_BASE } from './constants';

interface ApiError extends Error {
    status?: number;
    details?: unknown;
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

    /**
     * Make an API request
     */
    private async request<T = unknown>(
        path: string,
        options: RequestInit = {},
        skipAuth = false
    ): Promise<T> {
        const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };

        // Set Content-Type for JSON requests
        if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }

        // Add authentication token
        if (this.authToken && !skipAuth) {
            headers.Authorization = `Bearer ${this.authToken}`;
        }

        const url = `${this.baseURL}${path}`;
        let response: Response;

        try {
            response = await fetch(url, {
                ...options,
                headers,
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
            this.clearAuthToken();
            // Trigger auth expiration handler
            if (typeof window !== 'undefined' && (window as any).handleAuthExpired) {
                (window as any).handleAuthExpired();
            }
        }

        // Handle error responses
        if (!response.ok) {
            const apiError = new Error(
                (parsed as any)?.message ||
                (parsed as any)?.error ||
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
    }

    /**
     * GET request
     */
    async get<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
        return this.request<T>(path, { ...options, method: 'GET' });
    }

    /**
     * POST request
     */
    async post<T = unknown>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'POST',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * PUT request
     */
    async put<T = unknown>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'PUT',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * PATCH request
     */
    async patch<T = unknown>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'PATCH',
            body: typeof body === 'object' ? JSON.stringify(body) : (body as string),
        });
    }

    /**
     * DELETE request
     */
    async delete<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
        return this.request<T>(path, { ...options, method: 'DELETE' });
    }
}

// Create singleton instance
export const apiClient = new ApiClient();

// Export class for custom instances if needed
export default ApiClient;
