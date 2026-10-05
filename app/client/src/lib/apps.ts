import type { User } from '../contexts/auth-types';
import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  Landmark,
  Wallet,
  Wrench,
  Globe,
  Activity,
  CalendarDays,
  LayoutDashboard,
  Settings,
} from 'lucide-react';

export type AppId =
  | 'dashboard'
  | 'aba'
  | 'banking'
  | 'payroll'
  | 'tools'
  | 'forex-tt'
  | 'public-health'
  | 'hr'
  | 'admin';

export type UserRole = 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health';

export interface AppDef {
  id: AppId;
  /**
   * The app's URL segment. Kept separate from `id` because the id is also the
   * permission prefix and is baked into stored capabilities, while the path is
   * what people see and bookmark — "Leave" lives at /leave but is `hr`
   * everywhere underneath.
   */
  path: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Capability that grants access. Held in any combination, so one person can
   *  be an ABA preparer, a reviewer and a banking officer at once. */
  capability: string;
  description: string;
  color: string;
}

export const APPS: AppDef[] = [
  {
    id: 'aba',
    path: 'aba',
    label: 'ABA Payments',
    shortLabel: 'ABA',
    icon: CreditCard,
    capability: 'aba_access',
    description: 'Generate ABA files, read batches, and review payment instructions.',
    color: 'bg-amber-500',
  },
  {
    id: 'banking',
    path: 'banking',
    label: 'Banking',
    shortLabel: 'Banking',
    icon: Landmark,
    capability: 'banking_access',
    description: 'Bank accounts, presets, and statement tools.',
    color: 'bg-emerald-600',
  },
  {
    id: 'payroll',
    path: 'payroll',
    label: 'Payroll',
    shortLabel: 'Payroll',
    icon: Wallet,
    capability: 'payroll_access',
    description: 'Payroll preparation and payment runs.',
    color: 'bg-amber-600',
  },
  {
    id: 'tools',
    path: 'tools',
    label: 'Tools',
    shortLabel: 'Tools',
    icon: Wrench,
    capability: 'tools_access',
    description: 'SaaS subscriptions and utility tools.',
    color: 'bg-gray-600',
  },
  {
    id: 'forex-tt',
    path: 'forex-tt',
    label: 'FOREX TT',
    shortLabel: 'FOREX TT',
    icon: Globe,
    capability: 'forex_tt_access',
    description: 'Foreign currency telegraphic transfer requests and reviews.',
    color: 'bg-sky-600',
  },
  {
    id: 'public-health',
    path: 'fit-for-duty',
    label: 'Fit for Duty',
    shortLabel: 'Fit for Duty',
    icon: Activity,
    capability: 'public_health_access',
    description: 'Manage Fit for Duty allowance participants and payment runs.',
    color: 'bg-teal-600',
  },
  {
    id: 'hr',
    path: 'leave',
    label: 'Leave',
    shortLabel: 'Leave',
    icon: CalendarDays,
    capability: 'hr_access',
    description: 'Request leave, review approvals, and manage team availability.',
    color: 'bg-brand',
  },
];

export const SYSTEM_PAGES: AppDef[] = [
  {
    id: 'dashboard',
    path: '',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    icon: LayoutDashboard,
    capability: 'dashboard',
    description: 'App launcher and overview.',
    color: 'bg-gray-700',
  },
  {
    id: 'admin',
    path: 'admin',
    label: 'Administration',
    shortLabel: 'Admin',
    icon: Settings,
    capability: 'admin',
    description: 'Users, permissions, and system settings.',
    color: 'bg-rose-600',
  },
];

export function canAccessApp(user: User | null, app: AppDef): boolean {
  if (!user) return false;
  if (app.id === 'dashboard') return true;
  return user.permissions?.[app.capability] === true;
}

export function getAllowedApps(user: User | null): AppDef[] {
  return APPS.filter((app) => canAccessApp(user, app));
}

const ALL_APPS = [...APPS, ...SYSTEM_PAGES];

export function findApp(id: AppId): AppDef | undefined {
  return ALL_APPS.find((app) => app.id === id);
}

/** The app owning a URL segment, for turning a location back into an app. */
export function findAppByPath(path: string): AppDef | undefined {
  if (!path) return ALL_APPS.find((app) => app.id === 'dashboard');
  return ALL_APPS.find((app) => app.path === path);
}

/** Where an app lives. The dashboard is the root, not /dashboard. */
export function pathForApp(app: AppDef): string {
  return app.path ? `/${app.path}` : '/';
}
