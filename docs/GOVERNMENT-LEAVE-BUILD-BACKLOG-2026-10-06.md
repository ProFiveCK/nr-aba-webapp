# Government Leave build backlog and delivery order

Date: 6 October 2026

Status: Packages 1A–1E and Packages 2–6 implemented locally; the isolated Docker application is ready for owner walkthrough. Production and real pilot acceptance remain open.

Build the interim portal in six reviewable packages, beginning with employee identity, access control, and calculation foundations. Automate common leave and provide an authorised case process for less common or disputed calculations. The portal will own leave for the expected six-to-twelve-month gap; live TechnologyOne Leave integration is deferred.

The [policy summary and implementation plan](GOVERNMENT-LEAVE-POLICY-IMPLEMENTATION-PLAN-2026-10-06.md) supplies the detailed rules, source references, configuration assessment, and migration requirements. This backlog turns that plan into an execution order with dependencies and completion criteria.

## Confirmed implementation choices

- Ordinary recreation leave uses three months of initial continuous service, as directed by the owner. Temporary recreation retains the separate twelve-month rule; teacher recreation is discretionary.
- TechnologyOne Payroll employee IDs will be the external staff reference. Keep existing portal UUIDs and preserve exported IDs as text.
- Temporary employees retain medical, Special, and official travel access. The documented temporary parental exclusion and LWOP exclusion remain in place.
- Intern designation is recorded separately from employment category. HR determines the applicable appointment terms; there is no invented intern entitlement or blanket exclusion.
- Medical leave is one ten-day allowance with an uncertified-absence counter inside it. Special leave is three days under the supplied policy. Existing local balances and historical types need an approved transition, not an automatic reduction.
- The owner specified division approver → Head of Department → Chief Secretary final approval on 6 October. Configure this enterprise chain alongside any additional Secretary/Minister consent required by the supplied policy. Salary Unit acknowledgement is a subsequent payroll action. HOD delegation of Chief Secretary grants is not assumed.

Package 1's backend foundation, Payroll import/reconciliation and management UI are implemented locally. The [Package 1 structure and 2,000-employee rollout plan](GOVERNMENT-LEAVE-PACKAGE-1-STRUCTURE-2026-10-06.md), [Package 1B contract and review guide](GOVERNMENT-LEAVE-PAYROLL-IMPORT-2026-10-07.md) and [Package 1C review guide](GOVERNMENT-LEAVE-PACKAGE-1C-REVIEW-2026-10-07.md) record what exists and what remains. [Package 1D scoped-access review](GOVERNMENT-LEAVE-PACKAGE-1D-REVIEW-2026-10-07.md) covers the implemented departmental boundaries. [Package 1E onboarding review](GOVERNMENT-LEAVE-PACKAGE-1E-REVIEW-2026-10-07.md) covers the completed cohort/account lifecycle work. [Package 2 review guide](GOVERNMENT-LEAVE-PACKAGE-2-REVIEW-2026-10-07.md) covers policy versions, verified service/calendar segments, certified openings and ledger/reservation controls. [Package 3 review guide](GOVERNMENT-LEAVE-PACKAGE-3-REVIEW-2026-10-07.md) covers common employee applications, evidence/counters, statutory approvals, immutable PDFs and independently approved jobs. [Package 4 review guide](GOVERNMENT-LEAVE-PACKAGE-4-REVIEW-2026-10-07.md) covers event/assisted cases and governed amendments. [Package 5 review guide](GOVERNMENT-LEAVE-PACKAGE-5-REVIEW-2026-10-07.md) covers versioned Salary Unit exchange, independent migration/legacy transfer and portable handover rehearsal. [Package 6 review guide](GOVERNMENT-LEAVE-PACKAGE-6-REVIEW-2026-10-07.md) covers the consolidated UI, cohort release evidence, capacity and restore rehearsals, training and rollout operations. **Next is the owner walkthrough and real pilot acceptance.** Government common submissions require explicit per-employee activation; legacy grants remain blocked.

## Work that can start now

Every package can be developed and tested with synthetic staff, schedules, and balances. Actual payroll data, officeholder assignments, and certified openings are activation inputs rather than reasons to postpone the foundation work.

