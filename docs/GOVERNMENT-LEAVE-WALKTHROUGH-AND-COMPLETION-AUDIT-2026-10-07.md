# Government Leave walkthrough and completion audit

Date: 7 October 2026

The six planned packages have local feature implementations, but the complete workflow and rollout acceptance are unfinished. The portal is ready for a structured review, not yet for release to all government employees. Passing functional tests does not establish real employee configuration, representative Payroll reconciliation, production capacity or recoverability.

This is the current walkthrough for the restored local Finance and Treasury copy at `http://localhost:8081/review/local`. Earlier package guides retain historical navigation and demonstration examples. Use the menu names below for today's review.

## What is ready and what remains

| Package | Available locally | Acceptance still required |
| --- | --- | --- |
| 1 Employee identity and access | Payroll ID records, appointment history, paginated directory, scoped permissions, enterprise offices, controlled onboarding. | Actual Payroll export mapping and identity reconciliation; verified service, contact and appointment facts; real officeholders; correction workflows and user acceptance. |
| 2 Rules and balances | Typed policy drafts, calculation previews, holiday and schedule records, independent opening certification, ledger and reservations. | Authorised source and dates; verified calendar and service treatment; actual balance transition; governed replacement of a published policy during its coverage. |
| 3 Common leave and approvals | Recreation, Medical and Special applications; evidence review; stage-bound approvals; final PDFs; independently approved entitlement jobs. | Configured real employees and offices; signed accrual anchor/proration; full multi-role walkthrough; recovery from unwanted activation/job/opening drafts; policy-transition job handling. |
| 4 Other leave and assisted cases | Parental, teacher, extended Medical, official travel, witness, LWOP, Furlough and long-service cases; controlled amendments and follow-up. | Signed disputed-rule determinations and financial history; broader correction/repeated-amendment handling; unrelated future configuration must not invalidate unchanged pending cases. |
| 5 Payroll and migration | Versioned registers, corrections and receipts; historical leave reconciliation; portable handover exports. | Salary Unit format acceptance; real employee/type reconciliation; two representative Payroll cycles; receiving-system handover rehearsal. |
| 6 Rollout and operations | Cohort readiness/review, disposable population tests, logical database restore rehearsal, proposed training/support procedure. | Planned mixed-load performance gates; complete application recovery; real pilot, support ownership and training; reviewed teacher/roster cohort release; production operations. |

## Local review state

The restored backup contains 29 Finance/Treasury employees, 109 historical balance rows and 6 leave applications. Those employees remain on the legacy regime. At restore there were no verified Payroll IDs, service appointments, Government policy versions, holiday calendars or certified openings. Those facts must come from approved records rather than being inferred from names or historic leave labels.

The owner subsequently saved **Government Leave — Corrected Rules (Review Draft)** for **1 September 2026 through 7 October 2028**. Its ordinary Recreation qualification is 3 months, temporary qualification 12 months, Recreation allowance/cap 20/60 days, Recreation notice 14 calendar days, Medical allowance one 10-day pool with 3 uncertified single-shift occasions, and Special allowance 3 days.

The source reference still says publication authority is pending. The eight-number form is the common numeric configuration, not the whole document: other entitlements also depend on service, schedules, evidence, case determinations and statutory offices.

Keep this version as a draft during the initial walkthrough. Publishing locks its rules and dates. The current implementation only permits a non-overlapping successor after its end date; it cannot yet implement a corrected version beginning inside the published period. Publishing through October 2028 would therefore prevent a normal earlier change through this UI. A governed replacement mechanism is required.

All review changes remain local. Email, external connections and automatic accrual are disabled in this production-copy environment.

## Walkthrough using the current local reviewer

### 1 Leave rules

Open **Settings → Leave policies**. Read the draft's name, status, dates, source and values. **Edit draft** loads the saved values; enter a fresh verification reason when saving. Saving does not publish the policy or migrate an employee's balance.

**Delete draft** moves an unwanted draft into the collapsed **Deleted drafts** list. The confirmation names the draft and requires a reason. **Restore draft** returns it as an unpublished draft. Both changes keep audit history, reject stale revisions and are restricted to central HR. Published policies cannot be deleted or edited. The owner's corrected draft is preserved; deletion/restoration tests use disposable test data.

The historical policy section below retains the existing Finance settings. It is not the editing screen for the new Government version. Medical 7+3 and historical Special 5 need an approved cutover reconciliation rather than an automatic overwrite.

