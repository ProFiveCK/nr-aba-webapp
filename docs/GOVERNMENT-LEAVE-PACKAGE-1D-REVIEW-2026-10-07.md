# Package 1D — department and division access

Date: 7 October 2026. Status: implemented and verified locally; ready for owner review. No push, PR or deployment.

Central HR can assign individual accounts access to a whole department or one division, with separate rights, inclusive effective dates and a verification reason. The API checks current managed organisation IDs before listing or changing records. Names, URL filters and guessed employee/application IDs cannot widen a grant.

## Local review

- [Central HR preview](http://127.0.0.1:5173/api/local-preview): choose **Staff → HR access**. Inspect active and revoked assignments, then **Assign HR access** to review the individual-account picker, department/division, dates, rights and reason.
- [Departmental HR preview](http://127.0.0.1:5173/api/local-scoped-preview): opens the synthetic Finance/Treasury account. Inspect **Employees**, **Balances** and **Report**. Central import, organisation, identity and access-assignment actions are absent.

These shortcuts change the login in that browser. Use the central shortcut again to return to central HR. They are temporary loopback-only review tools outside application code, using the separate PostgreSQL preview database; they do not send email or create a production login bypass. Earlier review/import data is retained. Restart details remain in the [Package 1B guide](GOVERNMENT-LEAVE-PAYROLL-IMPORT-2026-10-07.md).

Suggested checks:

1. In central **HR access**, find **Synthetic Scoped HR Officer** (`local-scoped-hr@example.test`). Its retained active assignment grants Staff records, Balance corrections and Reports/personnel PDFs for Finance/Treasury. Supporting evidence and leave decisions are separate, unchecked rights. Assignment history includes the browser-tested revocation.
2. Switch to the departmental preview. Search **DEMO-1D-SUBJECT**, then manage **Synthetic 1D Scope Test Employee**. Details and a reporting manager within scope can be edited. Status, verified identity/login, transfers and service-period changes remain central HR actions.
3. Search exact ID **DEMO-1D-OUTSIDE**. It returns no record. Changing a department filter or requesting its profile directly also cannot retrieve it.
4. Open **Balances**. Only assigned employees appear. Inspect a correction and its required reason; export the scoped CSV. Synthetic browser corrections are retained in the adjustment history. These historical balances are not certified government openings or the new government policy calculations.
5. Open **Report** for 1–31 October 2026. The dedicated in-scope synthetic report employee appears; the synthetic Health/Hospital employee does not. Two approved applications were seeded solely as access-isolation fixtures; no entitlement decision or payroll action was performed.
6. At a narrow mobile width, check employee search, assignment dialog and balances. Blue primary buttons retain the earlier readable hover treatment.
7. Revoking an assignment ends that account's existing sessions. The user must sign in again and receives only any other still-effective rights. To restore this synthetic departmental demonstration, use central HR to assign the same three rights again.

## Rights and boundaries

| Right | Department/division scope permits | Central HR additionally controls |
| --- | --- | --- |
| Staff records | Paginated directory, scoped historical list/profile, whitelisted details and reporting line | Creation, deletion, Payroll import, exact IDs, verified links/provisioning, placement, employment status, service periods and eligibility |
| Leave decisions | Current scoped approval queue and legacy decisions where permitted; government staged grants remain gated | Enterprise office appointments and global policy configuration; Package 3 must enforce the Chief Secretary final chain |
| Balance corrections | Assigned employees' balances, audited signed correction and scoped balance CSV | Certified opening migration and accrual/configuration tools |
| Reports and personnel PDFs | Assigned employee report rows, report CSV and approved personnel PDFs | Government-wide reports and oversight |
| Supporting evidence | Current assigned applicants' attachment downloads and approval-queue attachment metadata | Government-wide evidence access |

Central `hr_admin` retains government-wide HR access, including the existing portal administrator role floor. Scoped assignments cannot grant central HR or finance rights. Explicit account permission denial still overrides a scoped capability. Officeholder appointments and data-access assignments are separate: neither creates the other. Chief Secretary's government-wide execution authority remains a Package 3 implementation task.

Applicants retain their own active linked employee documents. Existing legacy approvers may access verified direct reports only when the manager and employee currently share a managed department and division; that narrow reporting-line exception includes the evidence needed for a decision. Scoped approvers otherwise need the separate evidence right. A past deciding account alone does not preserve access after transfer or revocation. Calendar/team responses apply the same current staff/approval/reporting-line boundaries; manager names outside a staff assignment are concealed while their reference is preserved.

## Server enforcement and rollout preparation

- Scope dates use the Nauru calendar date and inclusive start/end dates. Future, expired and revoked assignments give no access. No organisation scope is inferred from legacy text labels.
- Active assignment capabilities are loaded with each authenticated request. Grant and revocation require central HR, remove the target account's sessions, preserve reasons/history and commit audit records atomically. An audit failure rolls back both the assignment and session deletion.
- Lists, counts, searches, joins and export source rows are restricted in SQL before pagination or response. Direct profile, attachment, PDF, balance and decision requests independently check current placement and rights. HR responses use `Cache-Control: no-store`.
- Employee details and balance writes recheck scope inside the transaction and lock current placement. Matching write grants are held until commit. A balance correction queued behind a department transfer is rejected after the transfer. Both management and direct historical manager edits reject reporting cycles under a stable lock order.
- Notification recipient selection checks current linked manager authority or falls back to central HR. No real notifications were sent during this work.
- Historical create/import/delete, identity/placement changes, policy/holiday writes, accrual and global oversight are central-only. Portal account administration remains a separate trusted administrator responsibility.

Before release, reconcile stable department/division IDs for existing employees and assign verified departmental rights. Legacy `hr_staff_manage` alone now gives an empty employee directory, not government-wide access. Balance and report access require their own rights. Do not automatically convert broad old permissions into department assignments or infer authority from a name. Rehearse this access transition against a scrubbed copy before activation.

## Verification and limits

The full real-PostgreSQL backend suite passes **262 tests** across **40 suites**, including 13 scope integration tests using actual HTTP routes, real sessions and database transactions. They cover sibling divisions, whole departments, unverified text-only placement, guessed IDs, separate rights, protected central actions, evidence metadata, applicants, verified managers, self-approval, past approvers, date boundaries, explicit denial, audit rollback, revocation, notification audiences, reporting cycles and a concurrent transfer/balance-write race.

Frontend lint and production build pass; **104 frontend tests pass**, with one existing skipped test. Actual desktop/mobile browser checks pass for central assignment/revocation, restricted departmental profile editing, a balance correction, scoped CSV and report isolation. Downloaded balance CSV contains only Finance/Treasury employees. Employee search, assignment dialog, balances and report have no page-width overflow at 390 pixels; no browser page errors occurred in the end-to-end review.

Employee/account/access-assignment searches are paginated. Balance matrices, report aggregates, central historical tools and existing portal account administration still use full response lists; response-size and concurrent workload acceptance remain outstanding. Synthetic 2,000-record fixtures from Packages 1A–1C do not establish 2,000 simultaneous-user or production readiness. Medical-document retention, operational account processes, native Payroll mapping, certified openings, backup recovery and production sizing still require rollout evidence.

Government employee submission and legacy final grant remain gated until Package 3 implements division → HOD → Chief Secretary execution and special statutory consents. Ordinary recreation remains the owner's three-month choice, temporary recreation remains twelve months, and intern designation remains separate; their calculations belong to Package 2.

The code graph service was unavailable during this work; owning source files were reviewed directly with API/database/browser verification. No exhaustive graph-coverage claim is made.

## Next build item

**Package 1E: controlled bulk onboarding, activation and offboarding.** Stage verified identities/accounts, provide safe individual activation and recovery, reconcile duplicates and existing users, and revoke access on termination or relinking. Select individual email, Payroll-ID login alias or SSO based on real employee coverage; preserve Payroll IDs as exact text and never use them as shared passwords. Keep government submission gated while onboarding is prepared.

See the [Package 1 structure and rollout plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md) and [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md).
