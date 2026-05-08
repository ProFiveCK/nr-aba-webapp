import { useState } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../lib/api';
import { AuthContext } from './auth-context';
import type { User } from './auth-types';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [initialSession] = useState(() => loadSavedSession());
    const [user, setUser] = useState<User | null>(initialSession.user);
    const [token, setToken] = useState<string | null>(initialSession.token);
    const [isLoading] = useState(false);

    const saveSession = (tokenValue: string, reviewer: User) => {
        setToken(tokenValue);
        setUser(reviewer);
        apiClient.setAuthToken(tokenValue);
        localStorage.setItem('auth_token', tokenValue);
        localStorage.setItem('auth_user', JSON.stringify(reviewer));
    };

    const login = async (email: string, password: string) => {
        // Backend returns { token, expires_at, reviewer }
        const response = await apiClient.post<{ token: string; reviewer: User }>('/auth/login', {
            email,
            password,
        });

        if (!response.token || !response.reviewer) {
            throw new Error('Invalid login response');
        }

        saveSession(response.token, response.reviewer);
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        apiClient.clearAuthToken();
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        // Clear any other app data
        localStorage.removeItem('aba-header');
        localStorage.removeItem('aba-transactions');
        localStorage.removeItem('user_name');
    };

    const updateUser = (updates: Partial<User>) => {
        setUser((prev) => {
            if (!prev) return prev;
            const nextUser = { ...prev, ...updates };
            localStorage.setItem('auth_user', JSON.stringify(nextUser));
            return nextUser;
        });
    };

    const replaceSession = (tokenValue: string, reviewer: User) => {
        saveSession(tokenValue, reviewer);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                login,
                logout,
                updateUser,
                replaceSession,
                isAuthenticated: !!token && !!user,
                isLoading,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

function loadSavedSession(): { token: string | null; user: User | null } {
    const savedToken = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');

    if (!savedToken || !savedUser) {
        return { token: null, user: null };
    }

    try {
        const parsedUser = JSON.parse(savedUser) as User;
        apiClient.setAuthToken(savedToken);
        return { token: savedToken, user: parsedUser };
    } catch (error) {
        console.error('Failed to parse saved user data:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        return { token: null, user: null };
    }
}