Inspect **Public holidays** and **Weekly work schedules**. An actual Gazette calendar and verified schedules are required before reproducible Government calculations. Do not treat an empty holiday list as proof that no holidays exist.

### 2 Organisation and permissions

Open **Settings → Organisation & approvers**. Confirm Finance and Treasury and inspect dated division, Head of Department and Chief Secretary appointments. An office appointment and an account permission are separate controls: both are needed.

Open **Settings → HR access** to inspect department/division scopes and separate staff, balance, evidence, approval and Payroll capabilities. The employee route preview checks the three enterprise offices; it does not certify the complete statutory route for a particular application.

Additional HR verifier, relevant Secretary and Minister appointments currently sit under **Employees → Government applications & jobs**. This split is a navigation issue to consolidate in the next workflow build.

### 3 Employee identity and onboarding

Open **Employees → Employee list → Manage** to inspect Payroll reference, verified account link, appointment/category/intern facts and the three-office preview. Record missing inputs. Do not invent appointment dates or classify an intern from their name.

Open **Settings → Payroll import** to preview the actual Payroll export when available. Payroll IDs are text, preserving leading zeros. Reconcile conflicts and appointment-versus-person identity before applying.

Open **Settings → Onboarding**. The local migration reviewer can prepare/reconcile, but creating accounts and issuing activation/recovery links additionally require portal administration. Onboarding does not independently activate Government Leave or grant approval rights.

### 4 Existing leave and certified balances

Open **Employees → Existing leave records** to inspect the retained Finance history. Open **Employees → Government balances & service** to inspect verified service bases, exclusions, schedules, calculation previews, openings and ledger movements.

Open **Employees → Payroll & handover → Opening & cutover review** to reconcile prior usage and pending/future leave against the new rules. A different central HR officer certifies the prepared opening/cutover. An approved transition must explain the Medical single-pool conversion and preservation/treatment of historical Special balances.

Calculation previews should explain missing foundations. A missing-data block is useful review evidence; it is not a reason to fabricate data or to post a default allowance.

### 5 Applications and approvals

Open **Employees → Government applications & jobs** to inspect per-employee activation, independently approved entitlement plans, statutory offices, assisted cases and follow-up tasks. Selecting an employee scopes their controls and tasks; the application list remains government-wide within the account's access.

Employee account activation, Government submission activation, policy publication and accrual approval are separate decisions. Automatic jobs remain disabled in this review environment.

Open **Approvals** and **Calendar** to see their available queues and views. The top-level **Overview** and **Report** currently describe retained historical leave. Government applications and Payroll registers have their own views; a consolidated Government management report remains an improvement.

### 6 Readiness

Open **Settings → Rollout readiness** and use **Check cohort** with a real selected cohort to inspect unmet preparation conditions. A readiness record and independent approval track evidence; they do not prove that training, recovery or capacity exercises took place, provision accounts, activate staff or start jobs.

The counts at the top describe existing application queues, not all missing department setup. Zero applications missing officeholders does not mean every employee has a complete approval route. Current automatic readiness supports a narrow ordinary weekly-schedule/common-leave cohort. Teachers, roster employees and multiple Payroll identities need a reviewed supported release path before government-wide rollout.

## Complete multi-role demonstration

Use a separate clearly labelled demonstration dataset or isolated synthetic environment for fabricated personnel facts. The actual restored records should retain their verified meaning.

The demonstration requires a portal administrator, two separate central HR officers, a verified employee, dated division/HOD/Chief Secretary approvers and any HR/Secretary/Minister authority required by the selected case. The local migration reviewer alone cannot demonstrate those distinct roles.

Run this sequence with traceable evidence:

1. Verify the policy, holidays, identity, appointments, service and schedule.
2. Reconcile and independently certify openings and retained leave.
3. Independently activate the employee for the supported types.
4. Sign in as the employee, inspect balances, preview dates and submit reason/evidence.
5. Complete the displayed approval stages. Show rejection, cancellation, a stale-input rejection and a safe retry.
6. Confirm the Chief Secretary final grant, immutable personnel PDF, balance usage and Calendar entry.
7. Complete Salary Unit acknowledgement, prepare a register and independently reconcile the receipt.
8. Demonstrate an authorised amendment and its ledger/Payroll correction.
9. Reconcile two representative Payroll cycles and review a department cohort with real training, support, recovery and capacity evidence.

