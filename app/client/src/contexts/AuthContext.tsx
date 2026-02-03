import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../lib/api';

export interface User {
    id: number;
    email: string;
    display_name: string;
    role: 'user' | 'banking' | 'reviewer' | 'admin';
    department_code?: string;
    notify_on_submission?: boolean;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
    replaceSession: (token: string, reviewer: User) => void;
    isAuthenticated: boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load saved session on mount
    useEffect(() => {
        const savedToken = localStorage.getItem('auth_token');
        const savedUser = localStorage.getItem('auth_user');

        if (savedToken && savedUser) {
            try {
                const parsedUser = JSON.parse(savedUser);
                setToken(savedToken);
                setUser(parsedUser);
                apiClient.setAuthToken(savedToken);
            } catch (error) {
                console.error('Failed to parse saved user data:', error);
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
            }
        }
        setIsLoading(false);
    }, []);

    const saveSession = (tokenValue: string, reviewer: User) => {
        setToken(tokenValue);
        setUser(reviewer);
        apiClient.setAuthToken(tokenValue);
        localStorage.setItem('auth_token', tokenValue);
        localStorage.setItem('auth_user', JSON.stringify(reviewer));
    };

    const login = async (email: string, password: string) => {
        try {
            // Backend returns { token, expires_at, reviewer }
            const response = await apiClient.post<{ token: string; reviewer: User }>('/auth/login', {
                email,
                password,
            });

            if (!response.token || !response.reviewer) {
                throw new Error('Invalid login response');
            }

            saveSession(response.token, response.reviewer);
        } catch (error) {
            // Re-throw to let the login form handle the error
            throw error;
        }
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

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
