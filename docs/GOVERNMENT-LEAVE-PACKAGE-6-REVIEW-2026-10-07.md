# Government Leave — Package 6 local review and pilot operations

7 October 2026. Implemented locally on `codex/employee-account-foundation`; no production release, real staff import, notification send or automatic cohort activation.

## Walkthrough

Open <http://localhost:8081/review/hr>. Staff now has one compact **Staff workspace** selector, with no repeated Employee management title or blue access banner. The scope remains visible beside it. **Balances & service** contains employee calculations and opening certification. **Policies** in the top menu owns effective government policy versions, calendars and work-pattern conversion approvals. Historical policy settings remain in a closed disclosure for retained records. The former Policy & balances entry and Policy & calendars submenu have been removed.

Select **Staff → Rollout readiness**, choose a department, select up to 50 employees and **Check cohort**. Each result explains missing identity, login, service, policy/calendar, current openings, activation, Payroll reference or office authority. In the current synthetic Onboarding department the Alias Employee is prepared; the other deliberately incomplete test records show their actual preparation issues. Checking makes no balance or access changes.

Prepare a release review only after reviewing the cited evidence and selecting two independently reconciled Payroll registers. The server freezes the roster of UUIDs, current readiness facts, operational evidence references, register versions/checksums and the review purpose (local rehearsal, pilot or department). A different current central HR officer downloads the record and approves it. Refresh changed facts through a new review; prepared records and approvals are immutable. Approval rechecks identity, account access, current common-type configuration, service/balance facts and dated offices, plus both Payroll registers against the current granted instructions. It rejects incomplete, changed, superseded or unacknowledged records, self-review and reused keys with different facts. Retrying the same review is safe.

**A cohort approval records independent release evidence. It does not provision accounts, activate leave, start jobs or replace per-employee activation.** Onboarding and **Applications & jobs** retain those controls and their independent reviews. This keeps a department release from bypassing the existing grant or opening-balance controls. A later changed fact can invalidate readiness even after a sign-off; run Check cohort immediately before the operational release. Current-date reviews must be refreshed on a later date.

The common cohort check is deliberately conservative: one verified Payroll ID, the three common types, an approved standard weekly schedule and current non-self-approval offices. Several historical Payroll IDs, shift-roster cohorts and officeholders applying for their own leave need a separately reviewed arrangement; this screen does not infer that arrangement. **Assisted-case evidence** must describe the applicable event/teacher/financial routes and the real responsible officers. It remains an externally reviewed reference, rather than an automated proof of every exceptional policy combination.

## Operations and verification

The rollout workspace displays pending decisions, missing initial office bindings, missing Payroll register receipts, opening reviews, job-plan reviews and Salary acknowledgement counts. Recent **scheduled** runs preserve a dated immutable outcome with employee/changed counts and blocked cases. A missing initial binding count does not detect every stale binding; the application timeline rechecks live authority. Manual jobs retain their existing posting audit and ledger history. Automatic scheduler runs remain off in local review. Existing approval queues are the in-app work list; this package does not introduce outgoing government workflow email notifications.

The capacity tool always creates a uniquely named disposable database and starts the actual API server against it. It never accepts a database URL or an existing database. It seeds 2,000 individual employee accounts, exact Payroll IDs, verified schedules/service bases, 6,000 entitlement accounts, 2,000 grants and 2,000 sessions. Tests exercise real password login at bcrypt cost 12, authenticated per-person reads, directory paging, grant registers and a 28,000-line Payroll exchange. It verifies denied foreign-employee and central-only access. Existing account/network request budgets remain enabled.

Run from `app/backend`: `node scripts/leave-capacity.mjs`. JSON evidence and restricted API logs are written to a new temporary directory; its disposable API/database are removed afterward. The run passed on this Mac using Node v26.8.2 and PostgreSQL 15; the review container runs Node 20, so repeat on the selected production runtime/hardware before sizing that environment.

| Measured workload | Samples / concurrency | Local p95 |
| --- | --- | --- |
| Password login | 50 / 10 | 2,460 ms |
| Own employee foundations | 2,000 / 50 | 46 ms |
| Directory pages of 50 | 120 / 30 | 58 ms |
| Granted application register | 80 / 20 | 23 ms |
| Prepare 28,000 Payroll rows | 1 | 1,128 ms |
| Export 28,000 Payroll rows | 2 / 2 | 701 ms |

These are measured local workloads, **not 2,000 concurrent users or a production availability certification**. The password workload is separately bounded because password hashing consumes CPU. The runner's RSS reached about 503 MiB while it also retained fixture/export data; this does not measure peak API-container RSS or justify a production memory allocation. The harness does not simulate concurrent grants/amendments or large clinical attachments. Real-PostgreSQL integration suites verify posting concurrency, retry safety, amendments and scopes; evidence-heavy cohort exports and production resource monitoring remain acceptance work.

Run from the repository root: `node scripts/leave-restore-rehearsal.mjs --local-review`. This tool resolves and verifies the **ron-leave-review** Compose database, exports one consistent PostgreSQL snapshot, writes a restricted logical dump under ignored `.leave-review/restore-<timestamp>/`, and restores into a new disposable container. It compares all complete row hashes/counts in all public tables, including PDF and evidence BYTEA fields, checks held entitlement and restores the immutable-history triggers. The successful local run compared **92 tables**, with **all restored rows matching**, and completed the restore phase in **1 second**. The MD5 row-set manifest detects accidental copy drift; the whole dump has a SHA-256 checksum. Neither is a substitute for encrypted/authenticated backup storage.