## Remaining work in delivery order

| Priority | Work | Acceptance example |
| --- | --- | --- |
| First | Govern published policy replacement and dated calculation/job transitions. | A corrected version begins during existing coverage without changing old granted PDFs or double-posting accrual. A fortnight spanning the change has an explicit approved calculation. |
| First | Restrict assisted-case snapshots to materially consumed foundation records. | Publishing an unrelated future policy leaves an unchanged pending official-travel case approvable; changing its actual rules, service or evidence still invalidates it. |
| Next | Complete correction and unwanted-draft recovery for activation, job plans, opening previews and appointment history. | A wrong draft or appointment/category can be corrected through a visible governed action without SQL edits, fabricated records or accidental approval. |
| Next | Consolidate all approver offices and add a guided preparation/readiness path. | HR can find every applicable office in one setup flow and distinguish permission, appointment, evidence verification and final grant. |
| Next | Support reviewed teacher/roster cohort release and disclose special-regime limits. | A supported teacher/shift pilot can pass an appropriate readiness gate without being forced into the ordinary Recreation formula. |
| Next | Improve Government Overview/Report, amendment coverage and operational queue handling. | Management sees Government requests/balances; support can resolve intended correction cases; the operating procedure states whether notifications/reminders are available. |
| Before production | Run the original performance gates, full recovery and real pilot acceptance. | Mixed 100/200-session workloads, 30 simultaneous writes and 100 sign-ins over 60 seconds meet the approved targets; restored login, files, keys and job replay work; two real Payroll cycles reconcile. |

The existing capacity harness uses 2,000 employee records but only 50 concurrent record reads and 10 concurrent password logins. Its recorded sign-in p95 of 2.46 seconds does not meet the earlier proposed 2-second target; its own pass budget is 10 seconds. It does not load-test simultaneous grants/amendments. The logical restore rehearsal verifies database rows, holds and triggers, not complete restored application operation. These are useful rehearsal results, not completed original acceptance gates.

No Government workflow notification service is implemented. Queues currently serve as the work list; agree and test the interim operating procedure before pilot release.

## Checks completed in this review

The disposable PostgreSQL backend suite passed 396 tests across 46 suites with no skipped tests, including audited edit/delete/restore, authority, stale changes, concurrent actions and rollback. Frontend verification passed 104 tests with one existing skip; lint and production build passed. Desktop and 390px browser review covered the draft actions and confirmation dialog, with no horizontal overflow. The corrected policy was not deleted or published.

The local copy still has 29 legacy employees, 109 historical balances, 6 historical applications, one active Government policy draft, no deleted policy drafts, no published Government policies, no Government calendars, no work patterns and no Government applications. The owner changed the draft start date to 1 September during review; that saved change is retained.

## Evidence and review scope

Three independent agents reviewed delivery/acceptance evidence, frontend journeys and backend policy/workflow controls. This was a bounded source audit, including a pure-function reproduction of the unrelated-future-policy case invalidation. The graph is at the older original-checkout generation, and new Government files have missing freshness; agents used actual worktree source rather than claiming graph completeness. This is not legal sign-off, a production security certification or an exhaustive verification of every policy branch.

Primary references: [build backlog](GOVERNMENT-LEAVE-BUILD-BACKLOG-2026-10-06.md), [original structure/capacity plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md), [Package 4 limits](GOVERNMENT-LEAVE-PACKAGE-4-REVIEW-2026-10-07.md), [Package 5 acceptance](GOVERNMENT-LEAVE-PACKAGE-5-REVIEW-2026-10-07.md), [Package 6 evidence](GOVERNMENT-LEAVE-PACKAGE-6-REVIEW-2026-10-07.md), and [production-copy review](GOVERNMENT-LEAVE-PRODUCTION-COPY-REVIEW-2026-10-07.md).

The principal remaining code paths are `services/governmentLeave.js` / `governmentLeaveSchema.js` for immutable dates and non-overlap; `lib/governmentLeaveCaseRules.js` / `services/governmentLeaveCases.js` for broad snapshot invalidation; `services/governmentLeaveJobs.js` for multi-policy fortnights; `services/governmentLeaveRollout.js` for standard-cohort restrictions; and `app/backend/scripts/leave-capacity.mjs` / `scripts/leave-restore-rehearsal.mjs` for the narrower operational rehearsals. Backend paths above are relative to `app/backend/src` except where stated otherwise.
