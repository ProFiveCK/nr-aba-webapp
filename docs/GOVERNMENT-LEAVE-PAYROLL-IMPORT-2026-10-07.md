# Package 1B — Payroll employee import and reconciliation

Date: 7 October 2026. Status: implemented and verified locally with synthetic data. No push, PR, deployment, real Payroll exchange or government activation.

This follows Package 1A's identity and organisation foundation. Central HR can stage a Payroll employee CSV, review exact ID matches and possible duplicates, record identity/skip decisions, and apply an audited batch. Employee identity and appointment data are separate from login provisioning and certified opening leave balances.

## Local review

Open [the synthetic HR preview](http://127.0.0.1:5173/api/local-preview), then choose **Staff → Payroll import** in the Package 1C employee-management navigation. The preview uses a separate PostgreSQL container (`ron-leave-import-preview-20261007`, loopback port 55435). Its disposable launch harness is `/tmp/leave-package-1b-preview.mjs`; it is outside the repository and binds only to loopback. Its sample login and records are synthetic. The preview shortcut is not part of the application or production authentication.

Download [the synthetic sample CSV](http://127.0.0.1:5173/api/local-payroll-sample). Set the export date to **2026-10-07**, select the sample, and choose **Preview export**. Initially it contains an exact ID update, a new temporary intern, a possible duplicate name and an invalid status. Review the possible duplicate, record an identity decision, and skip the invalid row with a reason. The final apply requires a batch review note, acknowledgement and confirmation. Reload a saved batch to inspect the retained decisions and outcome. Uploading identical content for the same export date resumes that batch, including its applied result.

If the local processes stop, start the named preview container, run `node /tmp/leave-package-1b-preview.mjs` from `/tmp`, and run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` in this worktree's `app/client`. These processes use the disposable database. They do not load production configuration.

## Version 1 CSV contract

Download the header template from the import screen. Use UTF-8 CSV, at most **2 MiB and 3,000 employee rows**. Every row represents one current appointment for one employee. Preserve source IDs as text before export; zeros already removed by a spreadsheet cannot be reconstructed. Quoted fields, commas, escaped quotes, a UTF-8 BOM and ordinary CSV line endings are supported. Unsupported or duplicated headers and malformed quoting reject the file; invalid row values are visible review issues.

| Column | Requirement and meaning |
| --- | --- |
| `payroll_employee_id` | Required exact text, 1–100 characters. Case and leading zeros are significant. Verified source is `techone_payroll`. |
| `display_name` | Required, up to 200 characters. A name or email suggests possible matches; it never proves ownership or automatically merges employees. |
| `status` | Required: `active` or `inactive`, lowercase. An explicit status change revokes linked sessions. Missing employees are not deactivated. |
| `department_name` | Required, up to 60 characters; matches an existing managed department name, ignoring case. Prepare the crosswalk before upload. |
| `division_name` | Optional existing division within the selected department. Blank means no division; it clears an existing current division. |
| `email` | Optional individual contact email. Blank preserves an existing contact. An employee linked to a login retains its verified email; account changes require separate verification. |
| `position_title` | Optional; blank preserves an existing title. |
| `employment_category` | If appointment data is supplied: `permanent`, `probationary`, `temporary`, `contract`, `casual` or `unknown`. `unknown` is a review warning, not an entitlement decision. |
| `appointment_start` | Required if any appointment field is supplied. Real `YYYY-MM-DD` date. It is the appointment period start, not automatically the original hire or continuous-service date. |
| `appointment_end` | Optional real `YYYY-MM-DD`, inclusive, no earlier than start; blank is an open period. |
| `is_teacher`, `is_intern` | Optional `true`/`false`, lowercase; blank means false for the imported period. Intern designation is independent of category. Confirm these flags from appointment evidence. |
| `counts_for_service` | Optional `true`/`false`; blank records **unknown**, not zero or qualifying service. HR must determine service credit before policy activation. |
| `appointment_reference` | Optional appointment evidence reference, up to 200 characters. |
| `work_pattern_name` | Optional existing approved pattern name, ignoring case. No schedule is invented. |
| `manager_payroll_id` | Optional exact Payroll ID. Resolves against selected batch rows or existing verified IDs. Blank preserves an existing manager. Self-management and reporting cycles block apply. Reporting managers do not automatically become leave approvers. |

The original TechnologyOne export has not been supplied. Version 1 is the portal's canonical contract; native export header/code mapping remains to verify against that file. There is no live TechnologyOne connection, XLSX reader, automatic organisation creation, appointment-history rewrite or balance import in this flow. Do not add passwords, pay rates or opening balances to this CSV.

## Review and application controls

Exact verified Payroll IDs select the existing portal UUID. Unknown IDs with a possible name/email match, or repeated names within the file, require an explicit HR choice: match a verified existing person, confirm a distinct new employee, or skip. A verified ID cannot be moved to another person through import. Multiple selected rows targeting one employee block the batch; keep legitimate additional source IDs through explicit reconciliation rather than inventing multiple employees.

Departments, divisions and work patterns must already exist. Differing overlapping service periods block application; an identical complete service period is retained. Resolve or close history through the Package 1C employee-management screen and preview again. Rows with missing appointment history can prepare an employee record but carry a policy-readiness warning. No current leave eligibility, accrual rule or approval grant is calculated here. The ordinary recreation three-month and temporary twelve-month rules remain Package 2 configuration work.

HR row decisions require a reason of 10–1,000 characters. Invalid source values cannot be edited into valid values in the preview: correct the CSV and upload it again, or explicitly skip the affected row. A duplicate Payroll ID in the file marks all its rows invalid; correct that file before selecting one authoritative row.

Preview writes only review-batch metadata, input rows and its audit entry. Apply rechecks the live employee, IDs, service records, current manager and referenced organisation/pattern data against the saved review snapshot. Changed data blocks application until refresh and review. Two reviewers cannot overwrite each other's revisions. A newly discovered possible duplicate still needs an explicit decision after refresh.

Apply runs in one PostgreSQL transaction. All unresolved rows block the entire batch; skipped rows retain their data and reasons. Profile changes, verified IDs, new service periods, manager links, status-session revocation and audit records commit together. An audit failure rolls everything back. Existing UUIDs, accounts, original `join_date`, leave eligibility, balances, applications and approved PDFs remain intact. No missing-row deletion/deactivation or automatic account creation occurs.

The batch retains contract version, file fingerprint, export date, filename, creator, row decisions/verifiers/reasons, revision, apply reviewer/note/time and saved result. Identical source content/date returns the same batch; repeated or simultaneous apply returns the saved result. A reordered/corrected file can create a new review batch; exact ID matching and identical-period checks prevent duplicate identities or service records. Result counters describe created/updated/unchanged employee profiles, skipped rows and added service periods.

The API and screen require **central `hr_admin` permission**. Package 1D now provides scoped departmental records; Payroll import remains central-only. Import rows are paginated at 50 and batch history at 20; Package 1C now provides the default paginated central-HR directory; scoped staff now use that directory too; balance matrices and central historical tools retain full response lists. Apply conservatively locks the small employee master in UUID order while validating reporting lines, plus referenced organisation tables. This can briefly delay other employee writes; run large preparation batches during a controlled window and measure contention in the later mixed-workload capacity test.

## Verification and next item

The full real-PostgreSQL suite passes **241 backend tests**. Import coverage includes strict CSV parsing, preview isolation, text IDs, exact matches, explicit duplicate review, invalid/skipped rows, stale snapshots and revisions, service overlaps, retained periods, same-batch managers/cycles, offboarding-session revocation, actual audit-insert failure rollback, central-HR HTTP gates and idempotent concurrent apply. A 2,000-person synthetic preview/pagination/application test passes. This verifies a bounded batch, not 2,000 concurrent sign-ins or production performance.

Frontend lint and production build pass; **103 frontend tests pass**, with one existing skipped test. A real desktop/mobile browser exercise verifies preview, identity decisions, skip reasons, review acknowledgement, confirmation and application outcome, with no browser errors or page-width overflow at 390 pixels.

**Package 1C management UI is now implemented locally.** See the [Package 1C review guide](GOVERNMENT-LEAVE-PACKAGE-1C-REVIEW-2026-10-07.md) for the paginated directory, verified account selector, service/placement review and dated division/HOD/Chief Secretary management. Package 1D access scopes are now implemented locally; see the [scoped-access guide](GOVERNMENT-LEAVE-PACKAGE-1D-REVIEW-2026-10-07.md). Next complete Package 1E controlled onboarding, including the email coverage/Payroll-ID alias decision. Government submission remains gated until the staged workflow is implemented and rollout criteria pass.
