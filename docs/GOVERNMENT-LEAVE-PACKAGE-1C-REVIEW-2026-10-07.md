# Package 1C — employee and enterprise structure management

Date: 7 October 2026. Status: implemented and verified locally; awaiting owner review. Package 1B was checked by the owner and confirmed working. No push, PR or deployment.

Central HR now has an employee-management screen for preparing the government Leave population and its division → Head of Department → Chief Secretary approval structure. Employee identities, login accounts, service facts and office appointments remain separate records. The primary Payroll import buttons now keep a dark-blue background and readable white text on hover.

## Local review

Open [the local synthetic preview](http://127.0.0.1:5173/api/local-preview). It opens **Leave → Staff** using the existing disposable HR preview. Earlier local review/import data has been retained; synthetic 1C examples were added without resetting the database.

| Navigation | What to check |
| --- | --- |
| Employees | Server pages of 50; name or exact Payroll ID search; department/status filters; missing ID, login, placement, current service facts and work-pattern filters. |
| Manage an employee | Details/status, reporting manager, verified placement, exact Payroll IDs, verified login link/history, dated service periods and approval route preview. |
| Add verified employee | Requires a Payroll ID, managed department and verification reason. Creates a distinct employee record without creating a login or leave balance. Use import reconciliation for possible duplicates. |
| Payroll import | Existing Package 1B staging, reconciliation and reviewed apply. Hover the enabled blue buttons to check the contrast fix. |
| Organisation & approvers | Managed departments/divisions, dated division/HOD/Chief Secretary appointments and approved weekly work patterns. |
| Historical balances & tools | Existing staff/balance tools remain available explicitly. Their full-list API has not been converted by 1C. |

Suggested review:

1. Find **Synthetic 1C Browser Employee**, or search exact Payroll ID **DEMO-1C-BROWSER**. Open **Manage**.
2. Inspect its verified login and two temporary-intern appointment periods. The first ends on 30 September; the replacement begins on 1 October. Service credit remains unknown pending an HR determination.
3. Open **Edit details**, **Verify placement** and **Link/Change verified login**. Cancel if inspecting only. Manager and account choices use server pages of 50, with explicit selection; a matching name does not claim a record. Account choices distinguish employee-only and existing staff logins.
4. Inspect **Approval route preview** for **2026-10-07**. The synthetic Finance/Treasury route has three active configured authorities. The preview does not approve an application or calculate entitlement.
5. Open **Organisation & approvers**. Inspect the synthetic division, Finance HOD and government-wide Chief Secretary appointments, including dates and authority reasons. In **Assign officeholder**, changing to Chief Secretary removes department/division scope fields.
6. Inspect **Synthetic 1C Week**. New patterns require explicit weekdays and optional daily hours; no schedule or credited service is assumed.
7. Check the same screens at a narrow mobile width. Primary buttons retain readable hover colours on desktop.

The preview runs only on loopback against the separate PostgreSQL container `ron-leave-import-preview-20261007` on port 55435. The temporary launch harness and login shortcut are outside application code; they use synthetic records and do not send email. If the processes stop, follow the restart instructions in the [Package 1B guide](GOVERNMENT-LEAVE-PAYROLL-IMPORT-2026-10-07.md).

## Implemented controls

- The default central-HR directory fetches one employee page, rather than the old entire employee list. Account, manager and officeholder selectors are also bounded. A 2,000-account fixture verifies stable, non-overlapping pages and search without returning credentials or permission payloads.
- Manual creation atomically inserts the employee, verified exact-text Payroll ID and audit entry. An ID collision rolls back the employee; leading zeros and letters are preserved. No automatic name/email merge occurs.
- Detail edits whitelist profile fields and preserve Payroll identity, account ownership, historical join date, eligibility and financial fields. Linked contact email requires separate verification. Changing employee status revokes the linked account's sessions. Concurrent reporting-line edits cannot create a manager cycle.
- Placement updates use managed department/division IDs. Reporting managers remain independent of approval officeholders.
- Existing verified-link APIs retain evidence/history and revoke affected sessions. Account choices already linked to another employee, inactive accounts and self-management choices are disabled; server checks remain authoritative. This is linking existing accounts, not bulk onboarding.
- Service periods record category, separate teacher/intern flags, nullable service credit, work pattern, appointment reference and reason. Inclusive dates and overlap prevention apply. Closing can only shorten an existing period; a replacement starts the following day.
- Officeholder assignments have explicit division, department or government-wide scope and inclusive effective dates. Missing login, inactive identity or missing approval permission is visible. Assigning an office does not grant account permissions. Overlapping primary appointments and invalid scope shapes are rejected.
- Weekly work patterns require explicit days. Concurrent case-insensitive duplicates are rejected. Create a new pattern when schedules change so existing service references retain their meaning. This does not implement shift-day or holiday charging.
- New directory/account/profile management responses use `Cache-Control: no-store`. New APIs require central `hr_admin`; provisioning additionally requires portal administration under Package 1A's existing contract. New management writes use transactional audit records. Existing organisation create/remove operations retain their earlier audit behaviour and referenced-record deletion restrictions.

## Verification and limits

The full real-PostgreSQL backend suite passes **249 tests**, including eight new management integration tests. Checks cover atomic verified creation, protected profile fields, linked-email/session handling, audit/transaction rollback, concurrent manager edits, missing-fact filters, a 2,000-account picker, concurrent work-pattern creation, central-HR HTTP gates and office assignment without an implicit approval grant. Existing import and foundation tests also pass.

Frontend lint and production build pass; **103 frontend tests pass**, with one existing skipped test. Actual desktop and 390-pixel mobile browser checks cover employee creation/details, temporary-intern service, verified login search/link, placement, service close/replacement, work-pattern creation, division/HOD/Chief Secretary assignment and all three route-preview stages. There are no browser page errors or page-width overflows in those checks. Computed foreground/background colours on enabled primary hover states meet a 4.5:1 contrast ratio, including the import preview button.

This verifies local behaviour with synthetic data, not 2,000 simultaneous users, production infrastructure or real Payroll reconciliation. Historical tools, non-central legacy Staff and portal account administration still fetch full lists. The native TechnologyOne export contract, certified openings and operational capacity tests remain outstanding.

The graph service was unavailable during final review of the new worktree files; these files were reviewed directly and checked against the real API/database and browser. No exhaustive graph-coverage claim is made.

## Next build item

**Package 1D: department/division access scopes.** Add explicit central and scoped HR assignments, then enforce them across every old/new HR endpoint: employees, applications, balances, evidence, PDFs, reports, imports and exports. Test direct cross-department reads/writes as well as list filters, account revocation and transfers. Do not grant departmental users the legacy global HR capability before this is complete.

Package 1E follows with controlled bulk onboarding, activation/offboarding and the individual-email/Payroll-ID alias or SSO decision. The ordinary recreation three-month choice and separate temporary twelve-month rule remain Package 2 calculation work. Government employee submission and legacy final grant remain gated until Package 3 implements the staged decision engine. Configuration readiness alone does not enable government rollout.

See the [Package 1 structure and 2,000-employee rollout plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md) and [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md).
