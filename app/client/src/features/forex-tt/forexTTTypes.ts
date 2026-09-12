export interface ForexTTRequest {
  id: number;
  request_id: string;
  root_request_id: string;
  submitted_by: number;
  department_code?: string;
  division_code?: string;
  status: 'draft' | 'submitted' | 'claimed' | 'processing' | 'needs_changes' | 'approved' | 'cancelled';
  version: number;
  form_data: ForexTTFormData;
  bank_confirmation?: string | null;
  claimed_by?: number | null;
  claimed_by_name?: string;
  claimed_at?: string;
  created_at: string;
  updated_at: string;
  allowed_next?: string[];
  history?: ForexTTEvent[];
  attachments?: ForexTTAttachment[];
}

export interface ForexTTFormData {
  beneficiary_name?: string;
  beneficiary_address?: string;
  beneficiary_bank_name?: string;
  beneficiary_bank_address?: string;
  beneficiary_bic?: string;
  beneficiary_iban?: string;
  beneficiary_account_number?: string;
  currency?: string;
  amount?: number | string;
  payment_reason?: string;
  sender_account?: string;
  sender_bsb?: string;
  sender_account_name?: string;
  reference?: string;
  priority?: 'standard' | 'urgent';
  fee_paid_by?: 'sender' | 'beneficiary' | 'shared';
  notes?: string;
}

export interface ForexTTAttachment {
  id: number;
  category: string;
  file_name: string;
  checksum: string;
  superseded_at?: string;
  uploaded_by?: number;
  created_at: string;
}

export interface ForexTTEvent {
  id: number;
  reviewer: string;
  status: string;
  comments?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
