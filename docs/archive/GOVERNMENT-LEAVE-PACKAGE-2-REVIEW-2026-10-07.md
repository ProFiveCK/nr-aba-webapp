# Package 2 — policy, calculation and balance foundations

Package 3 update: common submissions and staged approvals are now available after independent employee activation. Follow the [Package 3 review guide](GOVERNMENT-LEAVE-PACKAGE-3-REVIEW-2026-10-07.md) for the current runtime and examples. The steps below record the Package 2 handoff.

Date: 7 October 2026. Status: implemented and verified locally; ready for owner review. Government employee submission remains gated until Package 3. No push, pull request or production deployment.

## Open the running Docker application

[Central HR review](http://localhost:8081/review/hr) → Leave → Staff → **Policy & balances**. The three tabs are **Policy & calendars**, **Employee calculation**, and **Opening certification**.

| Review persona | Link | Purpose |
| --- | --- | --- |
| Central HR | http://localhost:8081/review/hr | Manage policy, service, schedules, opening previews and audited corrections |
| Independent HR certifier | http://localhost:8081/review/certifier | Certify another officer's reviewed opening |
| Employee | http://localhost:8081/review/employee | See personal certified government entitlements separately from historical balances |
| Departmental HR | http://localhost:8081/review/scoped | Review existing departmental scope restrictions; central policy controls are unavailable |

These links change the session in that browser. The synthetic gateway runs only in the dedicated development stack against the actual `leave_review` database. It does not create a production login path. Normal account activation/login is still available from Package 1E.

The application runs from `/Users/teuteulilo/.codex/worktrees/employee-account-foundation/nr-aba-webapp`. React/Vite reloads frontend source changes; Node watches backend source changes. A backend edit can briefly interrupt API requests during restart. Changes to dependencies, Compose configuration or review scripts require restarting the stack.

```bash
cd /Users/teuteulilo/.codex/worktrees/employee-account-foundation/nr-aba-webapp
./scripts/leave-review.sh up
./scripts/leave-review.sh status
./scripts/leave-review.sh logs
./scripts/leave-review.sh stop
```

`up` builds and starts the stack, waiting for API/frontend readiness; the first dependency install can take a few minutes. Dependencies and their manifest hash/cache persist between restarts; `stop` retains the review database. Docker must be running. Containers restart with Docker unless explicitly stopped. Only the web application is exposed, on loopback port 8081. PostgreSQL and API ports stay internal. The named database, uploads and client-dependency volumes belong to `ron-leave-review`; they do not reuse the shared development/production volume. Generated credentials stay in ignored `.leave-review/runtime.env`. Keep that file when restarting the retained database. SMTP, AI and scheduled accrual are disabled for this review.

This machine's earlier synthetic preview data was copied once into the new isolated database. The seed adds missing synthetic review identities and an explicit sample work pattern/appointment; it does not reactivate offboarded accounts, certify policy or fabricate balances. A fresh stack requires the review steps below to configure these foundations. No real TechnologyOne Payroll export was imported.

## What Package 2 implements

| Foundation | Implemented behaviour |
| --- | --- |
| Policy versions | Typed parameters, dated coverage, authority reference, draft and publish; published versions cannot be edited/deleted and cannot overlap. Each version records evaluator `gov-foundation-1`. |
| Service | Certified continuity origin, explicit calendar or excluded-service anniversary treatment, explicit February 29 convention; temporary/category/teacher/intern distinctions use the verified appointment history. Unknown credit, gaps and continuity breaks block calculation until resolved. |
| Calendar and schedules | Approved calendar coverage, actual/observed holidays supplied explicitly, verified five-day seven/eight-hour weekly conversion or employee/date roster conversions. Roster days include explicit off-duty days. Calendar and roster corrections create successors preserving prior records. |
| Evaluation | Server-owned policy-day charges and separate scheduled hours; daily segments preserve policy, calendar, service, schedule and entitlement-period references. An evaluated request is read-only and cannot post usage. |
| Openings | Explicit service year, cutover date, amount, HR source and Salary Unit reconciliation reference. Preview preserves historical balances. A different central HR officer certifies it; changed source context invalidates a stale preview. |
| Ledger | Exact six-decimal arithmetic; immutable opening, accrual/grant/use/expiry/correction/reversal records. Corrections require authority and reason. Reversal posts an opposite movement without deleting the original. |
| Reservations | Internal Package 3 contracts lock employees/entitlements, evaluate again under locks, reserve once, and release/consume once with mandatory server authority callbacks. Held entitlement cannot be spent by another request or negative correction. No public reservation or grant endpoint is enabled. |
| Access and audit | Central HR owns configuration and certification. Employee/scope checks protect calculation and balances; ledger history requires ownership or balance access. Every new mutation and posting records audit within the same transaction. |

Ordinary recreation uses the owner's **three-month** threshold; temporary recreation retains **twelve months**. Default typed rules contain recreation 20 days/year, cap 60 and 14 calendar days' notice, one Medical 10-day pool and Special 3 days. These are policy parameters, not automatically credited opening balances.

Intern is a separate designation. A temporary intern follows the temporary category; an unknown-category intern needs HR determination. Teacher recreation and non-common event cases remain assisted and blocked from automated charging. Temporary parental and permanent-only LWOP restrictions are represented in evaluation; their case workflows follow in Package 4.

Recreation and Medical exempt supplied public holidays; Special remains charged on scheduled days. Medical multi-day requests require a certificate indication in preview; actual document verification and the three uncertified single-day occasions counter belong to Package 3. No certificate checkbox alone authorises a grant. Preview identifies the division → HOD → relevant additional statutory consent → Chief Secretary requirements; execution, acting substitutions and Salary Unit acknowledgement remain to build.

## Review the retained synthetic example

1. Open central HR and **Policy & balances**. Inspect the published synthetic policy, verified five-day seven-hour pattern and synthetic calendar. Its **2 November 2026 holiday is a test example, not a gazetted government holiday**.
2. Choose **Employee calculation**, search `DEMO-1E-00001-A`, select **Synthetic 1E Alias Employee**, and load the foundations. Inspect the certified service basis and Recreation balance of 20 policy days.
3. Evaluate Recreation from **2–3 November 2026**. With the synthetic calendar it charges **one policy day**, with the daily calculation explaining the exempt holiday. Submission remains closed.
4. Inspect movement history: opening +20, synthetic correction +0.5 and its reversal −0.5 reconcile to 20. History remains visible.
5. Open the employee link. The certified government balance is separate from the historical local table, and there is no government submission button.

To try another opening, first verify an employee's appointment and service basis, then prepare Medical or Special with explicit reconciled amounts and service-year dates. Change to the independent certifier link to certify it. Prepare and certify one opening at a time: any change to employee/policy/calendar/balance context invalidates other pending previews. Missing information produces an actionable block; it does not create a default allowance.

Published policy needs a non-overlapping successor for future coverage. Calendar corrections require an explicit current predecessor with identical coverage. Correct a wrongly recorded service exclusion by withdrawing it with a source/reason, then recording the verified replacement. A continuity break requires a new certified basis. Irregular schedules need approved paid hours and policy-day conversion for every date, including off days; a 12-hour shift is never silently treated as one day.

## Inputs and work still required

The supplied policy is sufficient for the common typed defaults, but not for automatic activation of every case. HR/Salary Unit still need to approve effective policy dates, actual holidays/observance, service-credit and anniversary treatments, leap-day treatment, roster conversions, employment category mappings, opening balances and reconciliation references. The payroll accrual anchor, rounding/proration and treatment of historical pending/future requests need explicit cutover decisions. Historical Special 5-day balances and split Medical types are retained; no automatic reduction or merge occurs.

Government employees are excluded from the legacy accrual job. Government accrual scheduling, annual Medical/Special grants, verified medical counters, common application forms, stage execution and final-grant postings are **Package 3**. Internal ledger/reservation support is tested, but does not represent an enabled submission workflow. Assisted leave is Package 4; bulk cutover reconciliation, retained pending/future requests and payroll exchange are Package 5.

The directory uses bounded employee search. Opening and ledger lists use 50-row pages; central configuration returns the latest 100 records. A calculation covers at most 366 dates and service verification is bounded to 50 years. These safeguards and existing synthetic 2,000-account tests do not establish 2,000 simultaneous-user capacity. Response sizing, representative concurrent workload, restore/recovery and department-wave acceptance remain Package 6.

## Verification

The complete real-PostgreSQL backend suite passes **295 tests**. The frontend suite passes **104 tests**, with one existing skip; lint and production build pass. Integration cases cover independent/stale/duplicate openings, preserved legacy balances, immutable records, exact precision, concurrent holds, retry keys, release/consume transitions, held-balance protection, authority checks, successor calendars/rosters, withdrawn exclusion replacement, scoped HTTP access and audit-failure rollback. Pure cases cover category/intern thresholds, notice, holiday charging, excluded service, leap days, policy/service-year splits, unknown evidence, roster conversion and unsupported evaluator versions.

The Docker browser walkthrough covers policy/calendar publication, weekly conversion, service basis, independent opening certification, holiday-exempt preview, correction/reversal and personal certified balances at desktop/mobile widths. No browser page errors or horizontal overflow were observed. A final browser pass confirms live frontend updates through the Docker proxy, API health, current evaluator version, readable primary-button hover contrast and the retained desktop/mobile calculation.

Next: **Package 3 — common leave and statutory approvals**, retaining these calculation snapshots and reservation controls through division/HOD/Chief Secretary decisions.
