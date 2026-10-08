# Package 1E employee onboarding and account lifecycle

Date: 7 October 2026. Status: implemented locally and ready for owner review. No push, PR, deployment, real Payroll data or real email delivery.

Central HR can prepare a cohort of up to 2,000 verified employees, reconcile existing accounts and apply the reviewed decisions. New accounts remain disabled until an individual activation link is used to choose a password. Recovery, link withdrawal, offboarding and reappointment retain identity and audit history. Government leave submission and final grant remain gated.

## Local review

Open [central HR](http://127.0.0.1:5173/api/local-preview), then **Leave → Staff → Onboarding**. Earlier local review data is retained. The dedicated **Synthetic Onboarding** department has three synthetic employees, including one without email and one explicitly reconciled existing account.

| Screen | What to check |
| --- | --- |
| Cohort preparation | Prepare a department or all-records preview. Choose verified individual email or exact Payroll ID aliases. Review counts and pages of 50; inspect blocked identities and existing-account conflicts. |
| Resolve a row | Explicitly verify an existing individual account or skip the person with a reason. Correct employee facts in management and prepare a new preview when necessary. Names and email matches do not link automatically. |
| Apply verified cohort | Requires central HR plus portal administration, a reason and confirmation that every page was reviewed. Changed employee facts or unresolved conflicts reject the batch. Repeated apply does not duplicate accounts. |
| Account lifecycle | Search by name, email or exact Payroll ID. Use **Refresh accounts** after an employee activates. Inspect employment status separately from account status and pending/ready/offboarded state. |
| Individual link | Issue an activation or recovery link after verifying the recipient and handover method. It expires after two hours, replaces earlier unused links and ends current sessions. The link appears once; closing its view removes it. No email is sent automatically. |
| Offboard and restore | Offboarding disables the employee and linked account and revokes sessions, unused links and scoped HR grants. Restoring the employee record leaves the account disabled; fresh activation and separate access appointments are required. |

The retained **Synthetic 1E Alias Employee**, Payroll ID **DEMO-1E-00001-A**, completed activation, recovery, offboarding and reactivation in the browser test. Use [the synthetic employee preview](http://127.0.0.1:5173/api/local-employee-preview) to inspect its personal view without distributing a password. It opens My Leave, shows the government readiness notice and does not offer submission or invented default allowances. **Synthetic 1E Email Employee** remains pending activation. The existing-account employee was explicitly linked; its finance and approval permissions were not expanded.

These loopback-only shortcuts change the login in that browser. Return with the central shortcut. The disposable launch harness, passwords used by the browser test and test links are outside the repository; the separate preview database contains synthetic records only. Restart details remain in the [Package 1B guide](GOVERNMENT-LEAVE-PAYROLL-IMPORT-2026-10-07.md).

## Login and account choices

| Method | Required facts | Activation and recovery |
| --- | --- | --- |
| Individual email | An active managed employee, exactly one verified TechnologyOne Payroll ID and an individually verified email without conflicts | HR hands over a private link through the recorded verified channel. Existing email password sign-in remains available. |
| Payroll alias | The same verified identity and placement; the exact Payroll ID becomes a separate login alias. Email is optional | HR can hand over the private link in person after identity verification. The login screen has an explicit Payroll ID method, preserving leading zeros, letters and case. |
| Existing portal account | HR explicitly verifies the individual account and exclusive employee link, or reviews a retained verified link | Existing credentials and account permissions remain. Applying adds only Leave self-service grants; explicit permission denials still override them. Existing staff identity recovery remains in portal administration. |
| SSO | Identity-provider agreement and immutable subject mapping | Existing configured Google sign-in remains available for existing active accounts. A government SSO integration has not been assumed or configured. |

Payroll IDs identify employees; they are never passwords or activation secrets. Bulk preparation produces no shared or temporary passwords. The older administrator-only single-account provisioning API remains compatible with its unique temporary password and forced-change contract; it also persists the government regime marker.

Email is nullable only for employee accounts with a Payroll alias. Existing staff accounts still require email, and aliases cannot be assigned to staff identities. The database enforces alias uniqueness. Alias login also verifies the current active employee link and matching verified Payroll ID; a stale or unlinked alias cannot sign in. Account selectors now support exact alias search and omit credentials.

## Access and lifecycle controls

The cohort preview stores employee identity, placement, contact and link facts, with preparation provenance. It flags inactive or unplaced employees, missing/ambiguous verified IDs, invalid/missing contacts, shared addresses and existing-account conflicts. Apply locks the employee master in the existing stable order, rechecks facts, checks current account conflicts, and commits creations, links and audit records together. A failure leaves the batch unapplied. Skipped rows are retained as documented decisions.

New identities have the employee account type, user role, and only `hr_access` and `hr_leave_apply`. Retained or explicitly linked accounts receive those two self-service grants without gaining finance, staff-management, report, evidence or approval rights. Department/division access and officeholder assignments remain separate Package 1D/1C operations.

Applying a reviewed cohort marks every non-skipped employee as governed by the government leave regime. This marker belongs to the employee, so retaining a finance login or later changing its link cannot reopen legacy government submission or final grant. Submission and decisions recheck the regime inside the transaction under the employee lock, including a decision waiting behind enrollment. Unselected legacy local employees retain their existing workflow.

Activation/recovery links contain random secrets; only their hashes are stored. Tokens bind to the account, employee and verified Payroll ID, and their expiry, revocation and consumption are rechecked under transaction locks. Concurrent use succeeds once. Activation sets the individual password, revokes sessions and other unused links/reset tokens, and records the event atomically; it does not sign the employee in automatically. Login attempts through email and alias share the same account lockout budget. Verified recovery clears that budget.

Central HR plus portal administration is required to apply cohorts or issue employee links. Central HR can withdraw unused links, ending current sessions without disabling the account. A link change retires both affected accounts' unused activation/recovery and self-service reset tokens. Password changes also retire outstanding employee links. Responses use `Cache-Control: no-store`, and raw secrets are absent from lists, batch snapshots and audit records. The activation fragment is removed from the browser address before use.

Offboarding immediately disables employment and the linked account, removes sessions/reset tokens, and revokes unused links and scoped HR assignments. Employee-only accounts also lose non-self-service explicit grants and permission overrides, preventing reactivation from restoring old management privileges. Disabling a linked existing staff account requires portal administration as well as central HR because it affects the other portal modules. Another administrator must offboard the actor's own identity.

Payroll IDs, links, service, leave and office history remain available. HR must review outstanding requests, close/update service appointments and replace officeholders separately; no appointment end date or entitlement outcome is guessed. Restoring an employee is separate from activation and does not restore prior scopes. Existing staff accounts require their own administrator-controlled reactivation.

Government personal views show only stored historical balances, labelled as awaiting certification. A newly activated employee with no stored balances sees that opening balances await HR certification. The old portal's default allowances are not presented as that employee's government entitlement.

## Verification and rollout preparation

The full PostgreSQL backend suite passes **278 tests** across **41 suites**, including 16 onboarding/lifecycle integration tests. The 2,000-person test stages and applies the cohort through the real service/API, checks 50-row pages and verifies disabled accounts without exposing passwords or token payloads. Other checks cover stale previews and atomic rollback, shared contacts, explicit existing-account links, central/provisioning gates, token hashing/reissue/expiry/single use, exact alias login, one account lockout budget, recovery, link withdrawal/relinking, offboarding, privileged-grant removal, separate restoration, audit failure and a final decision queued behind government enrollment.

Frontend lint and production build pass; **104 frontend tests pass**, with one existing skip. Desktop and 390-pixel mobile browser checks cover cohort preview, explicit existing-account reconciliation, apply, individual activation, Payroll ID login, the government submission notice, recovery, offboarding and reactivation. No page errors or page-width overflow occurred in those checked states. New and changed screens were visually reviewed.

The synthetic population test verifies a bounded preparation path, not 2,000 concurrent employees, production password-hash capacity or WAN performance. Large cohort apply locks the employee master; use a controlled preparation window and include its contention in operational capacity testing. Ordinary lists, selectors and cohort rows are paginated; historical balance/report response-size limits remain as recorded in Package 1D.

Before real activation, confirm whether Payroll IDs identify people or appointments, whether they recur/change, email coverage and the approved individual handover channel. This build fails closed when there is more than one verified Payroll ID for an employee; resolve the authoritative current identity before enrollment. Rehearse the additive schema and access changes against a scrubbed copy, verify backup/restore and the configured HTTPS portal address, and confirm HR support/recovery responsibilities. Pilot small departmental cohorts before preparing the full population. Activation links are issued individually when the recipient is ready; no bulk email campaign or government SSO connection was performed.

## Next build

Package 1A–1E is implemented locally. Owner review and operational rollout evidence remain. **Package 2 is next:** versioned policy evaluation, verified service/calendar segments, a leave ledger with reservations and certified opening balances. Ordinary recreation uses the owner's three-month choice; temporary recreation retains twelve months, and intern designation remains separate from appointment category. Package 3 then executes division → HOD → Chief Secretary decisions and required statutory consents before government submissions open.

See the [Package 1 structure and rollout plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md), [Package 1D review](GOVERNMENT-LEAVE-PACKAGE-1D-REVIEW-2026-10-07.md) and [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md).
