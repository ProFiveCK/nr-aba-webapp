export async function initGovernmentLeavePayrollSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_gov_payroll_batches (
      id UUID PRIMARY KEY, period_start DATE NOT NULL, period_end DATE NOT NULL CHECK(period_end>=period_start),
      version INTEGER NOT NULL CHECK(version>0), supersedes_id UUID UNIQUE REFERENCES hr_gov_payroll_batches(id),
      prepared_by UUID NOT NULL REFERENCES reviewers(id), source_reference TEXT NOT NULL, reason TEXT NOT NULL,
      payload_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL, snapshot JSONB NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(period_start,period_end,version)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_payroll_period ON hr_gov_payroll_batches(period_start,period_end,version DESC);
    CREATE TABLE IF NOT EXISTS hr_gov_payroll_receipts (
      batch_id UUID PRIMARY KEY REFERENCES hr_gov_payroll_batches(id),actor_id UUID NOT NULL REFERENCES reviewers(id),
      snapshot_hash TEXT NOT NULL,reference TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_migration_reviews (
      id UUID PRIMARY KEY,employee_id UUID NOT NULL REFERENCES hr_employees(id),cutover_date DATE NOT NULL,
      prepared_by UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,payroll_reference TEXT NOT NULL,
      transition_reference TEXT NOT NULL,history_reference TEXT NOT NULL,reason TEXT NOT NULL,
      payload_hash TEXT NOT NULL,context_hash TEXT NOT NULL,plan JSONB NOT NULL,snapshot JSONB NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_migration_employee ON hr_gov_migration_reviews(employee_id,recorded_at DESC,id);
    CREATE TABLE IF NOT EXISTS hr_gov_migration_certifications (
      review_id UUID PRIMARY KEY REFERENCES hr_gov_migration_reviews(id),actor_id UUID NOT NULL REFERENCES reviewers(id),
      reason TEXT NOT NULL,postings JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_credit_transfers (
      entitlement_id UUID PRIMARY KEY REFERENCES hr_gov_entitlements(id),
      employee_id UUID NOT NULL REFERENCES hr_employees(id),code TEXT NOT NULL CHECK(code IN ('recreation','medical','special')),
      review_id UUID NOT NULL REFERENCES hr_gov_migration_reviews(id),cutover_date DATE NOT NULL,
      amount NUMERIC(18,6) NOT NULL CHECK(amount>0),source_balance_ids UUID[] NOT NULL CHECK(cardinality(source_balance_ids)>0),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(employee_id,code)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_legacy_transfers (
      legacy_request_id UUID PRIMARY KEY REFERENCES hr_leave_applications(id),request_id UUID NOT NULL UNIQUE,
      employee_id UUID NOT NULL REFERENCES hr_employees(id),code TEXT NOT NULL,review_id UUID NOT NULL REFERENCES hr_gov_migration_reviews(id),
      legacy_hash TEXT NOT NULL,source_reference TEXT NOT NULL,recorded_by UUID NOT NULL REFERENCES reviewers(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE hr_gov_legacy_transfers ADD COLUMN IF NOT EXISTS approval_preserved BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS hr_gov_handovers (
      id UUID PRIMARY KEY,prepared_by UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,reason TEXT NOT NULL,
      payload_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_handover_receipts (
      handover_id UUID PRIMARY KEY REFERENCES hr_gov_handovers(id),actor_id UUID NOT NULL REFERENCES reviewers(id),
      reference TEXT NOT NULL,snapshot_hash TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  for(const table of ['hr_gov_payroll_batches','hr_gov_payroll_receipts','hr_gov_migration_reviews','hr_gov_migration_certifications','hr_gov_handovers','hr_gov_handover_receipts','hr_gov_legacy_transfers','hr_gov_credit_transfers']) {
    await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);
    await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);
  }
}
