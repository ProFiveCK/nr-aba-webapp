import type { User } from '../contexts/auth-types';
import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  Landmark,
  Wallet,
  Wrench,
  Globe,
  LayoutDashboard,
  FolderClosed,
  Settings,
} from 'lucide-react';

export type AppId =
  | 'dashboard'
  | 'aba'
  | 'banking'
  | 'payroll'
  | 'tools'
  | 'forex-tt'
  | 'my-folder'
  | 'admin';

export type UserRole = 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll';

export interface AppDef {
  id: AppId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  roles: UserRole[];
  description: string;
  color: string;
}

export const APPS: AppDef[] = [
  {
    id: 'aba',
    label: 'ABA Payments',
    shortLabel: 'ABA',
    icon: CreditCard,
    roles: ['user', 'reviewer', 'admin'],
    description: 'Generate ABA files, read batches, and review payment instructions.',
    color: 'bg-amber-500',
  },
  {
    id: 'banking',
    label: 'Banking',
    shortLabel: 'Banking',
    icon: Landmark,
    roles: ['banking', 'admin'],
    description: 'Bank accounts, presets, and statement tools.',
    color: 'bg-emerald-600',
  },
  {
    id: 'payroll',
    label: 'Payroll',
    shortLabel: 'Payroll',
    icon: Wallet,
    roles: ['payroll', 'admin'],
    description: 'Payroll preparation and payment runs.',
    color: 'bg-amber-600',
  },
  {
    id: 'tools',
    label: 'Tools',
    shortLabel: 'Tools',
    icon: Wrench,
    roles: ['admin'],
    description: 'SaaS subscriptions and utility tools.',
    color: 'bg-slate-600',
  },
  {
    id: 'forex-tt',
    label: 'FOREX TT',
    shortLabel: 'FOREX TT',
    icon: Globe,
    roles: ['user', 'reviewer', 'admin'],
    description: 'Foreign currency telegraphic transfer requests and reviews.',
    color: 'bg-sky-600',
  },
];

export const SYSTEM_PAGES: AppDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['user', 'banking', 'reviewer', 'admin', 'payroll'],
    description: 'App launcher and overview.',
    color: 'bg-zinc-700',
  },
  {
    id: 'my-folder',
    label: 'My Folder',
    shortLabel: 'My Folder',
    icon: FolderClosed,
    roles: ['user', 'banking', 'reviewer', 'admin', 'payroll'],
    description: 'Your submissions and history across apps.',
    color: 'bg-purple-600',
  },
  {
    id: 'admin',
    label: 'Administration',
    shortLabel: 'Admin',
    icon: Settings,
    roles: ['admin'],
    description: 'Users, permissions, and system settings.',
    color: 'bg-rose-600',
  },
];

export function canAccessApp(user: User | null, app: AppDef): boolean {
  if (!user) return false;
  if (app.id === 'dashboard' || app.id === 'my-folder') return true;
  return app.roles.includes(user.role as UserRole);
}

export function getAllowedApps(user: User | null): AppDef[] {
  return APPS.filter((app) => canAccessApp(user, app));
}

export function findApp(id: AppId): AppDef | undefined {
  return [...APPS, ...SYSTEM_PAGES].find((app) => app.id === id);
}
