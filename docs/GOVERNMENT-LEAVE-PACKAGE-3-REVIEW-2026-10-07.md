# Government Leave Package 3 local review

Date: 7 October 2026. Recreation, Medical and Special applications, staged approvals, approved personnel-file PDFs and reviewed entitlement jobs are implemented locally. Government submission requires independent activation for each employee. Owner acceptance, the actual Payroll cutover and production rollout remain open. The next build package is Package 4, other leave and assisted cases.

## Open the running application

[Central HR](http://localhost:8081/review/hr) → Leave → Staff → **Government workflow**. [Employee](http://localhost:8081/review/employee) → **My Leave**.

The isolated Docker stack runs from `/Users/teuteulilo/.codex/worktrees/employee-account-foundation/nr-aba-webapp`. Frontend/backend source changes reload locally. Restart the stack for Compose, dependency or review-gateway changes using `./scripts/leave-review.sh up`. `status`, `logs` and `stop` remain available. Stopping retains the database. SMTP, AI and both unattended accrual schedulers are off; only loopback port 8081 is exposed. No real employee file, external payroll exchange, production deployment, push or PR is part of this delivery.

| Review identity | Local link | Authority in the synthetic example |
| --- | --- | --- |
| Central HR | http://localhost:8081/review/hr | Prepare activation and job plans, review all applications, maintain offices, record actual Salary Unit acknowledgement |
| Independent HR certifier | http://localhost:8081/review/certifier | Independently certify openings, approve another HR officer's activation/job plan; assigned evidence verifier |
| Employee | http://localhost:8081/review/employee | Apply, follow decisions, cancel pending requests and download own granted PDF |
| Division approver | http://localhost:8081/review/division | Recommend at the assigned division stage |
| Head of Department | http://localhost:8081/review/hod | Recommend at the assigned department stage |
| Relevant Secretary | http://localhost:8081/review/secretary | Required Recreation/Medical consent |
| Chief Secretary | http://localhost:8081/review/chief | Sign in as the current assigned synthetic Chief Secretary and record the final grant |
| Scoped HR | http://localhost:8081/review/scoped | Existing departmental isolation example; no central configuration access |

These links change the session in that browser. Use separate browser profiles or switch between links to exercise the chain. They work only in the synthetic development gateway against the actual `leave_review` database. The Chief Secretary link requires a currently dated enterprise assignment. Seeded accounts alone do not assign offices, certify balances, activate leave or publish job plans. Existing inactive accounts remain inactive.

## Inspect the completed synthetic examples

The retained **Synthetic 1E Alias Employee**, exact Payroll alias **DEMO-1E-00001-A**, has three granted examples:

| Leave | Dates | Posted usage | Current certified credit |
| --- | --- | --- | --- |
| Recreation | 3–4 November 2026 | 2 policy days | 18 days |
| Medical, uncertified exemption | 9 November 2026 | 1 policy day and 1 exemption occasion | 9 days |
| Special | 11 November 2026 | 1 policy day | 2 days |

Each began with explicit synthetic reviewed openings of 20, 10 and 3. The example appointment is permanent with a verified five-day seven-hour schedule. The **2 November holiday** remains a synthetic test date, not a gazetted holiday. All authority/source references explicitly describe local demonstration data.

1. Open the employee view and review each application. The full timeline distinguishes recommendations, HR verification, Secretary consent where required and Chief Secretary grant. Download a granted PDF; Payroll ID, submitted placement, dates, calculation references, deciding offices and before/use/after credit remain frozen.
2. Open Calendar and advance to November. Granted government absence dates appear alongside retained local records. Calendar labels government cases as **Approved government leave**, without exposing clinical leave type, personnel reasons or documents. Owner/current scope controls apply.
3. Preview Medical for **10 November**, choosing the uncertified exemption. It is adjacent to the approved 9 November medical absence and cannot be submitted as another exemption. The approved medical definition requires one calendar date, exactly one policy day, separated absences with an intervening scheduled day, and a maximum of three committed exemptions inside the ten-day pool.
4. Prepare another Recreation application sufficiently far in advance on unused dates. Preview recalculates on the server. Submission holds credit but does not deduct usage. Switch through division, HOD, independent HR certifier, Secretary and Chief Secretary links. Earlier stages cannot grant leave or produce an approved PDF. An administrator cannot bypass the assigned final officer.
5. Central HR can change application status to **All** or **Approved** to inspect the completed examples. A real Salary Unit received reference may be recorded after grant. That acknowledgement does not issue payment or post usage again. The synthetic examples currently have no Salary Unit acknowledgement.

Government workflow opens with **Pending** in central/approver views, so completed examples require a status change. Lists use 50-case pages; central configuration cards show the latest 100 records, narrowed by the selected employee. Cap events show the latest 50. Refresh explicitly while switching between approval identities.

## Activation and retained balances

First verify employee identity, current department/division, service basis, work pattern/roster, policy/calendar coverage and individually reconciled openings under **Policy & balances**. The government workflow then prepares the enabled common codes, signed medical operational definition, pre-cutover medical history and a historical/pending/future reconciliation reference. A different central HR officer must approve the unchanged preview. Blank medical history requires an explicit reviewed confirmation of no earlier absences in that service year.

The independent officer can inspect the source, reconciliation reference, baseline dates/absences, enabled types and recorded reason before approving. Missing inputs block activation. Medical history is calculated against verified past policy/calendar/schedules; its charged days plus the net cutover credit and recorded government usage cannot exceed the single annual pool. This catches a full ten-day opening incorrectly supplied after earlier medical days have already been taken. Later corrections cannot make Medical or Special spending exceed the standard annual pool; an exceptional case requires assisted authority. Balances above the standard quantum/cap, such as unreconciled historical Special five-day credits, require a signed transition. The portal preserves those credits; it does not silently reduce or merge them. Bulk cutover, migration of pending/future cases and native Payroll file mapping remain Package 5 work.

Publishing an empty enabled-code set pauses new applications and jobs for that employee. Existing applications retain their submitted configuration and decisions; pausing does not erase a case or silently free its hold. New manually certified Medical service years need a newly reviewed medical baseline. Automatically renewed service years begin with zero prior-year exemptions.

Ordinary Recreation keeps the owner's **three-month** qualification; temporary Recreation retains **twelve months**. Temporary employees, including an intern whose appointment is verified as temporary, can use the standard Medical/Special routes. Intern status does not invent an entitlement; unknown/casual/probationary categories and unsupported appointment/schedule cases remain blocked for assisted determination. Teacher Recreation remains assisted.

## Approval and evidence controls

| Common type | Required ordered route |
| --- | --- |
| Recreation and Medical | Division recommendation → HOD recommendation → HR evidence verification → relevant Secretary consent → Chief Secretary final grant |
| Special | Division recommendation → HOD recommendation → HR sufficient-cause verification → Chief Secretary final grant |

Division/HOD/Chief Secretary appointments remain under **Organisation & approvers**. **Government workflow** adds dated department-specific Secretary offices and a government-wide central HR verifier. Appointments do not grant account capabilities. The owner-specified management hierarchy retains the policy's additional Secretary consent.

Missing, expired, self-assigned, unlinked or revoked officers block the affected stage. Central HR explicitly reviews a current office binding or a sourced case-specific substitute at an earlier stage; prior bindings remain in history. A Chief Secretary substitute must be a verified dated current/acting Chief Secretary. HOD delegation alone cannot replace the final grant. A change to an already completed office can block the final grant: completed decisions cannot be rebound. Central HR must cancel/resubmit or retain the case for Package 4 assisted continuation; this package does not automatically reuse prior consent after an authority change. Placement transfers block pending grants, remove old officeholder access and require central reconciliation/cancellation/resubmission.

Recreation requires at least 14 calendar days' notice using today's Nauru date. A Secretary's operational refusal requires the reason, employee consultation reference and alternative date. Medical certificate submission requires an actual PDF/PNG/JPEG attachment; HR verifies the practitioner source and complete date coverage before the case can proceed. Supporting documents are capped at three files, 5 MB each, with content signatures checked and attachment downloads protected. No automated malware or clinical-validity claim is made.

Personnel reasons, files, decision notes and granted PDFs require owner, central HR or explicit scoped evidence access. Ordinary approvers receive the dates, charges and route, with an independent HR verification stage. Pending Medical applications consume exemption slots; cancellation/rejection frees them. Adjacent cases cannot be split to avoid evidence review. Granted usage and exemptions remain committed; corrections require Package 4's assisted amendment process.

Submission and final grant use the same server calculation with employee/entitlement locks. Shared office snapshot locks permit unrelated cases to proceed together; office appointment changes use the exclusive lock. Retries reuse request/decision keys and cannot duplicate holds or usage. Changed inputs with the same key fail. Final grant rechecks retained calculation, current service/calendar/placement, every required decision, office/capability and evidence before consuming the hold, recording usage and storing the PDF in one audited transaction. An audit/PDF/posting failure rolls the entire grant back. Later employee edits do not alter the PDF.

## Reviewed entitlement jobs

Each employee/type needs an independently approved job plan in addition to an enabled workflow. Plans identify the certified service basis, source and recorded reason. Recreation additionally requires the actual Payroll fortnight anchor, first posting after cutover and explicit temporary-service accrual treatment. HR/Salary Unit must approve the supported method: 26 full-cycle postings sum exactly to the annual quantum, cumulative rounding uses six decimal places, and partial periods prorate credited calendar days over 14 with truncation. Dates before the opening cutover do not earn a second credit.

**Run approved due jobs** processes only due dates. Jobs are retry-safe, exclude recorded non-creditable intervals, reject unresolved service or unsupported appointment terms, and stop at the Recreation cap. A clipped/stopped posting creates a retained cap event for HR/Chief Secretary direction. It never authorises cash-out or a payment. Recreation carries certified unused credit on supported service-year renewal; Medical/Special expire unused old credit and grant the supported effective annual allowance. Pending expiring-year holds, changed continuity, policy-boundary exceptions and unreconciled future manual openings block renewal.

The synthetic Recreation job plan uses anchor **7 October** and first posting **21 October 2026**. This is a demonstration configuration requiring actual Payroll approval before real use. The local manual run produced zero due postings and unchanged credit. Future balances cannot be spent or posted.

For an operational deployment, `GOVERNMENT_LEAVE_SCHEDULER=on` opts into startup catch-up and hourly due checks. The default is off, including local Docker. The runner pages active published/enabled employees, isolates each employee transaction, retains reviewed plan references and records system-origin audits. An advisory lock prevents overlapping runners; employee locks and unique posting keys protect manual/scheduled races. A blocked employee is reported and does not prevent later employees from being processed. Serial catch-up is bounded to 52 new Recreation fortnights per employee/run and five service years before requiring a fresh cutover. Government jobs cannot use the legacy accrual runner.

## Validation and next work

The real-PostgreSQL backend suite passes **315 tests**, including full statutory routes, independent activation, temporary Medical, pending exemption counts, concurrent overspend, idempotency, transfers/revocation, office closures, self-substitution, no final-role bypass, evidence/PDF isolation, central queue/calendar reads, audit rollback, reviewed job proration/caps and annual renewal. Frontend lint/build pass; **104 frontend tests pass**, with one existing skip. Desktop/mobile browser checks exercised all three grants, independent activation/job approval, a blocked adjacent Medical preview, zero future job credits, scoped calendar, PDF download and readable blue-button hover. No browser errors or 390-pixel page overflow were observed. Application-generated PDFs were rendered and inspected.

This is local functional evidence. It does not establish 2,000 concurrent-user capacity or production readiness. Package 6 still needs realistic sessions, shared-gateway login bursts, staged deployment, TLS, backup/restore, accessibility/support and two reconciled payroll cycles. The current manual inbox refresh and absence of new government email notifications should be included in pilot operating procedures. Existing Overview and Report remain explicitly marked as historical local measures; Package 5 supplies the government payroll/register exports and full reconciliation.

Package 4 is next: authorised assisted/event cases, teacher discretion, parental/LWOP restrictions, extended medical, witness/travel, furlough/long-service and controlled amendments to granted cases. Package 5 follows with the actual Payroll contract, migration rehearsal, Salary Unit workflow and portable handover exports. The [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md) and [policy implementation plan](GOVERNMENT-LEAVE-POLICY-IMPLEMENTATION-PLAN-2026-10-06.md) retain unresolved configuration inputs and statutory decisions.
