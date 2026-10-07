# Government Leave functional completion and walkthrough

Date: 7 October 2026. Local review: http://localhost:8081/review/local.

The local feature build now includes the remaining workflow changes identified in the earlier audit. Visual cleanup is deferred until the owner has walked through the functionality. Government-wide production acceptance still requires verified personnel records, signed authorities, Salary Unit reconciliation, a real departmental pilot and deployment/recovery evidence on the intended infrastructure.

## Functional work completed

| Area | Behaviour available locally |
| --- | --- |
| Policy versions | Edit, delete and restore unpublished drafts with revisions and audit history. Prepare an authorised replacement during existing coverage; a different central HR officer approves it. Append-only transitions retain original published dates, grants and PDFs. Changes covering completed grants or posted jobs are refused. |
| Policy transitions and jobs | A payroll fortnight spanning a policy change prorates each governing annual allowance, retains its payroll phase and posts once. The posting-date policy sets its cap. Publication and grant/job execution coordinate through database locks. |
| Preparation recovery | Unwanted activation, entitlement-job, opening, teacher/roster coverage and benefit-reconciliation drafts have recoverable Delete draft / Restore draft actions. Discarded drafts cannot be approved; stale revisions fail. Approved/certified records remain protected. |
| Appointment corrections | Prepare a sourced correction of appointment dates, category, teacher/intern classification, service credit and schedule. A different central HR officer approves against the exact original facts. Before/after history is retained; existing balances, holds and grants are preserved. Affected activation/job reviews and pending applications require fresh review. |
| Enterprise approvers | Settings → Organisation & approvers contains division, Head of Department, Chief Secretary, HR evidence verifier, relevant Secretary and Minister offices. Dated appointments and explicit account permission remain separate requirements. |
| Assisted cases | Calculations fingerprint the foundation records used for the actual case. An unrelated future policy does not invalidate an unchanged pending case; changes to its governing facts still do. |
| Amendments and financial history | Successive approved early returns and subsequent cancellation append effects, refund only remaining entitlement and preserve original grants. Payroll uses the latest effect without duplicating the original grant. Correct prior payout/service baselines through independently approved reconciliation, preserving commitments and earlier history. Financial commitment changes use cancellation and a new reviewed determination. |
| Teacher and roster cohorts | Independently reviewed dated coverage records certify the actual teacher/shift schedule and its conversion. Teacher common-leave activation uses Medical and Special rather than ordinary Recreation; teacher Recreation stays on its discretionary case route. Nonstandard single-shift Medical conversion requires its own independently approved rule. Readiness retains identity, offices, balances, training and Payroll checks. |
| Management and operations | Government activity, outstanding stages, aged pending applications, Salary acknowledgement counts and current certified balances appear on Overview and Report. Government absence exports use dated grant segments and the latest approved shortening/cancellation. Scoped reporting excludes clinical reasons, evidence and pay rates. |

## Local data preserved

The restored copy has 29 Finance/Treasury employees, 109 historical balances and 6 historical applications. Employees remain on the legacy regime. It has no verified Payroll identities, appointment history, Government calendars, work patterns, certified openings or Government applications.

The owner's **Government Leave — Corrected Rules (Review Draft)** remains unpublished, covering **1 September 2026–7 October 2028**: ordinary Recreation qualifies after **3 months**, temporary employees after 12 months; annual Recreation 20 days, cap 60, notice 14 calendar days; Medical one 10-day pool with 3 uncertified single-shift occasions; Special 3 days. Its source still records publication authority as pending. The build does not infer these missing authorities or personnel facts.

The production-copy audit matches 36 of 37 original table projections. The only difference is the audit log, which retains the owner's two policy preparation/edit events (287 → 289 rows). The original backup remains unchanged. Functional tests, population and recovery fixtures use separate disposable databases.

Email, external connections and automatic accrual remain disabled in this local production-copy environment.

## Walkthrough

