export type PublicHealthTierCode = 'LV0' | 'LV1' | 'LV2' | 'LV3';

export interface PublicHealthTier {
  id: string;
  code: PublicHealthTierCode;
  label: string;
  monthly_amount: number;
  sort_order: number;
  description?: string;
}

export interface PublicHealthParticipant {
  id: string;
  full_name: string;
  bank_bsb?: string | null;
  bank_account?: string | null;
  bank_account_name?: string | null;
  village?: string | null;
  status: 'active' | 'inactive' | 'removed';
  external_ref?: string | null;
  current_level?: PublicHealthTierCode;
  created_at: string;
  updated_at: string;
}

export interface PublicHealthPayPeriod {
  id: string;
  paid_date: string;
  status: 'draft' | 'submitted' | 'approved';
  aba_batch_id?: string | null;
  entry_count?: number;
  active_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PublicHealthPeriodEntry {
  id: string;
  participant_id: string;
  level: PublicHealthTierCode;
  active: boolean;
  amount: number;
  is_manual_override: boolean;
  full_name: string;
  bank_bsb?: string | null;
  bank_account?: string | null;
  bank_account_name?: string | null;
  village?: string | null;
}

export interface PublicHealthSettings {
  configured?: boolean;
  source_bsb?: string;
  source_account?: string;
  source_account_name?: string;
}

export interface PublicHealthReviewItem {
  batch_id: string;
  code: string;
  root_batch_id: string;
  department_code: string | null;
  file_name: string | null;
  pd_number: string | null;
  stage: 'submitted' | 'approved' | 'rejected';
  stage_updated_at: string | null;
  submitted_email: string | null;
  created_at: string;
  transactions?: Record<string, unknown>;
}
