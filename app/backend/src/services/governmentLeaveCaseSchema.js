export async function initGovernmentLeaveCaseSchema(client){
 await client.query(`
  ALTER TABLE hr_gov_requests ALTER COLUMN config_id DROP NOT NULL;
  ALTER TABLE hr_gov_requests ALTER COLUMN reservation_id DROP NOT NULL;
  ALTER TABLE hr_gov_requests DROP CONSTRAINT IF EXISTS hr_gov_requests_code_check;
  ALTER TABLE hr_gov_requests ADD CONSTRAINT hr_gov_requests_code_check CHECK(code IN ('recreation','medical','special','teacher_recreation','extended_medical','extended_medical_minister','maternity','paternity','adoption','official','lwop','long_service','furlough','recreation_encashment','recreation_separation','witness_republic','witness_other','attendance','amendment'));
  ALTER TABLE hr_gov_requests DROP CONSTRAINT IF EXISTS hr_gov_requests_charge_check;
  ALTER TABLE hr_gov_requests ADD CONSTRAINT hr_gov_requests_charge_check CHECK(charge>=0 AND (code NOT IN ('recreation','medical','special') OR (charge>0 AND reservation_id IS NOT NULL AND config_id IS NOT NULL)));
  ALTER TABLE hr_gov_request_stages DROP CONSTRAINT IF EXISTS hr_gov_request_stages_level_check;
  ALTER TABLE hr_gov_request_stages ADD CONSTRAINT hr_gov_request_stages_level_check CHECK(level IN ('division','department','hr_verifier','relevant_secretary','minister','chief_secretary'));
  ALTER TABLE hr_gov_consent_offices DROP CONSTRAINT IF EXISTS hr_gov_consent_offices_level_check;
  ALTER TABLE hr_gov_consent_offices ADD CONSTRAINT hr_gov_consent_offices_level_check CHECK(level IN ('relevant_secretary','hr_verifier','minister'));
  ALTER TABLE hr_gov_consent_offices DROP CONSTRAINT IF EXISTS hr_gov_consent_offices_check;
  ALTER TABLE hr_gov_consent_offices DROP CONSTRAINT IF EXISTS hr_gov_consent_offices_check1;
  ALTER TABLE hr_gov_consent_offices DROP CONSTRAINT IF EXISTS hr_gov_consent_offices_effective_dates;
  ALTER TABLE hr_gov_consent_offices ADD CONSTRAINT hr_gov_consent_offices_effective_dates CHECK(effective_to IS NULL OR effective_to>=effective_from);
  ALTER TABLE hr_gov_consent_offices ADD CONSTRAINT hr_gov_consent_offices_check CHECK((level IN ('relevant_secretary','minister') AND department_id IS NOT NULL) OR (level='hr_verifier' AND department_id IS NULL));
  CREATE TABLE IF NOT EXISTS hr_gov_case_determinations(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_id UUID NOT NULL REFERENCES hr_gov_requests(id),version INTEGER NOT NULL,
   prepared_by UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,evidence_reference TEXT NOT NULL,reason TEXT NOT NULL,
   determination JSONB NOT NULL,context_hash TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(request_id,version)
  );
  CREATE TABLE IF NOT EXISTS hr_gov_continuations(
   original_request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id),request_id UUID NOT NULL UNIQUE REFERENCES hr_gov_requests(id),
   actor_id UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS hr_gov_case_links(
   request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id),original_request_id UUID NOT NULL REFERENCES hr_gov_requests(id),
   kind TEXT NOT NULL CHECK(kind IN ('amendment','continuation','medical_escalation')),recorded_by UUID NOT NULL REFERENCES reviewers(id),reference TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_hr_gov_case_links_original ON hr_gov_case_links(original_request_id,kind);
  CREATE TABLE IF NOT EXISTS hr_gov_case_effects(
   request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id),original_request_id UUID REFERENCES hr_gov_requests(id),
   effect JSONB NOT NULL,recorded_by UUID NOT NULL REFERENCES reviewers(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_gov_case_effect_original ON hr_gov_case_effects(original_request_id) WHERE original_request_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS hr_gov_benefit_bases(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES hr_employees(id),service_basis_id UUID NOT NULL REFERENCES hr_gov_service_bases(id),
   source_reference TEXT NOT NULL,prior_units NUMERIC(18,6) NOT NULL CHECK(prior_units>=0),unit TEXT NOT NULL,
   transition_reference TEXT NOT NULL,request_id UUID NOT NULL REFERENCES hr_gov_requests(id),UNIQUE(employee_id,service_basis_id)
  );
  CREATE TABLE IF NOT EXISTS hr_gov_benefit_commitments(
   request_id UUID PRIMARY KEY REFERENCES hr_gov_requests(id),employee_id UUID NOT NULL REFERENCES hr_employees(id),basis_id UUID REFERENCES hr_gov_benefit_bases(id),
   code TEXT NOT NULL,units NUMERIC(18,6) NOT NULL CHECK(units>0),determination_id UUID NOT NULL REFERENCES hr_gov_case_determinations(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_hr_gov_benefit_employee ON hr_gov_benefit_commitments(employee_id,basis_id);
  CREATE TABLE IF NOT EXISTS hr_gov_case_credit_holds(
   determination_id UUID PRIMARY KEY REFERENCES hr_gov_case_determinations(id),request_id UUID NOT NULL REFERENCES hr_gov_requests(id),
   entitlement_id UUID NOT NULL REFERENCES hr_gov_entitlements(id),amount NUMERIC(18,6) NOT NULL CHECK(amount>0)
  );
  CREATE TABLE IF NOT EXISTS hr_gov_case_tasks(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_id UUID NOT NULL REFERENCES hr_gov_requests(id),kind TEXT NOT NULL,due_date DATE,
   description TEXT NOT NULL,created_by UUID NOT NULL REFERENCES reviewers(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(request_id,kind)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_gov_task_due ON hr_gov_case_tasks(due_date,id);
  CREATE TABLE IF NOT EXISTS hr_gov_task_events(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID NOT NULL REFERENCES hr_gov_case_tasks(id),event_key UUID NOT NULL UNIQUE,
   action TEXT NOT NULL CHECK(action IN ('completed','reopened','noncompletion')),reference TEXT NOT NULL,reason TEXT NOT NULL,
   facts JSONB NOT NULL,actor_id UUID NOT NULL REFERENCES reviewers(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_hr_gov_task_events_latest ON hr_gov_task_events(task_id,recorded_at DESC,id DESC);
 `);
 for(const table of ['hr_gov_case_determinations','hr_gov_continuations','hr_gov_case_links','hr_gov_case_effects','hr_gov_benefit_bases','hr_gov_benefit_commitments','hr_gov_case_credit_holds','hr_gov_case_tasks','hr_gov_task_events']){
  await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);
  await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);
 }
}