1. **Settings → Leave policies.** Open Edit draft to review the saved rules and dates; close without saving if nothing changes. Delete draft moves an unwanted unpublished version to Deleted drafts; Restore draft retains its original facts. Keep the corrected policy as a draft until publication authority is recorded. After an authorised initial publication, Prepare replacement copies the existing rule values into a new draft; choose a prospective start within its current coverage, retain its remaining end coverage and cite the signed replacement decision. A different central HR officer approves the reviewed revision.
2. **Settings → Organisation & approvers.** Review departments/divisions and all statutory offices in one place. Verify the actual person, account, permission, scope and appointment dates. **HR access** controls staff, balance, approval, evidence and reporting access separately.
3. **Employees → Employee list → Manage.** Inspect the employee's Payroll identity and appointments. Prepare correction changes mistaken facts for independent approval; its history preserves the original row and the reviewed replacement. **Settings → Payroll import** previews the actual TechOne export. Payroll IDs remain text, retaining leading zeros. **Onboarding** controls login accounts separately from Government Leave activation.
4. **Employees → Government balances & service.** Certify service bases, exclusions and schedule conversions from approved records; evaluate dates to see missing prerequisites and daily charges. Prepare opening balances using personnel and Salary Unit sources. A different central HR officer certifies. An unwanted opening preview can be deleted and restored. Historical Medical 7+3 and Special 5 are reconciled explicitly through **Payroll & handover → Opening & cutover review**, rather than overwritten automatically.
5. **Employees → Government applications & jobs.** Prepare employee activation and entitlement plans, then have a different officer approve. Wrong preparations can be deleted/restored. Select the approved Medical convention explicitly: one policy day, or a verified roster single shift. Employees submit eligible common leave; authorised HR prepare assisted cases with evidence and signed determinations. The application displays the required route, ending at Chief Secretary. A signed shortening/cancellation is a new approved case, retaining the original personnel PDF and its correction history.
6. **Overview / Report.** Read Government queues and current certified balances separately from historical Finance measures. Government absence exports count only grant segments in the selected dates, after effective amendments. Financial commitments and attendance use the separate Payroll register. The period-filtered work list needs routine review by assigned officers; the portal does not promise automatic Government email reminders.
7. **Employees → Payroll & handover.** Verify exact Payroll identities, prepare the dated register, reconcile amendments/replacement versions and have a separate officer approve the receiving-system receipt. Payroll exports provide instructions; they do not execute payments.
8. **Settings → Rollout readiness.** Select the intended cohort. Teachers and roster employees additionally prepare/review dated schedule coverage, download its reviewed day-by-day facts and obtain independent approval. Benefit baseline reconciliation is available for an employee with an existing commitment baseline. New preparations retain original facts and expose Delete/Restore. Check the cohort again after material personnel/schedule changes; a readiness approval never silently activates logins, leave or jobs.

## Acceptance evidence and limits

Final combined verification: **421 backend tests across 47 suites passed, with no skips** on a fresh disposable PostgreSQL database. Frontend: **104 passed, one existing skip**; lint and production build passed. Browser checks verified consolidated approvers, policy actions, teacher/roster preparation and Government reporting at desktop and 390px, with no horizontal overflow. The production-copy health check and preservation audit passed; no corrected policy was published and no real employee was activated.

The final capacity report recorded sign-in p95 **257 ms**, mixed-session p95 **500 ms at 100 concurrent / 828 ms at 200 concurrent**, audited-write p95 **51 ms**, and a 28,000-line Payroll preparation in **1,097 ms**, with zero unexpected HTTP errors. Native runtime was Node 26.8.2. Full recovery used the existing Docker image's Node **20.20.2** and PostgreSQL **15.19**, restored **100 tables**, and completed its whole synthetic preparation/backup/restore/verification sequence in nine seconds. That elapsed fixture time is not a production recovery target.

Private local evidence: `/tmp/leave-functional-backend-tests-final.log`, `/tmp/leave-functional-client-tests-final.log`, `/tmp/leave-functional-lint-final.log`, `/tmp/leave-functional-build-final.log`, `/tmp/leave-capacity-expanded-final.log`, and `.leave-review/full-recovery-1791357552228/report.json`. Generated passwords, keys and backups remain private and ignored by Git.

The extended capacity rehearsal uses 2,000 disposable employee records and actual API authentication with bcrypt cost 12. It exercises 100 and 200 concurrent mixed sessions, 30 concurrent audited ledger writes with idempotent retries, 100 sign-ins paced over 60 seconds, paginated directory/approval reads and a 28,000-line Payroll register/export. The original two-second p95 sign-in/mixed/writes target is retained. This measures local workstation behaviour, not production sizing; simultaneous full grant/amendment load on the production environment remains a pilot check.

The full disposable recovery rehearsal snapshots database rows, upload/archive files and generated key material together, removes its source, restores into an isolated environment and starts the actual API. It checks password and Payroll-alias login, approved PDF/evidence/archive downloads, encryption decryption, replay of already-posted jobs and pending holds. The original read-only local-demo logical recovery mode remains available. Neither mode proves offsite retention, access to production keys, restore ownership or production recovery objectives.

Use a separate synthetic environment for the multi-role demonstration, including two central HR officers, an employee and distinct dated approvers. Local database integration tests exercise these roles and failure paths; the restored local migration reviewer does not impersonate real employees.

Before government-wide rollout, complete these external acceptance items:

- Approved policy publication authority, disputed-case determinations, anniversary/service treatment, Gazette dates and actual payroll anchor/proration.
- Reconciled TechOne export format, exact employee versus appointment identity, contacts, service history, approved officeholders and certified cutover balances.
- Two representative Salary Unit cycles, teacher/shift pilot records, historical leave reconciliation and receiving-system handover.
- Training/support ownership, daily queue review and agreed reminder procedure.
- Production hardware load, offsite backup/key access, full production restore and deployment/security review.

These items require verified records and accountable officers; test fixtures do not complete them. Visual simplification and naming cleanup are the next review activity after this functional walkthrough.

References: [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md), [original structure/capacity plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md), [production-copy review](GOVERNMENT-LEAVE-PRODUCTION-COPY-REVIEW-2026-10-07.md).
