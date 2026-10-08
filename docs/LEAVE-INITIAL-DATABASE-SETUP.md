# First-time setup from the existing database

Use **Leave → Settings → Initial setup**. This is the owner’s initial configuration workspace; it does not require employee-by-employee account onboarding, a Payroll ID, or a second HR officer.

The existing employee database is the employee register. Keep its employee IDs, linked logins, managers, eligibility decisions, balance rows and application history. Do not create a second employee database or import these people as new hires.

## Configure and adopt

1. Select the authorised published corrected Government policy and the intended start date. If none exists in production, prepare and publish it under Policies first, using the actual signed source and dates. Initial setup does not publish a duplicate policy. The calculation engine resolves published policies by the application date.
2. Review the old-to-new leave-type mapping. Suggested mappings are a convenience and require review. Decide whether each type maps to a Government leave code or is retained for historical reference. Mapping does not merge balances, rename old records, or grant an entitlement.
3. Select unique exact organisation matches to adopt. Only missing managed department/division references are linked; uncertain matches stay visible. Existing text labels, nominated managers and login permissions are retained.
4. Expand **Employee facts and stored balance comparison**. Stored years and pending amounts remain separate. Blank Government opening targets mean the verified target has not been determined. Rule defaults are not opening balances.
5. Add a setup note, choose **Review current setup**, then **Save setup draft**. Incomplete work can be saved, edited and deleted.
6. When all mappings have decisions, review and save the latest draft, then choose **Adopt existing database**. This records the configuration and applies only the selected organisation references. Adoption has a transaction, source freshness check, revision check and one-time receipt.

Saving and adoption are actions the owner can perform alone. Ordinary leave approval, subsequent balance certifications and operational controls remain distinct.

## What adoption changes

| Item | Result |
|---|---|
| Existing employee register | Reused by reference, including existing employee IDs |
| Linked login and account permissions | Retained |
| Managed department/division IDs | Missing references linked only for selected exact matches |
| Existing nominated manager | Retained |
| Corrected Government policy | Referenced by ID and reviewed source snapshot |
| Retained leave-type configuration | Mapped to stable Government codes or historical reference |
| Eligibility, balances, pending amounts and application history | Retained |
| Current leave calculations | Continue until operational cutover |

The Finance copy reviewed on 08/10/2026 contains 29 employees, 25 linked logins and 26 recorded join dates. None has verified managed placement IDs or the new service/schedule foundation. These are current local-copy findings, not production acceptance.

The existing Medical settings contain certified and uncertified buckets and an inactive older Sick type. They must not all be summed into the new ten-day pool. Special’s existing five-day setting differs from the corrected three-day rule; mapping alone is not authority to reduce existing credited balances.

## Calculation cutover is still a separate delivery requirement

This initial configuration does **not** activate Government calculations. The database lacks facts needed for those calculations; a join date and “leave entitled” flag do not prove permanent status or uninterrupted credited service.

Before switching an employee, record the actual appointment category, credited continuity and exclusions, verified weekly schedule or roster, approved calendar, reviewed opening targets and retained leave dispositions. Review Medical history where applicable. Keep Payroll IDs as a payroll reconciliation requirement rather than an initial configuration prerequisite.

The current preparation APIs enrol employees before opening/activation and can therefore interrupt legacy submission. They are not an atomic commissioning path. A future owner commissioning path must validate the complete reviewed source snapshot, create the Government foundations/openings/configuration and switch the employee arrangement in one transaction. If anything fails, the employee must remain on the existing workflow. If single-owner commissioning is used, it needs its own limited initial setup authority and auditable receipt; ordinary independent review must not be bypassed globally.

Initial setup adoption therefore establishes the consolidated configuration and reusable current register. It must never be reported as completed calculation migration, completed employee readiness, or production deployment.

## Local verification on 08/10/2026

- 449 backend tests pass in a disposable PostgreSQL database, including nine initial setup tests. These verify read-only source inspection, same-owner draft/adoption, authorization, revision conflicts, stale previews, atomic rollback, idempotent adoption, operational data preservation, and reuse of setup mappings in reconciliation.
- 116 frontend tests pass; one existing test remains skipped. Frontend build and lint pass.
- The saved local draft survives reload and shows the existing published corrected policy, eight suggested mappings, one unresolved Compassionate mapping and 29 proposed Finance/Treasury placement links. No adoption was performed on the restored records.
- Desktop and 390-pixel phone layouts were inspected. Employee comparison is paged at 50; organisation matching is searchable and paged at 10.
- The 37-table backup projection audit still matches employee, balance and application data. Its differences remain the previously added department and local audit entries; the new setup tables hold the draft and its revision history.
- Saved setup mappings appear in the opening/cutover comparison and can suggest the type for a retained application transfer. They never provide an opening amount or substitute for a fresh leave approval.


## After adoption: Settings and Medical tracking

The owner adopted revision 2 locally on 08/10/2026 at 08:00 Nauru time. The 29 Finance/Treasury records now have the selected managed organisation references. This supersedes the earlier draft-only verification above. Balances and the six retained applications remain unchanged; all 29 employee arrangements still use the existing workflow, with zero Government calculation activations.

Settings now opens Policies after adoption. **View setup record** opens the read-only adoption receipt and original mappings; Initial setup is no longer a normal menu choice. Published policy headings omit an old `(Review Draft)` suffix based on actual published status, while the stored record name and authority/source text remain intact. Publication in this local database does not itself establish signed policy authority: the corrected source still records publication authority pending.

Open **Employees → Manage → Leave arrangements → Medical leave** to review the employee’s Medical position. The existing Finance balances retain separate Sick (with MC) and Sick (without MC) records until cutover. The corrected Government configuration instead has one ten-day annual Medical pool and up to three qualifying uncertified occasions. Those occasions are not a separate three-day allocation: one approved roster shift may charge two policy days while using one occasion.

For a Government Medical service year, the view shows the shared balance, holds and available days; approved and pending days with/without a certificate; separately reviewed usage before the opening date; and approved, pending, baseline and remaining uncertified occasions. The dated usage history distinguishes evidence route and status. Cancelled/rejected absences do not consume the counter, and approved early-return/cancellation effects are reflected. Unknown opening/history displays “Not determined”, rather than assuming three unused occasions. Baseline history must match the certified service year and cutover date.

New Government Medical approval PDFs mark the certificate route, shared entitlement, usage split and uncertified occasions committed at final grant, including other pending applications. Final-grant usage snapshots count the application just approved once and retain the employee’s post-grant shared balance. Printed dates use DD/MM/YYYY and audit times identify Nauru. Older granted PDFs remain their original stored bytes. The retained Finance approval form continues to show its existing certified/uncertified split; a new Government record must not imply that the corrected ten-day pool is still divided into seven and three days.

Synthetic certificate and uncertified PDFs were rendered and visually checked. The actual restored employee screen and adopted Settings were checked on desktop and a 390-pixel viewport without changing any employee record.

Verification for these corrections: the full backend suite passes 452 tests; six additional Medical tracking tests pass separately in a disposable PostgreSQL database. The frontend passes 120 tests with one existing skip; build and lint pass. Restored data still contains 29 employees, 109 balance rows and six retained applications, with one adopted setup and no published employee activation configurations.
