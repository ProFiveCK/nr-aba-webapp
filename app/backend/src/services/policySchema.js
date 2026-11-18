/**
 * Policies & Procedures tables.
 *
 * A document is the register entry: its code, title, kind and owner. Its text
 * lives in versions. A document has at most one draft, which editors change
 * freely, and at most one published version, which nobody changes: publishing
 * a draft turns the old published version into a superseded one, so every
 * wording that was ever in force can still be read.
 *
 * Files are stored as bytes in the database, like leave attachments, so a
 * backup of the database is a complete library.
 */
export async function initPolicySchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
      title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
      doc_type TEXT NOT NULL,
      category TEXT,
      department_id UUID REFERENCES hr_departments(id) ON DELETE SET NULL,
      review_due DATE,
      retired_at TIMESTAMPTZ,
      retired_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      retired_reason TEXT,
      created_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_documents_code ON policy_documents (lower(btrim(code)))');

  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
      version_no INT NOT NULL CHECK (version_no > 0),
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
      body_html TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      file_ids UUID[] NOT NULL DEFAULT '{}',
      change_summary TEXT,
      revision INT NOT NULL DEFAULT 1,
      created_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      published_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      UNIQUE (document_id, version_no),
      CHECK ((status = 'draft') = (published_at IS NULL))
    )
  `);
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_one_draft ON policy_versions (document_id) WHERE status = 'draft'");
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_one_published ON policy_versions (document_id) WHERE status = 'published'");

  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INT NOT NULL,
      file_data BYTEA NOT NULL,
      checksum TEXT NOT NULL,
      uploaded_by UUID REFERENCES reviewers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_policy_files_document ON policy_files (document_id)');
}