The backup contains the whole portal database, including account/session records and encrypted settings. Keep it restricted and apply the government's encryption/retention controls before any real-data backup is moved off host. This tool backs up database bytes only: application images, mounted uploads outside the database, configuration and encryption keys require a separate secured recovery set. The present local fixtures do not prove decryption of nonempty production encrypted records, recover an external upload store, or prove login and job replay after recovery. Deployment restore acceptance must exercise those with a restored isolated application, revoke restored sessions as appropriate, and verify job retries before reconnecting users. Never point a restored rehearsal at SMTP, Payroll, SFTP or production schedulers.

## Department delivery for 2,000 employees

Use a pilot of 25–50 prepared staff in one department. Include permanent, temporary and an intern whose legal category is verified; add a teacher/shift cohort only after its processing path is signed off. Keep each review and portable handover part at 50 or fewer people, with smaller parts for substantial evidence. Forty 50-person parts cover 2,000 employees; these are review units, not a requirement to activate everyone together.

1. **Prepare identities:** HR reviews the actual TechnologyOne Payroll export, exact text IDs, duplicates, appointment/category history, login links, department/division placement and schedule. Reconcile openings, prior service/payouts and pending/future leave using Package 5. No name-based identity matching or default leave entitlements.
2. **Prepare authorities:** record actual dated division approvers, HODs, the independent HR verifier, relevant Secretary/Minister and Chief Secretary. Provide lawful acting arrangements for self-approval and absence. Verify scopes with each real account.
3. **Exercise the pilot:** employee preview/submit, evidence, every consent/grant stage, rejected/cancelled applications, approved amendments, personnel PDF, event cases, Medical boundaries, holidays, service anniversaries, caps and temporary/intern treatment. Use the signed unresolved-policy examples rather than inferred defaults. Reconcile two actual representative Salary Unit cycles and corrections.
4. **Record operational evidence:** capacity on selected infrastructure; encrypted off-host backup plus isolated app restore; keyboard/mobile checks; staff training; named support/escalation owners; assisted-case coverage; one accrual owner and reviewed scheduler operation. Freeze the cohort record and obtain independent review.
5. **Release and observe:** activate each prepared employee through existing independent configuration, keep one approved accrual engine, and check application/Payroll/job queues daily. Record failures and corrections. Pause a troubled cohort through new empty enabled-code configurations, not edits to immutable history. Disable the government scheduler at deployment level for an operational stop; maintain reviewed manual handling until resolved.
6. **Expand:** release the next department only when the same checks pass. Start with 50–100 employees, increase to 100–200 per department wave after support and Payroll reconciliation settle, and retain 50-person review parts. Re-run readiness after transfers or office changes. Expand on evidence, not a fixed target date.

Proposed production recovery targets for owner/IT agreement: RPO one hour and RTO four hours. Choose managed PostgreSQL/PITR or an equivalent supported backup service, encrypted off-host copies, separate secured key recovery and a scheduled restore exercise. Agree named owners and actual retention before enabling production. This is a local logical-restore rehearsal, not implementation of production PITR or off-host scheduling.

## Training and support tabletop

**Employee (20 minutes):** sign in with the verified account/Payroll alias, replace temporary password, inspect balances, preview dates, explain a charge, submit reason/evidence, follow the timeline and find the approved PDF. Demonstrate cancellation of a pending request and ask HR for an approved-grant amendment. Never share passwords or evidence in a support chat.

**Approver (30 minutes):** open Approvals, identify the assigned stage and department, inspect only permitted evidence, consent/reject with a reason, and show how a changed or missing officeholder blocks the stage. Earlier consent does not equal the Chief Secretary grant. A self-application requires a verified substitute.

**HR and Salary Unit (60 minutes):** import review, service/category/intern verification, policy/calendar dates, opening certification, independent activation, event determinations, amend/reconcile, Payroll version/correction export and actual receipt, then cohort readiness and handover. Repeat an already completed action to show idempotency; resolve a deliberately stale snapshot by preparing a new review.

**Operator (45 minutes):** check health and scheduler flags, inspect failed/blocked jobs, take a restricted backup, restore to an isolated environment, compare manifests, validate login/holds/PDFs, repeat a safe already-posted job and reconcile the final ledger. Maintain one source of accrual through TechnologyOne handover. Do not use manual database edits to repair balances.

Support sequence: employee raises a request ID and a concise description; departmental HR handles identity/schedule issues within assigned scope; central HR handles certified balances, policy transitions, offices and cases; Salary Unit handles exchange receipts/corrections; IT handles availability, storage, backups and account delivery. Route policy interpretations to the designated policy authority. Use actual names and contact channels in the department's training material. Do not put clinical attachments or passwords in tickets. Record the owner, due date, reference and resolution in the support system chosen for the pilot.

Production acceptance remains open until the real Payroll export, signed policy/calculation examples, actual officeholders, real cycle reconciliation, hosting/recovery evidence and staff walkthrough have been supplied and accepted. Packages 1–6 are locally reviewable foundations for that process.

## Completed local checks

The full PostgreSQL backend suite passed 385 tests across 46 suites with no skipped tests. Frontend verification passed 104 tests with one pre-existing skip; lint and production build passed. Desktop and fresh 390px mobile browser checks covered Staff, balances navigation, Policies, the rollout preview and release dialog. Native keyboard workspace selection worked, with no horizontal overflow or browser errors. This is a focused browser/access review, not a formal screen-reader or WCAG certification.

One synthetic Alias Employee cohort was prepared through the actual UI, downloaded and independently reviewed through the certifier persona. Its two existing synthetic Payroll receipts remained intact, and employee balances were unchanged. The record is labelled local rehearsal; its training/support references explicitly say real department training/contacts are pending. It can be downloaded under Staff → Rollout readiness for the walkthrough.
