import type { User } from '../contexts/auth-types';
import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  Landmark,
  Wallet,
  Wrench,
  Globe,
  Activity,
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
  | 'admin';

export type UserRole = 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health';

export interface AppDef {
  id: AppId;
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
    label: 'ABA Payments',
    shortLabel: 'ABA',
    icon: CreditCard,
    capability: 'aba_access',
    description: 'Generate ABA files, read batches, and review payment instructions.',
    color: 'bg-amber-500',
  },
  {
    id: 'banking',
    label: 'Banking',
    shortLabel: 'Banking',
    icon: Landmark,
    capability: 'banking_access',
    description: 'Bank accounts, presets, and statement tools.',
    color: 'bg-emerald-600',
  },
  {
    id: 'payroll',
    label: 'Payroll',
    shortLabel: 'Payroll',
    icon: Wallet,
    capability: 'payroll_access',
    description: 'Payroll preparation and payment runs.',
    color: 'bg-amber-600',
  },
  {
    id: 'tools',
    label: 'Tools',
    shortLabel: 'Tools',
    icon: Wrench,
    capability: 'tools_access',
    description: 'SaaS subscriptions and utility tools.',
    color: 'bg-slate-600',
  },
  {
    id: 'forex-tt',
    label: 'FOREX TT',
    shortLabel: 'FOREX TT',
    icon: Globe,
    capability: 'forex_tt_access',
    description: 'Foreign currency telegraphic transfer requests and reviews.',
    color: 'bg-sky-600',
  },
  {
    id: 'public-health',
    label: 'Wellness Program',
    shortLabel: 'Public Health',
    icon: Activity,
    capability: 'public_health_access',
    description: 'Manage wellness allowance participants and payment runs.',
    color: 'bg-teal-600',
  },
];

export const SYSTEM_PAGES: AppDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    icon: LayoutDashboard,
    capability: 'dashboard',
    description: 'App launcher and overview.',
    color: 'bg-zinc-700',
  },
  {
    id: 'admin',
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

export function findApp(id: AppId): AppDef | undefined {
  return [...APPS, ...SYSTEM_PAGES].find((app) => app.id === id);
}
