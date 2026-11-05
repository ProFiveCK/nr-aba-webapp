// Tables from the one-time move of Treasury staff onto the Government leave
// rules (initial setup, rollout waves, assisted coverage). The screens and
// endpoints that wrote them are gone; the tables stay because existing rows
// are still read (initial setup state, job run log) and production keeps them.

export async function initGovernmentLeaveInitialSetupSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_gov_initial_setups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','deleted','adopted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), plan JSONB NOT NULL, source_hash TEXT NOT NULL,
      summary JSONB NOT NULL, prepared_by UUID NOT NULL REFERENCES reviewers(id), updated_by UUID NOT NULL REFERENCES reviewers(id),
      reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      adopted_by UUID REFERENCES reviewers(id), adopted_at TIMESTAMPTZ, adoption_hash TEXT, adoption_result JSONB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_gov_initial_setup_single_adoption ON hr_gov_initial_setups((TRUE)) WHERE status='adopted';
    CREATE TABLE IF NOT EXISTS hr_gov_initial_setup_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), setup_id UUID NOT NULL REFERENCES hr_gov_initial_setups(id), revision INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','adopted')), plan JSONB NOT NULL, source_hash TEXT NOT NULL,
      summary JSONB NOT NULL, actor_id UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(setup_id,revision,action)
    );
    CREATE OR REPLACE FUNCTION hr_gov_initial_setup_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' OR OLD.status='adopted' THEN RAISE EXCEPTION 'Adopted initial setup is immutable; use the subsequent governed workflows'; END IF;
        RETURN NEW;
      END;
    $$;
    DROP TRIGGER IF EXISTS hr_gov_initial_setup_immutable ON hr_gov_initial_setups;
    CREATE TRIGGER hr_gov_initial_setup_immutable BEFORE UPDATE OR DELETE ON hr_gov_initial_setups FOR EACH ROW EXECUTE FUNCTION hr_gov_initial_setup_immutable();
    DROP TRIGGER IF EXISTS hr_gov_initial_setup_revision_immutable ON hr_gov_initial_setup_revisions;
    CREATE TRIGGER hr_gov_initial_setup_revision_immutable BEFORE UPDATE OR DELETE ON hr_gov_initial_setup_revisions FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
  `);
}
export async function initGovernmentLeaveRolloutSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS hr_gov_assisted_coverage(id UUID PRIMARY KEY,label TEXT NOT NULL,employee_ids UUID[] NOT NULL CHECK(cardinality(employee_ids) BETWEEN 1 AND 50),effective_from DATE NOT NULL,effective_to DATE NOT NULL CHECK(effective_to>=effective_from),source_reference TEXT NOT NULL,reason TEXT NOT NULL,prepared_by UUID NOT NULL REFERENCES reviewers(id),payload_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hr_gov_assisted_coverage_approvals(coverage_id UUID PRIMARY KEY REFERENCES hr_gov_assisted_coverage(id),actor_id UUID NOT NULL REFERENCES reviewers(id),snapshot_hash TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hr_gov_rollout_waves(id UUID PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('rehearsal','pilot','department')),employee_ids UUID[] NOT NULL CHECK(cardinality(employee_ids) BETWEEN 1 AND 50),prepared_by UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,reason TEXT NOT NULL,payload_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hr_gov_job_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),started_at TIMESTAMPTZ NOT NULL,finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),summary JSONB NOT NULL);
 CREATE TABLE IF NOT EXISTS hr_gov_rollout_approvals(wave_id UUID PRIMARY KEY REFERENCES hr_gov_rollout_waves(id),actor_id UUID NOT NULL REFERENCES reviewers(id),snapshot_hash TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_hr_gov_rollout_queue ON hr_gov_rollout_waves(recorded_at DESC,id);`);
 for(const table of ['hr_gov_rollout_waves','hr_gov_rollout_approvals','hr_gov_job_runs','hr_gov_assisted_coverage','hr_gov_assisted_coverage_approvals']){await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);}
}
