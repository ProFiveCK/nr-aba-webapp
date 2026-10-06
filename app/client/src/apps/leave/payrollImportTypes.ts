export type PayrollImportDecision = 'create' | 'update' | 'review' | 'skip';
export type PayrollImportResult = { created: number; updated: number; unchanged: number; skipped: number; service_periods_added: number };
export type PayrollImportBatch = {
    id: string; file_name: string; export_date: string; status: 'preview' | 'applied';
    revision: number; row_count: number; result: PayrollImportResult | null;
};
export type PayrollImportCandidate = { id: string; display_name: string; department_code: string | null; status: string; external_ids?: { external_id: string }[] };
export type PayrollImportRow = {
    row_number: number; data: Record<string, string>; decision: PayrollImportDecision;
    target_employee_id: string | null; target_employee_name?: string | null; state: 'ready' | 'blocked' | 'skipped' | 'applied';
    errors: string[]; warnings: string[]; review_reason: string | null;
    applied_outcome: string | null; potential_matches: PayrollImportCandidate[];
    changes: { field: string; before: string | null; after: string | null }[];
    service_action: string;
};
export type PayrollImportView = {
    batch: PayrollImportBatch; rows: PayrollImportRow[]; page: number; page_size: number; total: number; filter: string;
    summary: { ready: number; blocked: number; skipped: number; create: number; update: number };
};
