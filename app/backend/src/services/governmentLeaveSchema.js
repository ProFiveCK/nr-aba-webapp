import {initGovernmentLeaveWorkflowSchema} from './governmentLeaveWorkflowSchema.js';
// Additive government subledger; legacy IDs, balances and applications stay intact.
export async function initGovernmentLeaveSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_gov_policy_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL, effective_from DATE NOT NULL,
      effective_to DATE NOT NULL CHECK(effective_to>=effective_from), rules JSONB NOT NULL,
      source_reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      prepared_by UUID REFERENCES reviewers(id), published_by UUID REFERENCES reviewers(id), published_at TIMESTAMPTZ,
      reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE hr_gov_policy_versions ADD COLUMN IF NOT EXISTS evaluator_version TEXT NOT NULL DEFAULT 'gov-foundation-1';
    CREATE INDEX IF NOT EXISTS idx_hr_gov_policy_dates ON hr_gov_policy_versions(effective_from,effective_to) WHERE status='published';
    CREATE TABLE IF NOT EXISTS hr_gov_calendars (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL, effective_from DATE NOT NULL,
      effective_to DATE NOT NULL CHECK(effective_to>=effective_from), holidays JSONB NOT NULL,
      source_reference TEXT NOT NULL, recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_pattern_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_pattern_id UUID NOT NULL REFERENCES hr_work_patterns(id),
      source_reference TEXT NOT NULL, recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(work_pattern_id)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_service_bases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      effective_from DATE NOT NULL, continuity_start DATE NOT NULL, anniversary_method TEXT NOT NULL CHECK(anniversary_method IN ('calendar','pause_exclusions')),
      leap_day_method TEXT NOT NULL CHECK(leap_day_method IN ('feb28','mar1')),
      schedule_mode TEXT NOT NULL CHECK(schedule_mode IN ('weekly','roster')), source_reference TEXT NOT NULL,
      recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(employee_id,effective_from), CHECK(continuity_start<=effective_from)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_service_exclusions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      start_date DATE NOT NULL, end_date DATE NOT NULL CHECK(end_date>=start_date),
      kind TEXT NOT NULL CHECK(kind IN ('lwop','other_excluded','continuity_break')),
      source_reference TEXT NOT NULL, recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_gov_roster_days (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id), day DATE NOT NULL,
      paid_hours NUMERIC(6,2) NOT NULL CHECK(paid_hours>=0 AND paid_hours<=24),
      policy_days NUMERIC(12,6) NOT NULL CHECK(policy_days>=0 AND policy_days<=2),
      source_reference TEXT NOT NULL, recorded_by UUID REFERENCES reviewers(id), reason TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(employee_id,day),
      CHECK((paid_hours=0 AND policy_days=0) OR (paid_hours>0 AND policy_days>0))
    );
    CREATE TABLE IF NOT EXISTS hr_gov_openings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      code TEXT NOT NULL CHECK(code IN ('recreation','medical','special')), policy_version_id UUID NOT NULL REFERENCES hr_gov_policy_versions(id),
      period_start DATE NOT NULL, period_end DATE NOT NULL CHECK(period_end>=period_start), as_of DATE NOT NULL,
      amount NUMERIC(18,6) NOT NULL CHECK(amount>=0), source_reference TEXT NOT NULL, payroll_reference TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL, historical_snapshot JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','certified')),
      prepared_by UUID NOT NULL REFERENCES reviewers(id), certified_by UUID REFERENCES reviewers(id),
      reason TEXT NOT NULL, certification_reason TEXT, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), certified_at TIMESTAMPTZ,
      CHECK(as_of BETWEEN period_start AND period_end)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_entitlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES hr_employees(id),
      code TEXT NOT NULL CHECK(code IN ('recreation','medical','special')), policy_version_id UUID NOT NULL REFERENCES hr_gov_policy_versions(id),
      period_start DATE NOT NULL, period_end DATE NOT NULL CHECK(period_end>=period_start),
      as_of DATE NOT NULL, opening_id UUID NOT NULL UNIQUE REFERENCES hr_gov_openings(id),
      UNIQUE(employee_id,code,period_start)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_entitlements_employee ON hr_gov_entitlements(employee_id,code,period_start,period_end);
    CREATE TABLE IF NOT EXISTS hr_gov_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entitlement_id UUID NOT NULL REFERENCES hr_gov_entitlements(id),
      kind TEXT NOT NULL CHECK(kind IN ('opening','grant','accrual','use','expiry','correction','reversal')),
      amount NUMERIC(18,6) NOT NULL, effective_date DATE NOT NULL, event_key TEXT NOT NULL UNIQUE,
      reverses_id UUID UNIQUE REFERENCES hr_gov_ledger(id), source_reference TEXT NOT NULL,
      actor_id UUID REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_ledger_account ON hr_gov_ledger(entitlement_id,effective_date,id);
    CREATE TABLE IF NOT EXISTS hr_gov_reservation_requests (
      id UUID PRIMARY KEY, employee_id UUID NOT NULL REFERENCES hr_employees(id), payload_hash TEXT NOT NULL,
      evaluation_snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','released','consumed')),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS hr_gov_reservations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES hr_gov_reservation_requests(id),
      entitlement_id UUID NOT NULL REFERENCES hr_gov_entitlements(id), amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
      UNIQUE(request_id,entitlement_id)
    );
    CREATE TABLE IF NOT EXISTS hr_gov_reservation_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES hr_gov_reservation_requests(id),
      action TEXT NOT NULL CHECK(action IN ('held','released','consumed')), actor_id UUID REFERENCES reviewers(id), reason TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(request_id,action)
    );
    ALTER TABLE hr_gov_calendars ADD COLUMN IF NOT EXISTS supersedes_id UUID UNIQUE REFERENCES hr_gov_calendars(id);
    ALTER TABLE hr_gov_roster_days ADD COLUMN IF NOT EXISTS supersedes_id UUID UNIQUE REFERENCES hr_gov_roster_days(id);
    ALTER TABLE hr_gov_roster_days DROP CONSTRAINT IF EXISTS hr_gov_roster_days_employee_id_day_key;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_gov_roster_root ON hr_gov_roster_days(employee_id,day) WHERE supersedes_id IS NULL;
    CREATE TABLE IF NOT EXISTS hr_gov_exclusion_withdrawals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), exclusion_id UUID NOT NULL UNIQUE REFERENCES hr_gov_service_exclusions(id),
      recorded_by UUID REFERENCES reviewers(id), source_reference TEXT NOT NULL, reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_gov_exclusions_employee ON hr_gov_service_exclusions(employee_id,start_date,end_date);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_roster_employee_day ON hr_gov_roster_days(employee_id,day);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_holds_entitlement ON hr_gov_reservations(entitlement_id,request_id);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_openings_employee ON hr_gov_openings(employee_id,recorded_at DESC,id);
    CREATE INDEX IF NOT EXISTS idx_hr_gov_openings_queue ON hr_gov_openings(recorded_at DESC,id);
    CREATE OR REPLACE FUNCTION hr_gov_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Government history is immutable; append a certified successor or reversal'; END;
    $$;
    CREATE OR REPLACE FUNCTION hr_gov_published_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.status='published' THEN RAISE EXCEPTION 'Published policy is immutable; prepare a successor'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END;
    $$;
    CREATE OR REPLACE FUNCTION hr_gov_opening_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' OR OLD.status='certified' THEN RAISE EXCEPTION 'Opening history is immutable'; END IF;
        IF ROW(NEW.employee_id,NEW.code,NEW.policy_version_id,NEW.period_start,NEW.period_end,NEW.as_of,NEW.amount,NEW.source_reference,NEW.payroll_reference,NEW.snapshot_hash,NEW.historical_snapshot,NEW.prepared_by,NEW.reason)
          IS DISTINCT FROM ROW(OLD.employee_id,OLD.code,OLD.policy_version_id,OLD.period_start,OLD.period_end,OLD.as_of,OLD.amount,OLD.source_reference,OLD.payroll_reference,OLD.snapshot_hash,OLD.historical_snapshot,OLD.prepared_by,OLD.reason)
          THEN RAISE EXCEPTION 'Prepared opening facts are immutable; prepare another preview'; END IF;
        RETURN NEW;
      END;
    $$;
    DROP TRIGGER IF EXISTS hr_gov_opening_immutable ON hr_gov_openings;
    CREATE TRIGGER hr_gov_opening_immutable BEFORE UPDATE OR DELETE ON hr_gov_openings FOR EACH ROW EXECUTE FUNCTION hr_gov_opening_immutable();
    CREATE OR REPLACE FUNCTION hr_gov_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reservation history is immutable'; END IF;
        IF ROW(NEW.id,NEW.employee_id,NEW.payload_hash,NEW.evaluation_snapshot) IS DISTINCT FROM ROW(OLD.id,OLD.employee_id,OLD.payload_hash,OLD.evaluation_snapshot)
          THEN RAISE EXCEPTION 'Reservation identity and calculation are immutable'; END IF;
        RETURN NEW;
      END;
    $$;
    DROP TRIGGER IF EXISTS hr_gov_request_immutable ON hr_gov_reservation_requests;
    CREATE TRIGGER hr_gov_request_immutable BEFORE UPDATE OR DELETE ON hr_gov_reservation_requests FOR EACH ROW EXECUTE FUNCTION hr_gov_request_immutable();
    DROP TRIGGER IF EXISTS hr_gov_policy_immutable ON hr_gov_policy_versions;
    CREATE TRIGGER hr_gov_policy_immutable BEFORE UPDATE OR DELETE ON hr_gov_policy_versions FOR EACH ROW EXECUTE FUNCTION hr_gov_published_policy_immutable();
    DROP TRIGGER IF EXISTS hr_gov_ledger_immutable ON hr_gov_ledger;
    CREATE TRIGGER hr_gov_ledger_immutable BEFORE UPDATE OR DELETE ON hr_gov_ledger FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
    DROP TRIGGER IF EXISTS hr_gov_calendar_immutable ON hr_gov_calendars;
    CREATE TRIGGER hr_gov_calendar_immutable BEFORE UPDATE OR DELETE ON hr_gov_calendars FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
  `);
  await initGovernmentLeaveWorkflowSchema(client);
  for(const table of ['hr_gov_service_bases','hr_gov_service_exclusions','hr_gov_exclusion_withdrawals','hr_gov_roster_days','hr_gov_pattern_approvals','hr_gov_entitlements','hr_gov_reservations','hr_gov_reservation_events']) {
    await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);
    await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);
  }
}
