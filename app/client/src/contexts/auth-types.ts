export interface User {
    id: number;
    email: string;
    display_name: string;
    role: 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health';
    department_code?: string;
    division_code?: string;
    notify_on_submission?: boolean;
    must_change_password?: boolean;
    allowed_bank_presets?: string[];
    permissions?: Record<string, boolean>;
}

export interface LoginResponse {
    token: string;
    expires_at: string;
    reviewer: User;
    permissions?: Record<string, boolean>;
}

export interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (email: string, password: string) => Promise<void>;
    loginWithGoogle: (credential: string) => Promise<void>;
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
    replaceSession: (token: string, reviewer: User) => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    sessionExpiresAt: string | null;
    requiresPasswordChange: boolean;
}
