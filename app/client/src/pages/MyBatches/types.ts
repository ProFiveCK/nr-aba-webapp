/**
 * Type definitions for My Batches page
 */

export interface Batch {
    code: string;
    root_batch_id: string;
    department_code: string;
    file_name: string;
    created_at: string;
    stage: 'submitted' | 'approved' | 'rejected';
    stage_updated_at: string;
    pd_number: string;
    submitted_email: string;
    submitted_by: number;
    is_draft: boolean;
}

export interface BatchHistoryEvent {
    id: number;
    batch_id: string;
    reviewer: string;
    status: string;
    comments: string | null;
    created_at: string;
    metadata?: Record<string, unknown>;
    actor_id?: number;
    stage: string;
}

export interface BatchDetail extends Batch {
    batch_id: string;
    checksum: string | null;
    transactions: {
        metrics?: {
            creditsCents: number;
            debitsCents: number;
            transactionCount: number;
        };
        payload?: {
            header: Record<string, unknown>;
            transactions: Array<{
                bsb: string;
                account: string;
                amount: number;
                accountTitle: string;
                lodgementRef: string;
                txnCode: string;
            }>;
        };
        [key: string]: unknown;
    };
    file_base64?: string;
    file_available?: boolean;
    history?: BatchHistoryEvent[];
}

export type BatchStage = 'submitted' | 'approved' | 'rejected';

export interface StageMetadata {
    label: string;
    color: 'blue' | 'green' | 'red' | 'gray';
}
