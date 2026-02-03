/**
 * API Client
 * Unified API request handler with authentication and error handling
 */

import { API_BASE } from '../constants.js';
import { appState } from '../state/app-state.js';

class ApiClient {
  constructor(baseURL = API_BASE) {
    this.baseURL = baseURL;
  }

  /**
   * Get authentication token from app state
   */
  getAuthToken() {
    return appState.getAuthToken();
  }

  /**
   * Set authentication token (for backward compatibility)
   */
  setAuthToken(token) {
    // Token is managed by appState, but we keep this for compatibility
    // The actual token is retrieved from appState in request()
  }

  /**
   * Clear authentication token (for backward compatibility)
   */
  clearAuthToken() {
    // Token is managed by appState
    appState.clearAuthState();
  }

  /**
   * Make an API request
   * @param {string} path - API endpoint path
   * @param {Object} options - Fetch options
   * @param {boolean} skipAuth - Skip adding auth header
   * @returns {Promise<any>} Response data
   */
  async request(path, options = {}, skipAuth = false) {
    const headers = { ...(options.headers || {}) };

    // Set Content-Type for JSON requests
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    // Add authentication token from appState
    const token = this.getAuthToken();
    if (token && !skipAuth) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response;
    const url = `${this.baseURL}${path}`;
    console.log(`API request: ${options.method || 'GET'} ${url}`, { headers: Object.keys(headers), hasToken: !!token });
    try {
      response = await fetch(url, {
        ...options,
        headers
      });
      console.log(`API response: ${response.status} ${response.statusText} for ${url}`);
    } catch (err) {
      console.error(`API request failed for ${url}:`, err);
      throw new Error(err?.message || 'Network request failed');
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    // Parse response
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
      }
    }

    // Handle 401 Unauthorized (session expired)
      if (response.status === 401) {
        console.warn('Unauthorized request, clearing auth state');
        appState.clearAuthState();
        if (typeof window.handleAuthExpired === 'function') {
          window.handleAuthExpired();
        }
      }    // Handle error responses
    if (!response.ok) {
      const apiError = new Error(
        parsed?.message || 
        parsed?.error || 
        text || 
        response.statusText || 
        'API request failed'
      );
      apiError.status = response.status;
      if (parsed && typeof parsed === 'object') {
        apiError.details = parsed;
      }
      throw apiError;
    }

    return parsed ?? null;
  }

  /**
   * GET request
   */
  async get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'POST',
      body: typeof body === 'object' ? JSON.stringify(body) : body
    });
  }

  /**
   * PUT request
   */
  async put(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'PUT',
      body: typeof body === 'object' ? JSON.stringify(body) : body
    });
  }

  /**
   * PATCH request
   */
  async patch(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'PATCH',
      body: typeof body === 'object' ? JSON.stringify(body) : body
    });
  }

  /**
   * DELETE request
   */
  async delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}

// Create singleton instance
export const apiClient = new ApiClient();

// Export class for custom instances if needed
export default ApiClient;

