import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../lib/api';
import { AuthContext } from './auth-context';
import type { LoginResponse, User } from './auth-types';

const SESSION_STORAGE_KEY = 'auth_token';
const USER_STORAGE_KEY = 'auth_user';
const EXPIRES_STORAGE_KEY = 'auth_expires_at';

// Refresh when 75% of the session lifetime has elapsed (e.g. 8h session = refresh at 6h)
const SESSION_REFRESH_FRACTION = 0.75;
// Poll interval to check if we need to refresh or expire (every minute)
const SESSION_POLL_MS = 60_000;

function parseSession(raw: string | null): { token: string | null; user: User | null; expiresAt: string | null } {
    if (!raw) return { token: null, user: null, expiresAt: null };
    try {
        const parsed = JSON.parse(raw) as { token: string; user: User; expiresAt: string } | null;
        if (parsed && typeof parsed === 'object' && parsed.user && parsed.expiresAt) {
            // Token is no longer stored in localStorage — it's in an httpOnly cookie.
            // We keep user/expiry for session restoration UI only.
            return { token: parsed.token ?? null, user: parsed.user, expiresAt: parsed.expiresAt };
        }
    } catch {
        // Legacy: auth_token used to be stored as a bare JWT string.
    }
    return { token: null, user: null, expiresAt: null };
}

function isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() <= Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionVersionRef = useRef(0);

    const clearRefreshTimer = useCallback(() => {
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }
    }, []);

    const logout = useCallback(() => {
        clearRefreshTimer();
        // Best-effort server-side logout; cookie will be cleared by the backend.
        apiClient.post('/auth/logout', undefined, { suppressAuthExpired: true }).catch(() => undefined);
        setToken(null);
        setUser(null);
        setSessionExpiresAt(null);
        apiClient.clearAuthToken();
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(EXPIRES_STORAGE_KEY);
        localStorage.removeItem('aba-header');
        localStorage.removeItem('aba-transactions');
        localStorage.removeItem('user_name');
    }, [clearRefreshTimer]);

    const saveSession = useCallback((tokenValue: string, reviewer: User, expiresAt: string) => {
        sessionVersionRef.current += 1;
        setToken(tokenValue);
        setUser(reviewer);
        setSessionExpiresAt(expiresAt);
        apiClient.setAuthToken(tokenValue);
        // Only persist user profile + expiry to localStorage for session restoration UI.
        // The JWT token is NOT stored in localStorage — it lives in an httpOnly cookie set by the backend.
        const payload = { user: reviewer, expiresAt };
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(reviewer));
        localStorage.setItem(EXPIRES_STORAGE_KEY, expiresAt);
    }, []);

    const scheduleSessionMaintenance = useCallback(() => {
        clearRefreshTimer();
        const expiresAt = localStorage.getItem(EXPIRES_STORAGE_KEY);
        if (!expiresAt) return;

        const expiresMs = new Date(expiresAt).getTime();
        const totalMs = expiresMs - Date.now();
        if (totalMs <= 0) {
            logout();
            return;
        }

        const refreshAtMs = expiresMs - Math.floor(totalMs * (1 - SESSION_REFRESH_FRACTION));
        const delayMs = Math.max(0, refreshAtMs - Date.now());

        refreshTimerRef.current = setTimeout(() => {
            // Refresh session
            apiClient
                .post<LoginResponse>('/auth/refresh')
                .then((response) => {
                    if (response?.token && response?.reviewer && response?.expires_at) {
                        saveSession(response.token, response.reviewer, response.expires_at);
                    } else {
                        throw new Error('Invalid refresh response');
                    }
                })
                .catch(() => {
                    logout();
                });
        }, delayMs);
    }, [clearRefreshTimer, logout, saveSession]);

    const login = useCallback(async (email: string, password: string) => {
        const response = await apiClient.post<LoginResponse>('/auth/login', {
            email,
            password,
        });

        if (!response.token || !response.reviewer || !response.expires_at) {
            throw new Error('Invalid login response');
        }

        saveSession(response.token, response.reviewer, response.expires_at);
    }, [saveSession]);

    const updateUser = useCallback((updates: Partial<User>) => {
        setUser((prev) => {
            if (!prev) return prev;
            const nextUser = { ...prev, ...updates };
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
            // Also update the bundled session storage object so it stays consistent on reload.
            const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
            if (rawSession) {
                try {
                    const parsed = JSON.parse(rawSession) as { user: User; expiresAt: string };
                    parsed.user = nextUser;
                    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(parsed));
                } catch {
                    // ignore corrupt storage
                }
            }
            return nextUser;
        });
    }, []);

    const replaceSession = useCallback((tokenValue: string, reviewer: User) => {
        // When replaceSession is called (e.g. after change password) we don't always get an expiry.
        // Derive one from the JWT payload to keep the timer consistent.
        let expiresAt = sessionExpiresAt;
        try {
            const payload = JSON.parse(atob(tokenValue.split('.')[1])) as { exp?: number };
            if (payload.exp) {
                expiresAt = new Date(payload.exp * 1000).toISOString();
            }
        } catch {
            // ignore
        }
        if (!expiresAt) {
            expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
        }
        saveSession(tokenValue, reviewer, expiresAt);
    }, [saveSession, sessionExpiresAt]);

    // Load saved session on mount and start expiry/refresh timers.
    useEffect(() => {
        let cancelled = false;

        async function restoreSession() {
            const restoreSessionVersion = sessionVersionRef.current;
            // The JWT token lives in an httpOnly cookie set by the backend.
            // We call /api/auth/me to verify the cookie is still valid.
            // If it succeeds, the user is authenticated via the cookie.
            const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
            const { user: savedUser, expiresAt: savedExpiresAt } = rawSession
                ? parseSession(rawSession)
                : { user: null, expiresAt: null };

            if (savedUser && savedExpiresAt && !isExpired(savedExpiresAt)) {
                // Optimistically restore the UI from localStorage, then verify with the server.
                setUser(savedUser);
                setSessionExpiresAt(savedExpiresAt);
                scheduleSessionMaintenance();

                try {
                    const me = await apiClient.get<{ reviewer: User }>('/auth/me', { suppressAuthExpired: true });
                    if (cancelled) return;
                    if (sessionVersionRef.current !== restoreSessionVersion) return;
                    if (me?.reviewer) {
                        setUser(me.reviewer);
                    }
                } catch {
                    if (cancelled) return;
                    if (sessionVersionRef.current !== restoreSessionVersion) return;
                    // Cookie is invalid/expired — log out.
                    logout();
                    return;
                } finally {
                    if (!cancelled) setIsLoading(false);
                }
            } else {
                // No saved session in localStorage — check if the cookie is still valid.
                try {
                    const me = await apiClient.get<{ reviewer: User }>('/auth/me', { suppressAuthExpired: true });
                    if (cancelled) return;
                    if (sessionVersionRef.current !== restoreSessionVersion) return;
                    if (me?.reviewer) {
                        setUser(me.reviewer);
                        // We don't have expiresAt from /auth/me; derive from session_expires_at if present.
                        const expiresAt = (me.reviewer as User & { session_expires_at?: string }).session_expires_at
                            || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
                        setSessionExpiresAt(expiresAt);
                        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user: me.reviewer, expiresAt }));
                        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(me.reviewer));
                        localStorage.setItem(EXPIRES_STORAGE_KEY, expiresAt);
                        scheduleSessionMaintenance();
                    } else {
                        if (sessionVersionRef.current !== restoreSessionVersion) return;
                        logout();
                    }
                } catch {
                    if (cancelled) return;
                    if (sessionVersionRef.current !== restoreSessionVersion) return;
                    // No valid cookie — clean up any stale storage.
                    logout();
                } finally {
                    if (!cancelled) setIsLoading(false);
                }
            }
        }

        restoreSession();

        return () => {
            cancelled = true;
            clearRefreshTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-schedule maintenance whenever the session expiry changes.
    useEffect(() => {
        if (user && sessionExpiresAt) {
            scheduleSessionMaintenance();
        }
        return () => {
            clearRefreshTimer();
        };
    }, [user, sessionExpiresAt, scheduleSessionMaintenance, clearRefreshTimer]);

    // Poll for hard expiry in case the refresh timer misfires (tab backgrounded, clock changes, etc.)
    useEffect(() => {
        if (!user || !sessionExpiresAt) return;
        const interval = setInterval(() => {
            if (isExpired(sessionExpiresAt)) {
                logout();
            }
        }, SESSION_POLL_MS);
        return () => clearInterval(interval);
    }, [user, sessionExpiresAt, logout]);

    const requiresPasswordChange = useMemo(() => !!user?.must_change_password, [user]);

    const value = useMemo(
        () => ({
            user,
            token,
            login,
            logout,
            updateUser,
            replaceSession,
            // Token lives in httpOnly cookie; isAuthenticated is based on user presence.
            // The cookie is sent automatically with credentials: 'include'.
            isAuthenticated: !!user,
            isLoading,
            sessionExpiresAt,
            requiresPasswordChange,
        }),
        [user, token, login, logout, updateUser, replaceSession, isLoading, sessionExpiresAt, requiresPasswordChange]
    );

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
