import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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
    await client.query('ALTER TABLE reviewers DROP CONSTRAINT IF EXISTS reviewers_role_check');
    await client.query(`
      ALTER TABLE reviewers
      ADD CONSTRAINT reviewers_role_check CHECK (role IN ('user','banking','reviewer','admin','payroll'))
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
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
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
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
        FALSE AS from_history
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
        TRUE AS from_history
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
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewer_id UUID REFERENCES reviewers(id),
        review_comment TEXT
      );
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        ip TEXT,
        successful BOOLEAN NOT NULL DEFAULT FALSE,
        attempted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_email_attempted ON login_attempts(email, attempted_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at)');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to initialise schema', error);
    throw error;
  } finally {
    client.release();
  }
}
