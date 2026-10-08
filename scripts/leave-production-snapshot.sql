-- Read-only counts and hashes of retained Finance data, before and after schema upgrade.
-- Fixed original columns deliberately exclude new Government foundations.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT json_build_object('table', 'hr_employees', 'rows', count(*),
  'hash', md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')))
FROM (SELECT md5(row_to_json(retained)::text) AS row_hash
  FROM (SELECT id, reviewer_id, display_name, email, manager_id, department_code, join_date, status, created_at, updated_at, leave_entitled, daily_rate, position_title, division_code, ineligible_reason, study_leave_start, study_leave_end, eligibility_note FROM hr_employees) retained) records;
SELECT json_build_object('table', 'hr_leave_balances', 'rows', count(*),
  'hash', md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')))
FROM (SELECT md5(row_to_json(retained)::text) AS row_hash
  FROM (SELECT id, employee_id, leave_type_id, balance, pending, year, last_reset_at FROM hr_leave_balances) retained) records;
SELECT json_build_object('table', 'hr_leave_applications', 'rows', count(*),
  'hash', md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')))
FROM (SELECT md5(row_to_json(retained)::text) AS row_hash
  FROM (SELECT id, employee_id, leave_type_id, start_date, end_date, days, reason, status, attachment, applied_at, updated_at, archived_at, reviewed_by, reviewed_at, reviewer_note, payroll_form_snapshot FROM hr_leave_applications) retained) records;
SELECT json_build_object('table', 'hr_leave_types', 'rows', count(*),
  'hash', md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')))
FROM (SELECT md5(row_to_json(retained)::text) AS row_hash
  FROM (SELECT id, name, description, default_days, is_accruable, requires_note, is_active, created_at, accrual_days_per_fortnight, reset_period, max_balance, requires_attachment, attachment_label FROM hr_leave_types) retained) records;
COMMIT;
