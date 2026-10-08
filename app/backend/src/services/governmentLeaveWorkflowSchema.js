import {initGovernmentLeaveCaseSchema} from './governmentLeaveCaseSchema.js';
export async function initGovernmentLeaveWorkflowSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_gov_commissioning_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan JSONB NOT NULL, snapshot_hash TEXT NOT NULL, snapshot JSONB NOT NULL,
      prepared_by UUID NOT NULL REFERENCES reviewers(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_commissioning_receipts (
      review_id UUID PRIMARY KEY REFERENCES hr_gov_commissioning_reviews(id), actor_id UUID NOT NULL REFERENCES reviewers(id),
      reason TEXT NOT NULL, result JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS hr_gov_commissioning_reviews_immutable ON hr_gov_commissioning_reviews;
    CREATE TRIGGER hr_gov_commissioning_reviews_immutable BEFORE UPDATE OR DELETE ON hr_gov_commissioning_reviews FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
    DROP TRIGGER IF EXISTS hr_gov_commissioning_receipts_immutable ON hr_gov_commissioning_receipts;
    CREATE TRIGGER hr_gov_commissioning_receipts_immutable BEFORE UPDATE OR DELETE ON hr_gov_commissioning_receipts FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
    CREATE TABLE IF NOT EXISTS hr_gov_approval_routes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), department_id UUID REFERENCES hr_departments(id),
      stages JSONB NOT NULL CHECK(jsonb_typeof(stages)='array' AND jsonb_array_length(stages) BETWEEN 1 AND 5),
      source_reference TEXT NOT NULL, recorded_by UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL,
      supersedes_id UUID REFERENCES hr_gov_approval_routes(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_approval_route_scope ON hr_gov_approval_routes(department_id,recorded_at DESC,id DESC);
    DROP TRIGGER IF EXISTS hr_gov_approval_routes_immutable ON hr_gov_approval_routes;
    CREATE TRIGGER hr_gov_approval_routes_immutable BEFORE UPDATE OR DELETE ON hr_gov_approval_routes FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
    CREATE TABLE IF NOT EXISTS hr_gov_workflow_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      enabled_codes TEXT[] NOT NULL CHECK(enabled_codes <@ ARRAY['recreation','medical','special']::text[]),
      medical_rule TEXT NOT NULL CHECK(medical_rule IN ('single_calendar_date_nonadjacent_scheduled_days','single_verified_shift_nonadjacent_scheduled_days')),
      medical_history JSONB NOT NULL, medical_period_start DATE, medical_as_of DATE,
      source_reference TEXT NOT NULL, legacy_resolution_reference TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      prepared_by UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')), approved_by UUID REFERENCES reviewers(id), approved_at TIMESTAMPTZ
    );
    ALTER TABLE hr_gov_workflow_configs DROP CONSTRAINT IF EXISTS hr_gov_workflow_configs_medical_rule_check;
    ALTER TABLE hr_gov_workflow_configs ADD CONSTRAINT hr_gov_workflow_configs_medical_rule_check CHECK(medical_rule IN ('single_calendar_date_nonadjacent_scheduled_days','single_verified_shift_nonadjacent_scheduled_days'));
    CREATE INDEX IF NOT EXISTS idx_hr_gov_workflow_employee ON hr_gov_workflow_configs(employee_id,approved_at DESC) WHERE status='published';
    CREATE TABLE IF NOT EXISTS hr_gov_consent_offices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), level TEXT NOT NULL CHECK(level IN ('relevant_secretary','hr_verifier')),
      department_id UUID REFERENCES hr_departments(id), approver_employee_id UUID NOT NULL REFERENCES hr_employees(id),
      effective_from DATE NOT NULL, effective_to DATE CHECK(effective_to>=effective_from),
      source_reference TEXT NOT NULL, recorded_by UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((level='relevant_secretary' AND department_id IS NOT NULL) OR (level='hr_verifier' AND department_id IS NULL))
    );
    CREATE TABLE IF NOT EXISTS hr_gov_consent_withdrawals (
      office_id UUID PRIMARY KEY REFERENCES hr_gov_consent_offices(id), effective_to DATE NOT NULL,
      actor_id UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_requests (
      id UUID PRIMARY KEY, employee_id UUID NOT NULL REFERENCES hr_employees(id), config_id UUID NOT NULL REFERENCES hr_gov_workflow_configs(id),
      code TEXT NOT NULL CHECK(code IN ('recreation','medical','special')), start_date DATE NOT NULL, end_date DATE NOT NULL CHECK(end_date>=start_date),
      reason TEXT NOT NULL, medical_mode TEXT NOT NULL CHECK(medical_mode IN ('certificate','exemption','not_applicable')),
      payload_hash TEXT NOT NULL, application_snapshot JSONB NOT NULL, department_id UUID NOT NULL, division_id UUID NOT NULL,
      reservation_id UUID NOT NULL UNIQUE REFERENCES hr_gov_reservation_requests(id), charge NUMERIC(18,6) NOT NULL CHECK(charge>0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      stage_index INTEGER NOT NULL DEFAULT 0, submitted_by UUID NOT NULL REFERENCES reviewers(id), submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ, grant_snapshot JSONB, final_pdf BYTEA
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_requests_employee ON hr_gov_requests(employee_id,submitted_at DESC,id);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_requests_pending ON hr_gov_requests(status,department_id,division_id);
    CREATE TABLE IF NOT EXISTS hr_gov_request_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES hr_gov_requests(id), ordinal INTEGER NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('division','department','hr_verifier','relevant_secretary','chief_secretary')), UNIQUE(request_id,ordinal)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_stage_bindings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), stage_id UUID NOT NULL REFERENCES hr_gov_request_stages(id),
      assignment_kind TEXT NOT NULL CHECK(assignment_kind IN ('enterprise','consent','substitute')), assignment_id UUID,
      approver_employee_id UUID NOT NULL REFERENCES hr_employees(id), reviewer_id UUID NOT NULL REFERENCES reviewers(id), approver_name TEXT NOT NULL,
      source_reference TEXT NOT NULL, recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE hr_gov_request_stages ADD COLUMN IF NOT EXISTS label TEXT;
    CREATE TABLE IF NOT EXISTS hr_gov_evidence_reviews (
      request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id), actor_id UUID NOT NULL REFERENCES reviewers(id),
      evidence_verification JSONB NOT NULL, reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS hr_gov_evidence_reviews_immutable ON hr_gov_evidence_reviews;
    CREATE TRIGGER hr_gov_evidence_reviews_immutable BEFORE UPDATE OR DELETE ON hr_gov_evidence_reviews FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
    CREATE INDEX IF NOT EXISTS idx_hr_gov_bindings_stage ON hr_gov_stage_bindings(stage_id,recorded_at DESC,id);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_bindings_account ON hr_gov_stage_bindings(reviewer_id,stage_id);
    CREATE TABLE IF NOT EXISTS hr_gov_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES hr_gov_requests(id), stage_id UUID NOT NULL UNIQUE REFERENCES hr_gov_request_stages(id),
      binding_id UUID NOT NULL REFERENCES hr_gov_stage_bindings(id), event_key UUID NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), actor_id UUID NOT NULL REFERENCES reviewers(id),
      note TEXT NOT NULL, evidence_verification JSONB, alternative_date DATE, consultation_reference TEXT,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_request_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES hr_gov_requests(id),
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, file_data BYTEA NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_documents_request ON hr_gov_request_documents(request_id);
    CREATE TABLE IF NOT EXISTS hr_gov_request_cancellations (
      request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id), actor_id UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_salary_acknowledgements (
      request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id), actor_id UUID NOT NULL REFERENCES reviewers(id), reference TEXT NOT NULL, reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_job_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      code TEXT NOT NULL CHECK(code IN ('recreation','medical','special')), service_basis_id UUID NOT NULL REFERENCES hr_gov_service_bases(id),
      first_post_end DATE, payroll_anchor DATE, temporary_start TEXT CHECK(temporary_start IN ('appointment','qualification')),
      method TEXT NOT NULL CHECK(method IN ('26_cycle_cumulative_floor_calendar_proration','service_anniversary_reset')),
      source_reference TEXT NOT NULL, prepared_by UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      approved_by UUID REFERENCES reviewers(id), approved_at TIMESTAMPTZ, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((code='recreation' AND first_post_end IS NOT NULL AND payroll_anchor IS NOT NULL AND temporary_start IS NOT NULL AND method='26_cycle_cumulative_floor_calendar_proration')
        OR (code IN ('medical','special') AND method='service_anniversary_reset'))
    );
    CREATE TABLE IF NOT EXISTS hr_gov_job_posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id), code TEXT NOT NULL,
      event_date DATE NOT NULL, event_kind TEXT NOT NULL CHECK(event_kind IN ('accrual','renewal')),
      plan_id UUID NOT NULL REFERENCES hr_gov_job_plans(id), amount NUMERIC(18,6) NOT NULL, capped BOOLEAN NOT NULL DEFAULT FALSE,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(employee_id,code,event_date,event_kind)
    );
    ALTER TABLE hr_gov_entitlements ALTER COLUMN opening_id DROP NOT NULL;
    ALTER TABLE hr_gov_entitlements ADD COLUMN IF NOT EXISTS renewal_plan_id UUID REFERENCES hr_gov_job_plans(id);
    CREATE OR REPLACE FUNCTION hr_gov_workflow_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' OR OLD.status='published' THEN RAISE EXCEPTION 'Published workflow configuration is immutable'; END IF;
        IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at']) THEN RAISE EXCEPTION 'Prepared workflow facts are immutable'; END IF;
        RETURN NEW;
      END;
    $$;
    CREATE OR REPLACE FUNCTION hr_gov_request_facts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Government request history is immutable'; END IF;
        IF (to_jsonb(NEW)-ARRAY['status','stage_index','completed_at','grant_snapshot','final_pdf']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stage_index','completed_at','grant_snapshot','final_pdf'])
          OR OLD.status<>'pending' THEN RAISE EXCEPTION 'Submitted government request facts are immutable'; END IF;
        RETURN NEW;
      END;
    $$;
    DROP TRIGGER IF EXISTS hr_gov_request_facts_guard ON hr_gov_requests;
    CREATE TRIGGER hr_gov_request_facts_guard BEFORE UPDATE OR DELETE ON hr_gov_requests FOR EACH ROW EXECUTE FUNCTION hr_gov_request_facts_guard();
  `);
  await initGovernmentLeaveCaseSchema(client);
  for(const table of ['hr_gov_workflow_configs','hr_gov_job_plans']) {
    await client.query(`DROP TRIGGER IF EXISTS ${table}_guard ON ${table}`);
    await client.query(`CREATE TRIGGER ${table}_guard BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_workflow_config_guard()`);
  }
  for(const table of ['hr_gov_consent_offices','hr_gov_consent_withdrawals','hr_gov_request_stages','hr_gov_stage_bindings','hr_gov_decisions','hr_gov_request_documents','hr_gov_request_cancellations','hr_gov_salary_acknowledgements','hr_gov_job_posts']) {
    await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);
    await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);
  }
}