| Package | What to build | What completes it |
| --- | --- | --- |
| 1 Employee identity and controlled access | Payroll ID field, category/service records, import preview, verified login linking, department scopes. | IDs survive round trips unchanged; repeated imports do not duplicate employees; cross-department reads/writes and unverified login claims are rejected. |
| 2 Policy and balance foundations | Effective rule versions, server evaluation, service/calendar segments, ledger and reservations, safe opening-balance migration. | Calculations are explainable and reproducible; concurrent requests and retries cannot spend or post the same entitlement twice. |
| 3 Common leave and statutory approvals | Recreation, Medical, Special, notice/evidence checks, consent/grant stages, employee preview, approval timeline, PDF snapshots. | Standard-work-pattern policy cases pass; every required authority acts; balances, usage, and personnel-file PDFs reconcile. |
| 4 Other leave and assisted cases | Event applications, teacher cases, LWOP, parental/extended-medical cases, witness, long service/furlough and financial-case recording. | Every enabled cohort has an authorised route for applicable leave, with evidence, decisions, validated charges/pay segments, and controlled amendments. |
| 5 Payroll and migration rehearsal | Versioned register/export, acknowledgement/corrections, certified openings, retained pending/future leave, portable handover exports. | Imports and payroll batches reconcile per employee/type; repeated exchange or correction cannot duplicate usage or payments. |
| 6 Pilot and rollout readiness | Responsive/accessibility review, realistic capacity testing, backup restore, support/training, department-wave activation. | Pilot cases and two representative payroll cycles reconcile; the next cohort has verified records, authorities, work patterns, and supported entitlements. |

Packages 4 and 5 use the foundations from Packages 1–3. Their forms, export schema, and test fixtures can be prepared earlier, but production postings must use the same ledger and approval controls.

## First package

Start with these tickets in this order. This produces a usable staff foundation while the Payroll export is being prepared.

| Ticket | Implementation | Acceptance criteria |
| --- | --- | --- |
| LEAVE 01 Employee reference | Add external Payroll IDs as text with source/import provenance, separate from existing employee UUIDs. Introduce effective employment category, status, service dates, teacher/intern designations and work patterns; preserve several source IDs where appointment history requires them. | Leading zeros and letters preserved; category changes recorded with dates; missing ID/category appears as an explicit review issue. Existing employees and leave records remain intact. |
| LEAVE 02 Access scopes | Add server-enforced department/division scope assignments and distinct HR, evidence, grant, payroll, and central-administration permissions. | Scope applies to employees, applications, balances, PDFs, attachments, reports, imports, and exports. Central access is explicit. Self-approval remains prohibited. |
| LEAVE 03 Import preview — local implementation complete | Separate Payroll CSV review flow maps exact IDs and proposed employee/appointment fields. Preview saves a review batch without changing employees; HR reconciles identities/skips and applies atomically. | Repeat/concurrent application is safe; names alone do not merge people; malformed dates and duplicate references block or require explicit skips. Imports do not overwrite balances. Native Payroll export mapping still needs the actual source file. |
| LEAVE 04 Verified login linkage | Replace automatic name-based claiming with HR-confirmed login-to-employee linkage or a controlled identity claim. Add employee-only account onboarding, review email/Payroll-ID sign-in coverage, and reconcile existing links. Configure dated division/HOD/Chief Secretary officeholders in the same enterprise structure. | A matching name or knowledge of a Payroll ID cannot claim another employee's leave history. Link/unlink actions have an audit trail and revoke obsolete access. Employee-only accounts do not inherit finance access; government final approval cannot use the legacy decision endpoint. |

Use CSV as the initial supported import contract; an XLSX export can be converted through a reviewed mapping or supported directly if required. Confirm whether a Payroll ID identifies a person or an employment record before fixing its uniqueness scope. Retain any source employer/assignment key needed to distinguish legitimate multiple employments.

The incoming export should contain Payroll ID, name, department/division, employment category, status, original appointment/service date, and contract end date where applicable. Position, work pattern, email, and supervisor ID improve setup. A transfer date or system-entry date must not silently replace continuous-service evidence.

