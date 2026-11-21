import { addHeadingIds } from '../lib/policyHtml.js';

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
 *
 * Categories organise the library: manuals and their sections, tagged on
 * documents (see below).
 */
export async function initPolicySchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
      title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
      doc_type TEXT NOT NULL,
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

  // How the library is organised: manuals (top level) holding sections, two
  // levels and no more. A document is tagged with any number of them.
  // Publishers maintain the list; editors pick from it.
  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id UUID REFERENCES policy_categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (parent_id IS DISTINCT FROM id)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_categories_name
    ON policy_categories (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_document_categories (
      document_id UUID NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
      category_id UUID NOT NULL REFERENCES policy_categories(id) ON DELETE RESTRICT,
      PRIMARY KEY (document_id, category_id)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_policy_document_categories_category ON policy_document_categories (category_id)');

  // The first release typed a free-text category on each document. Each
  // distinct one becomes a top-level category tagged on the documents that
  // used it, and the column goes. Nothing to do once it has gone.
  const { rows: [freeText] } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'policy_documents' AND column_name = 'category'`);
  if (freeText) {
    await client.query(`
      INSERT INTO policy_categories (name, sort_order)
      SELECT name, row_number() OVER (ORDER BY lower(name))::int
        FROM (SELECT DISTINCT ON (lower(btrim(category))) btrim(category) AS name
                FROM policy_documents WHERE btrim(coalesce(category, '')) <> ''
               -- Of "Payments" and "payments", keep the capitalised one, whatever the database's collation.
               ORDER BY lower(btrim(category)), btrim(category) COLLATE "C") used
      ON CONFLICT DO NOTHING`);
    await client.query(`
      INSERT INTO policy_document_categories (document_id, category_id)
      SELECT d.id, c.id FROM policy_documents d
        JOIN policy_categories c ON c.parent_id IS NULL AND lower(btrim(c.name)) = lower(btrim(d.category))
      ON CONFLICT DO NOTHING`);
    await client.query('ALTER TABLE policy_documents DROP COLUMN category');
  }
}

/** The addresses older stored bodies lack: one quiet pass, idempotent by construction. */
export async function addMissingPolicyHeadingIds(client) {
  const { rows: versions } = await client.query('SELECT id, body_html FROM policy_versions');
  let changed = 0;
  for (const version of versions) {
    const body = addHeadingIds(version.body_html);
    if (body !== version.body_html) {
      await client.query('UPDATE policy_versions SET body_html = $2 WHERE id = $1', [version.id, body]);
      changed += 1;
    }
  }
  if (changed) console.log(`[policies] Added section addresses to ${changed} stored version(s).`);
}
