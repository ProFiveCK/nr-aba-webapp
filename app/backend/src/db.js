import pg from 'pg';
import dotenv from 'dotenv';
import { ALL_CAPABILITIES, ROLE_CAPABILITIES } from './config.js';

dotenv.config();

/**
 * Seeds reviewer_capabilities from the legacy `role` column plus any explicit
 * `permissions` JSONB overrides, so every existing account keeps exactly the
 * access it had before capabilities existed.
 *
 * Runs once, guarded by reviewer_settings.capabilities_backfilled_at — without
 * that guard it would re-grant capabilities an administrator had revoked.
 */
async function backfillCapabilities(client) {
  const { rows: flag } = await client.query(
    'SELECT capabilities_backfilled_at FROM reviewer_settings WHERE id = TRUE'
  );
  if (flag.length && flag[0].capabilities_backfilled_at) return;

  const { rows: reviewers } = await client.query(
    'SELECT id, role, status, permissions FROM reviewers'
  );

  let granted = 0;
  for (const reviewer of reviewers) {
    const capabilities = new Set(ROLE_CAPABILITIES[reviewer.role] ?? []);

    // Active accounts could always submit, regardless of role.
    if (reviewer.status === 'active') {
      capabilities.add('submit_aba');
      capabilities.add('submit_forex_tt');
    }

    // Explicit JSONB overrides win in both directions.
    let overrides = reviewer.permissions;
    if (typeof overrides === 'string') {
      try { overrides = JSON.parse(overrides); } catch { overrides = {}; }
    }
    for (const [key, value] of Object.entries(overrides || {})) {
      if (!ALL_CAPABILITIES.includes(key)) continue;
      if (value === true) capabilities.add(key);
      else capabilities.delete(key);
    }

    for (const capability of capabilities) {
      await client.query(
        `INSERT INTO reviewer_capabilities (reviewer_id, capability)
         VALUES ($1, $2) ON CONFLICT (reviewer_id, capability) DO NOTHING`,
        [reviewer.id, capability]
      );
      granted += 1;
    }
  }

  await client.query(
    `INSERT INTO reviewer_settings (id, capabilities_backfilled_at) VALUES (TRUE, NOW())
     ON CONFLICT (id) DO UPDATE SET capabilities_backfilled_at = NOW()`
  );
  console.info(`[schema] backfilled ${granted} capability grants across ${reviewers.length} accounts`);
}

const { Pool } = pg;

const useSSL = process.env.DB_SSL === 'true';

// Block the postgres/postgres both-default combo in production — require explicit config.
// DB_USER=postgres with a real password is fine (it's the standard superuser name).
// Only block when BOTH user and password are the literal default "postgres".
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;

if (!process.env.DATABASE_URL) {
  if (!dbUser || !dbPassword) {
    console.error('FATAL: DB_USER and DB_PASSWORD must be set explicitly (or provide DATABASE_URL). Refusing to start without credentials.');
    process.exit(1);
  }
  // Block the well-known default combo unless explicitly opted in for dev.
  if (dbUser === 'postgres' && dbPassword === 'postgres' && process.env.DB_ALLOW_DEFAULT_CREDS !== 'true') {
    console.error('FATAL: DB_USER=postgres with DB_PASSWORD=postgres is the default combo. Set DB_ALLOW_DEFAULT_CREDS=true for dev or use a real password.');
    process.exit(1);
  }
}

const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: dbUser,
      password: dbPassword,
      database: process.env.DB_NAME || 'aba',
    };