## Foundation and common leave tickets

| Ticket | Implementation and dependency | Acceptance criteria |
| --- | --- | --- |
| LEAVE 05 Policy evaluation | After LEAVE 01, introduce stable leave codes and versioned, typed rule parameters. Add a server evaluation endpoint used by preview, submission, and final grant. | Tests distinguish ordinary three-month recreation, temporary twelve-month recreation, temporary Medical/Special access, and unknown intern classification. Historical decisions retain their governing version. |
| LEAVE 06 Service and absence segments | Depends on LEAVE 05. Record continuity, excluded service intervals, schedule/holiday versions, and per-day/shift absence segments. Implement standard work patterns and an interface for approved non-standard patterns. | Requests split at entitlement and payroll boundaries; holidays apply only to authorised types; missing roster data does not silently become a weekday calculation. LWOP pauses credited service and resignation/reappointment breaks continuity. Unsettled anniversary cases require reviewed determination. |
| LEAVE 07 Ledger and reservations | Depends on LEAVE 05–06. Add grants/accrual/use/expiry/correction/reversal events, holds by entitlement period, deterministic locks, and unique request/job event keys. | Concurrent applications cannot over-reserve a balance; cancellation/rejection releases once; final grant posts once; retries are safe. Opening snapshots, movements, closing balances, and holds reconcile. |
| LEAVE 08 Recreation | Depends on LEAVE 05–07. Implement approved service gates, fourteen-day notice, fortnightly accrual, cap stop/alerts, and public-holiday exclusions. | Three-month ordinary and twelve-month temporary tests pass; thirteen-day notice fails and fourteen-day notice passes; sufficient internal precision preserves the signed annual quantum. Accrual is inactive until the actual anchor, proration, and opening data are configured. |
| LEAVE 09 Medical and Special | Depends on LEAVE 05–07. One ten-day medical allowance, uncertified single-absence counter, certificate checklist, three-day Special grant, and service-anniversary expiry/regrant. | Eight or ten certified medical days can use the same ten-day pool. Counter cannot exceed the authorised three single non-consecutive exemptions. Temporary access works. Backdating, cancellation, roster adjacency, and LWOP boundary exceptions have tests or explicit reviewed handling. |
| LEAVE 10 Required authorities and UI | Depends on LEAVE 02 and 05–09. Execute the division → HOD → Chief Secretary chain against Package 1's dated officeholders, plus required special consent/grant steps. Add acting/delegation and self-approval substitutes. Update forms, queues, timelines, explanatory errors, and final-grant PDFs. | Earlier-stage consent does not complete a Chief Secretary grant. Missing officeholders block final grant with an actionable queue item. Required evidence and authority are rechecked; a transfer cannot rewrite a pending route silently. No stage relies on client-supplied charges or an admin bypass. |

Develop these capabilities incrementally behind feature flags and cohort scopes. The source document's remaining ambiguities must be visible in the case workflow rather than hidden behind silent defaults.

## Other leave and payroll tickets

| Ticket | Implementation and dependency | Acceptance criteria |
| --- | --- | --- |
| LEAVE 11 Event and assisted cases | Depends on LEAVE 06–07 and 10. Add structured cases for parental, extended Medical, official travel, teacher recreation, witness, permanent LWOP, LSL/furlough, encashment, and separation benefits. | Event leave does not need a fake annual balance. Cases record event, evidence, deciding office, dated charge/pay segments, determination reason, and follow-up tasks. Unsettled combinations remain reviewed rather than automatically granted. |
| LEAVE 12 Payroll register | Depends on LEAVE 07 and 10–11. Export approved absence/pay segments by pay period and Payroll ID, with batch version, totals, acknowledgement, and correction links. | Full/partial/unpaid salary instructions are distinguishable. Re-export is identifiable; amended grants generate corrections. An ordinary approval does not create an ABA payment. The Salary Unit's actual format is an activation input. |
| LEAVE 13 Opening data and cutover | Depends on LEAVE 03 and 07–12. Reconcile existing records and leave types, medical-pool conversion, approved future leave, pending reservations, certified openings, service history, and prior payouts. | Per-employee/type dry run explains every difference. Keep historical type IDs and PDFs. No local five-day balance is reduced without an approved transition. Rehearsal uses a restored test database before a pilot cutover. |
| LEAVE 14 Pilot and handover exports | Depends on LEAVE 13. Test operational controls, train users, activate a prepared cohort, and export portable identity/service/balance/workflow records. | Access, responsive UI, realistic volume, job retry, and restore checks pass. Payroll cycles reconcile. A later HRIS cutover can carry future and pending leave without enabling two accrual engines. |

