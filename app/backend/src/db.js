import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const useSSL = process.env.DB_SSL === 'true';

const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'aba',
    };

if (useSSL) {
  connectionConfig.ssl = { rejectUnauthorized: false };
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
        account VARCHAR(16) NOT NULL,
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
    await client.query('UPDATE blacklist_entries SET active = COALESCE(active, TRUE)');

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
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS department_code TEXT');
    await client.query('ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS notify_on_submission BOOLEAN DEFAULT TRUE');
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

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to initialise schema', error);
    throw error;
  } finally {
    client.release();
  }
}