if (useSSL) {
  // Validate the server certificate. Provide the CA via DB_SSL_CA (path or inline PEM),
  // or set DB_SSL_REJECT_UNAUTHORIZED=false only for development to opt into insecure mode.
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  const sslOpts = { rejectUnauthorized };
  if (rejectUnauthorized) {
    const ca = process.env.DB_SSL_CA;
    if (ca) {
      // Treat as a filesystem path if it doesn't look like a PEM block, otherwise inline PEM.
      sslOpts.ca = /-----BEGIN/.test(ca) ? ca : undefined;
      if (!sslOpts.ca) {
        try {
          sslOpts.ca = require('fs').readFileSync(ca, 'utf8');
        } catch (err) {
          console.error('FATAL: DB_SSL_CA path could not be read:', err.message);
          process.exit(1);
        }
      }
    } else {
      // Fall back to the well-known CA bundle if available, otherwise rely on Node's defaults.
    }
  }
  connectionConfig.ssl = sslOpts;
}

export const pool = new Pool(connectionConfig);

export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await client.query(`
      CREATE TABLE IF NOT EXISTS sanity_thresholds (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        currency TEXT DEFAULT 'AUD',
        amount_limit NUMERIC(18,2) NOT NULL,
        per_account_daily_limit INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE sanity_thresholds ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT FALSE');
    await client.query('UPDATE sanity_thresholds SET active = COALESCE(active, FALSE)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS whitelist_entries (
        id SERIAL PRIMARY KEY,
        bsb VARCHAR(7) NOT NULL,
        account VARCHAR(16) NOT NULL,
        alias TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (bsb, account)
      );
    `);
    await client.query('ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT FALSE');
    await client.query('UPDATE whitelist_entries SET active = COALESCE(active, FALSE)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS blacklist_entries (
        id SERIAL PRIMARY KEY,
        bsb VARCHAR(7) NOT NULL,
        account VARCHAR(16),
        all_accounts BOOLEAN NOT NULL DEFAULT FALSE,
        label TEXT,
        notes TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (bsb, account)
      );
    `);
    await client.query('ALTER TABLE blacklist_entries ADD COLUMN IF NOT EXISTS label TEXT');
    await client.query('ALTER TABLE blacklist_entries ADD COLUMN IF NOT EXISTS notes TEXT');
    await client.query('ALTER TABLE blacklist_entries ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE');
    await client.query('ALTER TABLE blacklist_entries ADD COLUMN IF NOT EXISTS all_accounts BOOLEAN DEFAULT FALSE');
    await client.query('ALTER TABLE blacklist_entries ALTER COLUMN account DROP NOT NULL');
    await client.query('UPDATE blacklist_entries SET active = COALESCE(active, TRUE)');
    await client.query('UPDATE blacklist_entries SET all_accounts = COALESCE(all_accounts, FALSE)');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS blacklist_entries_all_accounts_bsb_idx
        ON blacklist_entries (bsb)
        WHERE all_accounts = TRUE
    `);
    await client.query(`
      INSERT INTO blacklist_entries (bsb, account, all_accounts, label, notes, active)
      VALUES ('633-000', NULL, TRUE, 'BSB-wide block', 'Migrated from the previous hard-coded BSB restriction.', TRUE)
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        supplier_id TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        email TEXT,
        bsb VARCHAR(7),
        account VARCHAR(16),
        account_name TEXT,
        need_cba_bank_account BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','enabled','removed')),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bsb VARCHAR(7)');
    await client.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account VARCHAR(16)');
    await client.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_name TEXT');
    await client.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'blocked\'');
    await client.query('ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_status_check');
    await client.query(`
      ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_status_check CHECK (status IN ('blocked','enabled','removed'))
    `);
    await client.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS need_cba_bank_account BOOLEAN DEFAULT TRUE');
    await client.query('UPDATE suppliers SET need_cba_bank_account = COALESCE(need_cba_bank_account, TRUE)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_suppliers_supplier_id ON suppliers(supplier_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_suppliers_description ON suppliers(description)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS reviewers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'reviewer',
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS department_code TEXT');
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS division_code TEXT DEFAULT \'00\'');
    await client.query('UPDATE reviewers SET division_code = COALESCE(division_code, \'00\')');
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS notify_on_submission BOOLEAN DEFAULT TRUE');
    await client.query('ALTER TABLE reviewers DROP COLUMN IF EXISTS default_bank_preset');
    await client.query('ALTER TABLE reviewers ALTER COLUMN notify_on_submission SET DEFAULT TRUE');
    await client.query('UPDATE reviewers SET notify_on_submission = TRUE WHERE notify_on_submission IS NULL');
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT \'{}\'');
    await client.query('ALTER TABLE reviewers DROP CONSTRAINT IF EXISTS reviewers_role_check');
    await client.query(`
      ALTER TABLE reviewers
      ADD CONSTRAINT reviewers_role_check CHECK (role IN ('user','banking','reviewer','admin','payroll','public_health'))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reviewer_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reviewer_id UUID NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
        token_id TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    // Capability grants. Replaces authorizing on the single `reviewers.role`
    // column, which could not express a user who holds several roles at once.
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviewer_capabilities (
        reviewer_id UUID NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        granted_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (reviewer_id, capability)
      );
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_reviewer_capabilities_capability ON reviewer_capabilities(capability)'
    );

    // External sign-in identities (Google today). Keyed by the provider's
    // immutable subject claim rather than email, because emails get reassigned.
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviewer_identities (
        reviewer_id UUID NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        email TEXT NOT NULL,
        linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        PRIMARY KEY (provider, provider_subject)
      );
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_reviewer_identities_reviewer ON reviewer_identities(reviewer_id)'
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS reviewer_settings (
        id BOOLEAN PRIMARY KEY DEFAULT TRUE,
        passphrase_hash TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE reviewer_settings
        ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE reviewer_settings
        ADD COLUMN IF NOT EXISTS capabilities_backfilled_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE reviewer_settings
        ADD COLUMN IF NOT EXISTS testing_mode_set_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE reviewer_settings
        ADD COLUMN IF NOT EXISTS testing_mode_set_by UUID REFERENCES reviewers(id) ON DELETE SET NULL
    `);
    await client.query(`
      UPDATE reviewer_settings
         SET testing_mode = COALESCE(testing_mode, FALSE)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_reviews (
        id SERIAL PRIMARY KEY,
        batch_id UUID NOT NULL,
        reviewer TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
        comments TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE batch_reviews ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES reviewers(id)');
    await client.query('ALTER TABLE batch_reviews ADD COLUMN IF NOT EXISTS stage TEXT');
    await client.query('ALTER TABLE batch_reviews DROP CONSTRAINT IF EXISTS batch_reviews_status_check');
    await client.query(`
      ALTER TABLE batch_reviews
      ADD CONSTRAINT batch_reviews_status_check CHECK (status IN ('submitted','pending','approved','rejected'))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_archives (
        id SERIAL PRIMARY KEY,
        batch_id UUID NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        checksum TEXT,
        duplicate_report_path TEXT,
        transactions JSONB,
        workflow_type TEXT NOT NULL DEFAULT 'aba',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'aba'");
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS code TEXT UNIQUE');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS department_code TEXT');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS file_data BYTEA');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS duplicate_report_data BYTEA');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS pd_number TEXT');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS submitted_email TEXT');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES reviewers(id)');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS stage TEXT');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ');
    await client.query("UPDATE batch_archives SET stage = COALESCE(stage, 'submitted')");
    await client.query("ALTER TABLE batch_archives ALTER COLUMN stage SET DEFAULT 'submitted'");
    await client.query('ALTER TABLE batch_archives ALTER COLUMN stage SET NOT NULL');
    await client.query('ALTER TABLE batch_archives DROP CONSTRAINT IF EXISTS batch_archives_stage_check');
    await client.query(`
      ALTER TABLE batch_archives
      ADD CONSTRAINT batch_archives_stage_check CHECK (stage IN ('submitted','approved','rejected'))
    `);
    await client.query('UPDATE batch_archives SET stage_updated_at = COALESCE(stage_updated_at, created_at)');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS root_batch_id UUID');
    await client.query("UPDATE batch_archives SET root_batch_id = COALESCE(root_batch_id, batch_id)");
    await client.query('ALTER TABLE batch_archives ALTER COLUMN root_batch_id SET NOT NULL');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE batch_archives ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_root_batch_id ON batch_archives(root_batch_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_submitted_by ON batch_archives(submitted_by)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_stage_updated_at ON batch_archives(stage, stage_updated_at DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_archives_history (
        id SERIAL PRIMARY KEY,
        batch_id UUID NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        checksum TEXT,
        duplicate_report_path TEXT,
        transactions JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        code TEXT UNIQUE,
        department_code TEXT,
        file_data BYTEA,
        duplicate_report_data BYTEA,
        pd_number TEXT,
        submitted_email TEXT,
        submitted_by UUID REFERENCES reviewers(id),
        stage TEXT NOT NULL DEFAULT 'submitted'
          CHECK (stage IN ('submitted','approved','rejected')),
        stage_updated_at TIMESTAMPTZ,
        root_batch_id UUID NOT NULL,
        is_draft BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMPTZ,
        workflow_type TEXT NOT NULL DEFAULT 'aba',
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE batch_archives_history ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'aba'");
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_history_root_batch_id ON batch_archives_history(root_batch_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_history_stage_updated_at ON batch_archives_history(stage, stage_updated_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_archives_history_created_at ON batch_archives_history(created_at DESC)');
    await client.query(`
      CREATE OR REPLACE VIEW combined_batch_archives AS
      SELECT
        id,
        batch_id,
        file_name,
        file_path,
        checksum,
        duplicate_report_path,
        transactions,
        created_at,
        code,
        department_code,
        file_data,
        duplicate_report_data,
        pd_number,
        submitted_email,
        submitted_by,
        stage,
        stage_updated_at,
        root_batch_id,
        is_draft,
        deleted_at,
        NULL::TIMESTAMPTZ AS archived_at,
        FALSE AS from_history,
        workflow_type
      FROM batch_archives
      UNION ALL
      SELECT
        id,
        batch_id,
        file_name,
        file_path,
        checksum,
        duplicate_report_path,
        transactions,
        created_at,
        code,
        department_code,
        file_data,
        duplicate_report_data,
        pd_number,
        submitted_email,
        submitted_by,
        stage,
        stage_updated_at,
        root_batch_id,
        is_draft,
        deleted_at,
        archived_at,
        TRUE AS from_history,
        workflow_type
      FROM batch_archives_history;
    `);

    // Signup requests table for pending user registrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS signup_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        department_code TEXT,
        requested_role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewer_id UUID REFERENCES reviewers(id),
        review_comment TEXT
      );
    `);
    await client.query("ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS requested_role TEXT NOT NULL DEFAULT 'user'");
    // Which apps the person asked for. Supersedes requested_role as the thing
    // being requested; the role is what the approving admin assigns.
    await client.query("ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS requested_apps TEXT[] NOT NULL DEFAULT '{}'");

    // Password reset tokens for self-service password reset
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        reviewer_id UUID PRIMARY KEY REFERENCES reviewers(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // SFTP sync requests for triggering manual sync operations
    await client.query(`
      CREATE TABLE IF NOT EXISTS sftp_sync_requests (
        id SERIAL PRIMARY KEY,
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        requested_by UUID REFERENCES reviewers(id),
        requester_email TEXT,
        requester_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        files_synced INTEGER,
        notes TEXT
      );
    `);
    await client.query('ALTER TABLE sftp_sync_requests ADD COLUMN IF NOT EXISTS requester_name TEXT');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sftp_sync_requests_status ON sftp_sync_requests(status, requested_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sftp_sync_requests_completed_at ON sftp_sync_requests(completed_at DESC)');

    // SMTP settings for runtime email configuration
    await client.query(`
      CREATE TABLE IF NOT EXISTS smtp_settings (
        id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure BOOLEAN NOT NULL DEFAULT FALSE,
        smtp_user TEXT,
        smtp_pass_encrypted TEXT,
        from_email TEXT NOT NULL,
        reply_to_email TEXT,
        support_email TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by UUID REFERENCES reviewers(id)
      );
    `);
    await client.query('ALTER TABLE smtp_settings ADD COLUMN IF NOT EXISTS support_email TEXT');

    await client.query(`
      CREATE TABLE IF NOT EXISTS department_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        department_code TEXT NOT NULL,
        division_code TEXT NOT NULL DEFAULT '00',
        name TEXT,
        allowed_bank_presets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (department_code, division_code)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_department_profiles_code ON department_profiles(department_code, division_code)');

    // Seed department profiles from existing reviewers so every known department has a profile.
    // Default division is '00' and default allowed preset is CBA-RON; admins can edit later.
    await client.query(`
      INSERT INTO department_profiles (department_code, division_code, name, allowed_bank_presets)
      SELECT DISTINCT r.department_code, '00', 'Department ' || r.department_code, ARRAY['CBA-RON']::TEXT[]
        FROM reviewers r
       WHERE r.department_code IS NOT NULL
         AND r.department_code <> ''
         AND NOT EXISTS (
           SELECT 1 FROM department_profiles dp
            WHERE dp.department_code = r.department_code
              AND dp.division_code = '00'
         )
      ON CONFLICT (department_code, division_code) DO NOTHING
    `);

    // FOREX Telegraphic Transfer module
    await client.query(`
      CREATE TABLE IF NOT EXISTS forex_tt_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id TEXT NOT NULL UNIQUE,
        root_request_id UUID NOT NULL DEFAULT gen_random_uuid(),
        submitted_by UUID REFERENCES reviewers(id),
        department_code TEXT,
        division_code TEXT NOT NULL DEFAULT '00',
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','submitted','claimed','processing','needs_changes','approved','cancelled')),
        version INTEGER NOT NULL DEFAULT 1,
        form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        bank_confirmation TEXT,
        claimed_by UUID REFERENCES reviewers(id),
        claimed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);
    // Existing installations may predate the bank confirmation field.
    await client.query('ALTER TABLE forex_tt_requests ADD COLUMN IF NOT EXISTS bank_confirmation TEXT');
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_requests_root ON forex_tt_requests(root_request_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_requests_submitted_by ON forex_tt_requests(submitted_by)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_requests_status ON forex_tt_requests(status, updated_at DESC)');
    // Ensure existing tables get the default and any orphaned rows are backfilled.
    await client.query('ALTER TABLE forex_tt_requests ALTER COLUMN root_request_id SET DEFAULT gen_random_uuid()');
    await client.query('UPDATE forex_tt_requests SET root_request_id = id WHERE root_request_id IS NULL');

    await client.query(`
      CREATE TABLE IF NOT EXISTS forex_tt_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL REFERENCES forex_tt_requests(id) ON DELETE CASCADE,
        reviewer TEXT NOT NULL,
        actor_id UUID REFERENCES reviewers(id),
        status TEXT NOT NULL,
        comments TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_reviews_request_id ON forex_tt_reviews(request_id)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS forex_tt_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL REFERENCES forex_tt_requests(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_data BYTEA NOT NULL,
        checksum TEXT NOT NULL,
        superseded_at TIMESTAMPTZ,
        uploaded_by UUID REFERENCES reviewers(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_attachments_request_id ON forex_tt_attachments(request_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_forex_tt_attachments_category ON forex_tt_attachments(request_id, category) WHERE superseded_at IS NULL');

    // Public Health Allowance module
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_health_tiers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT NOT NULL UNIQUE CHECK (code IN ('LV0','LV1','LV2','LV3')),
        label TEXT NOT NULL,
        monthly_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE public_health_tiers DROP CONSTRAINT IF EXISTS public_health_tiers_code_check');
    await client.query(`
      ALTER TABLE public_health_tiers
        ADD CONSTRAINT public_health_tiers_code_check CHECK (code IN ('LV0','LV1','LV2','LV3'))
    `);
    await client.query(`
      INSERT INTO public_health_tiers (code, label, monthly_amount, sort_order, description)
      VALUES
        ('LV0', 'Level 0', 0, 0, 'Demoted from LV1, no payment'),
        ('LV1', 'Level 1', 0, 1, 'Base allowance'),
        ('LV2', 'Level 2', 0, 2, 'First milestone increment'),
        ('LV3', 'Level 3', 0, 3, 'Second milestone increment and ongoing monitoring')
      ON CONFLICT (code) DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public_health_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        bank_bsb VARCHAR(7),
        bank_account_enc TEXT,
        bank_account_name TEXT,
        village TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        external_ref TEXT,
        created_by UUID REFERENCES reviewers(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE public_health_participants ADD COLUMN IF NOT EXISTS village TEXT');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_ph_participants_ext_ref ON public_health_participants(external_ref) WHERE external_ref IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ph_participants_status ON public_health_participants(status)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public_health_participant_levels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        participant_id UUID NOT NULL REFERENCES public_health_participants(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('LV0','LV1','LV2','LV3')),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ,
        reason TEXT,
        notes TEXT,
        created_by UUID REFERENCES reviewers(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE public_health_participant_levels DROP CONSTRAINT IF EXISTS public_health_participant_levels_level_check');
    await client.query(`
      ALTER TABLE public_health_participant_levels
        ADD CONSTRAINT public_health_participant_levels_level_check CHECK (level IN ('LV0','LV1','LV2','LV3'))
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_ph_levels_participant ON public_health_participant_levels(participant_id, effective_from DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public_health_pay_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paid_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
        aba_batch_id UUID,
        created_by UUID REFERENCES reviewers(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE public_health_pay_periods ADD COLUMN IF NOT EXISTS paid_date DATE');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ph_periods_status ON public_health_pay_periods(status, created_at DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public_health_period_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES public_health_pay_periods(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES public_health_participants(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('LV0','LV1','LV2','LV3')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (period_id, participant_id)
      );
    `);
    await client.query('ALTER TABLE public_health_period_entries DROP CONSTRAINT IF EXISTS public_health_period_entries_level_check');
    await client.query(`
      ALTER TABLE public_health_period_entries
        ADD CONSTRAINT public_health_period_entries_level_check CHECK (level IN ('LV0','LV1','LV2','LV3'))
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_ph_entries_period ON public_health_period_entries(period_id)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        actor_id UUID REFERENCES reviewers(id),
        actor_email TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before JSONB,
        after JSONB,
        metadata JSONB DEFAULT '{}'::jsonb,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, created_at DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        ip TEXT,
        successful BOOLEAN NOT NULL DEFAULT FALSE,
        attempted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // ===== Leave & HR =====
    // Employment record, kept separate from the `reviewers` identity so the org
    // chart stays out of the auth table and so staff can hold leave records
    // without a portal login (reviewer_id nullable).
    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reviewer_id UUID UNIQUE REFERENCES reviewers(id) ON DELETE SET NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        manager_id UUID REFERENCES hr_employees(id) ON DELETE SET NULL,
        department_code TEXT,
        join_date DATE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_employees_manager ON hr_employees(manager_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_employees_reviewer ON hr_employees(reviewer_id)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_leave_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        default_days NUMERIC(6,2) NOT NULL DEFAULT 0,
        is_accruable BOOLEAN NOT NULL DEFAULT FALSE,
        requires_note BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Accrual and reset rules, configurable per leave type. Accruable types
    // earn `accrual_days_per_fortnight` on each fortnightly pay run instead of
    // being granted `default_days` upfront; `reset_period` decides whether an
    // unused balance is forfeited at the end of the financial year, on the
    // employee's service anniversary, or never.
    await client.query('ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS accrual_days_per_fortnight NUMERIC(6,2) NOT NULL DEFAULT 0');
    await client.query("ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS reset_period TEXT NOT NULL DEFAULT 'none'");
    await client.query('ALTER TABLE hr_leave_types DROP CONSTRAINT IF EXISTS hr_leave_types_reset_period_check');
    await client.query("ALTER TABLE hr_leave_types ADD CONSTRAINT hr_leave_types_reset_period_check CHECK (reset_period IN ('none','financial_year','anniversary'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_leave_balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id) ON DELETE CASCADE,
        balance NUMERIC(6,2) NOT NULL DEFAULT 0,
        pending NUMERIC(6,2) NOT NULL DEFAULT 0,
        year INT NOT NULL,
        UNIQUE (employee_id, leave_type_id, year)
      );
    `);
    await client.query('ALTER TABLE hr_leave_balances ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ');

    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_leave_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days NUMERIC(6,2) NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
        attachment TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archived_at TIMESTAMPTZ,
        reviewed_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        reviewer_note TEXT
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_leave_apps_employee_status ON hr_leave_applications(employee_id, status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_leave_apps_status_dates ON hr_leave_applications(status, start_date, end_date)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_leave_apps_employee_applied ON hr_leave_applications(employee_id, applied_at DESC)');

    // Manual balance corrections. reason is required: every adjustment must say why.
    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_leave_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id) ON DELETE CASCADE,
        amount NUMERIC(6,2) NOT NULL,
        reason TEXT NOT NULL,
        adjusted_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_hr_leave_adjustments_employee ON hr_leave_adjustments(employee_id)');

    // One row per completed accrual run, keyed by period end so a fortnight is
    // never credited twice. `credited` records how many balances were updated.
    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_accrual_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_end DATE NOT NULL UNIQUE,
        credited INT NOT NULL DEFAULT 0,
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_by UUID REFERENCES reviewers(id) ON DELETE SET NULL
      );
    `);

    // Seed the standard Naoero Treasury leave types (no-op once present).
    await client.query(`
      INSERT INTO hr_leave_types (name, description, default_days, is_accruable, requires_note)
      VALUES
        ('Annual',        'Annual recreation leave',            20, TRUE,  FALSE),
        ('Sick',          'Personal illness',                   10, FALSE, TRUE),
        ('Compassionate', 'Bereavement and family emergency',    5, FALSE, TRUE),
        ('Special',       'Approved special leave',              5, FALSE, TRUE),
        ('Official',      'Official duty travel',                0, FALSE, FALSE),
        ('Leave Without Pay', 'Unpaid leave',                    0, FALSE, TRUE)
      ON CONFLICT (name) DO NOTHING
    `);

    // Sick leave actually splits into two policy-distinct entitlements; the
    // combined 'Sick' type above predates that and is retired below rather
    // than deleted, so historical applications against it stay intact.
    await client.query(`
      INSERT INTO hr_leave_types (name, description, default_days, is_accruable, requires_note)
      VALUES
        ('Sick (with MC)',    'Personal illness, medical certificate provided', 7, FALSE, TRUE),
        ('Sick (without MC)', 'Personal illness, no medical certificate',       3, FALSE, TRUE),
        ('Furlough',          'Long-service leave',                            0, FALSE, FALSE)
      ON CONFLICT (name) DO NOTHING
    `);
    await client.query(`UPDATE hr_leave_types SET is_active = FALSE WHERE name = 'Sick'`);

    await client.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_email_attempted ON login_attempts(email, attempted_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at)');

    await backfillCapabilities(client);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to initialise schema', error);
    throw error;
  } finally {
    client.release();
  }
}