LEAVE 11 should initially automate clear validations and retain controlled HR determination for disputed amounts or routes. Later releases can automate those branches after signed examples; the initial supported cohort still needs a processing route for each applicable entitlement.

## Matters that need decisions or data

| Input or decision | Work that can proceed | Activation constraint |
| --- | --- | --- |
| Payroll export and opening balances | Build import schema, preview, reconciliation, and tests with synthetic data. | Verify imported identities/service dates and obtain certified openings before posting real accrual or deductions. |
| Payroll anchor and proration | Build precise accrual, job idempotency, cap handling, and tests. | Configure the approved period anchor, partial-period method, and annual reconciliation before scheduling production runs. |
| Statutory officeholders | Build role/scoping and staged workflow. | Assign actual offices and scopes before grant. Continue the documented Chief Secretary route unless lawful delegation is supplied. |
| Shift-day conversion | Build roster storage, segment interface, and missing-data checks. | Automatic charging for unsettled twelve-hour/overnight examples awaits HR agreement. Approved cases can supply explicit, audited charge/pay determinations. |
| Probationary and intern categories | Build designation, category mapping, and review queues. | Assign rights only from the verified appointment category/regime; no inferred blanket inclusion or exclusion. |
| Maternity threshold and fifth-pregnancy overlap | Build event forms, restricted evidence, pay segments, and case decisions. | That combination needs an authorised determination until salary-rule precedence is confirmed. |
| Teacher and unpaid Witness routes | Build separate case types, evidence and office-based decisions. | Confirm the teacher form/timesheet sequence and unpaid Witness deciding authority before completing those routes automatically. |
| Medical roster adjacency and LWOP anniversaries | Build counter/service history and explicit exception handling. | Sign off worked boundary examples before automatically deciding ambiguous cases. |
| Long service and furlough history | Build service thresholds and case/encashment records. | Verify prior usage/payments and transition treatment before posting a new entitlement or payout. |
| Salary Unit export format | Build a versioned generic register and acknowledgement UI. | Salary Unit approves the exchange contract and reconciles trial batches before payroll use. |

The three-month ordinary recreation choice is settled and is not a pending decision in this backlog.

## Verification and release sequence

Keep repository work in an isolated feature worktree and preserve unrelated changes. Use additive schema changes under current conventions and reversible feature flags. Treat the packages as coherent review units: verify them locally before a PR, and do not use CI as the first test run.

For changed calculation functions run the backend unit suite; for locks, ledger, workflow, imports, or scope use the real-PostgreSQL integration suite. For frontend work run relevant tests, lint/build, and inspect desktop/mobile browser states. Add meaningful tests for entitlement boundaries, concurrent posting, and access scope. Expand testing when a new failure or change justifies it.

Prepare a verified pilot population with certified data, all required authorities, published calendars/work patterns, and supported cases. Reconcile trial calculations and two representative payroll cycles, including boundary scenarios not exercised by those cycles. Then expand by departments after each wave meets the same readiness conditions. The deployment and cohort activation remain separate from preparing code and PRs.

## Immediate execution recommendation

Begin Package 1 with LEAVE 01–04. Follow with the policy evaluator, service segments, and ledger before changing leave deductions. Then implement Recreation, Medical, Special, statutory approvals, and the assisted-case route for the pilot. Payroll export and migration follow the same posting controls.

The owner's next data contribution is the TechnologyOne Payroll export. HR/Salary Unit also need to certify opening balances, service dates, officeholders, the payroll accrual anchor, and trial export acceptance. Development of the first package can start while those inputs are prepared.
