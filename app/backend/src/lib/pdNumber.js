/**
 * A PD number may be paid once. Batches are compared by the digits of their
 * PD, so "PD 123456" and "123456" are the same payment. A resubmission (same
 * root_batch_id) may reuse its PD; rejected batches and drafts do not hold one.
 *
 * Returns the conflicting batch, or null.
 */
export async function findPdConflict(db, pdNumber, rootBatchId = null) {
  const digits = String(pdNumber || '').replace(/\D/g, '');
  const params = digits ? [digits] : [String(pdNumber || '').trim()];
  let sql = `
    SELECT code, stage, department_code, root_batch_id, is_draft
      FROM combined_batch_archives
     WHERE ${digits ? "REGEXP_REPLACE(COALESCE(pd_number, ''), '\\D', '', 'g')" : 'TRIM(pd_number)'} = $1
       AND COALESCE(is_draft, FALSE) = FALSE
       AND stage <> 'rejected'`;
  if (rootBatchId) {
    sql += ' AND root_batch_id <> $2';
    params.push(rootBatchId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 1';
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}
