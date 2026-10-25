# Leave workflow consolidation review — 7 October 2026

Independent review of the local `codex/employee-account-foundation` checkout, starting at `c8eca87`. This review concerns the existing Leave implementation for approximately 2,000 employees across 50 departments/divisions. It does not change policy, certify personnel records, approve a release, or alter any employee data.

## Assessment

The existing controls protect important history and approvals, but the interface exposes implementation modules as competing destinations. An HR officer must find the same employee independently in the directory, retained records, Government balances, workflow controls, and opening reconciliation. A published policy has no visible relationship to that employee's current operating arrangement. Organisation configuration combines several full registers and forms on one page. These are substantial usability problems, not merely naming issues.

Preserve the rules and approval controls. Consolidate the entry points around an employee, a department, or a work queue. Present the current state and the next permissible action before showing configuration detail.

## Findings and required changes

| Priority | Finding at review baseline | Required result |
| --- | --- | --- |
| P1 | `EmployeeManagement.tsx` offers five employee destinations; `EmployeeDetails.tsx` omits the operating leave arrangement and balances. `employeeProfile` does not select `leave_policy_regime`. | One directory and employee workspace. Show current arrangement, balances, policy coverage, activation state and actual routing together. Preserve the employee when moving to service, balances, reconciliation or workflow controls. |
| P1 | Publishing Government rules does not transition retained employees or balances. The Policies page describes configuration without making this practical distinction prominent. | Publication explains exactly what changes: Government calculations select the published version for each covered date. Existing records require a reviewed employee transition; publication is not a balance conversion, activation or accrual run. |
| P1 | Enrollment changes which submission/decision endpoints are allowed before Government activation. | Show a distinct “Government preparation” state when enrolled but not enabled. Before an enrollment action, explain that retained leave submissions/decisions will stop and Government submissions remain unavailable until preparation is complete. Do not call enrollment “active leave”. |
| P1 | A reporting manager and dated officeholders coexist, but the employee details do not state which controls the employee's operational leave route. The three-office preview is only part of the Government route. | Label Reporting manager separately. Display the effective common-leave route including HR verification and relevant Secretary consent where applicable. Additional case approvals must remain case-specific. Office assignment does not itself grant permission or activate leave. |
| P2 | `OrganisationManagement.tsx` renders every department with division entry controls, up to 50 appointment cards, statutory offices and work patterns together. | Searchable compact organisation list, bounded pagination, and one selected department editor. Filter appointment registers by department/office/status; distinguish current, upcoming and ended appointments. Government-wide offices have a clear separate context. |
| P2 | Work pattern creation is in Organisation while conversion verification is in Policies. Retained Staff tools also expose employee details and import entry points. | One work-schedule owner under Policies; employee records reference it. One employee details editor and setup entry point. Retained balances/history remain accessible without a second employee-management directory. |
| P2 | The policy publication dialog says changes within a published period are unsupported, while the same component offers a prospective replacement workflow. | Explain the supported successor/replacement process consistently and retain immutable prior decisions. Remove the obsolete contradiction. |
| P2 | Government workflow selection scopes controls and follow-up tasks but explicitly leaves the application list global. Opening certification and migration review queues likewise sit beside selected-employee controls. | An employee workspace must scope all displayed employee records, or mark and link a global queue distinctly. No selected-person heading above unexplained records for other people. |
| P2 | Setup and operational text uses “foundations”, “jobs”, “regime”, “cohorts”, demo/package references and several nested headings. | Everyday labels: Leave arrangements, Service history, Balances, Prepare Government leave, Balance updates, Account setup. Keep technical references in expandable audit details. Keep the original signed names/references intact. |

## Verified behavior that the interface must explain

These are observations about the implementation, not additional Government policy requirements.

1. **Policy publication:** `governmentLeave.js::publishPolicy` marks the policy version published and records the audit event. `governmentLeaveRules.js::calculateEvaluation` selects a published version for each requested date. It does not rewrite retained employee balances or enroll all employees. The policy's effective dates and publication date are different concepts.
2. **Enrollment and account setup:** `employeeDirectory.js::provisionEmployeeAccount` changes the employee to Government leave. `EmployeeOnboarding.tsx` explicitly says applying a verified cohort also enrolls retained logins. The retained routes in `hr.js` block submission and decisions when the employee regime is Government **or** the linked/requesting account is an employee account. A summary based only on the regime field can therefore be misleading.
3. **Opening preparation and certification:** `governmentLeave.js::prepareOpening` requires Government enrollment, a published policy covering the opening date, and a valid certified service year. `certifyOpening` requires a different central HR officer, rejects changed snapshots and overlapping entitlement periods, then posts an opening once. Historical balances are retained in the snapshot rather than silently merged or reduced.
4. **Historical and future leave:** `governmentLeaveCutover.js::assertCutoverResolved` blocks unresolved externally retained cases where a certified transition plan requires resolution. Transfers preserve the source and require the new Government approvals. The UI must show what needs reconciliation and link to the same employee's review.
5. **Application activation:** `governmentLeaveWorkflow.js::prepareConfiguration` and `publishConfiguration` validate service, current certified entitlements, policy/calendar and transition facts; publication needs a different central HR officer and unchanged foundations. Enabled leave codes are separate from the existence of an account or a published policy. A published configuration may deliberately contain no enabled codes.
6. **Approval route:** `routeLevels` for common leave is Division → Department → HR verifier → relevant Secretary for Recreation/Medical → Chief Secretary. `effectiveOffices` resolves office assignments effective on the current Nauru date using the application department/division. The reporting manager is not substituted into this Government sequence. Pending stages retain bindings and can require explicit HR reassignment if the dated appointment, verified account or permission changes. An arbitrary-date three-office preview is not proof a particular application is ready.
7. **Accrual:** Job-plan preparation/approval and running due updates are separate operations. The existing UI requires recorded authority for Payroll anchor, proration, rounding and temporary-service treatment. A published policy alone neither schedules nor posts accrual. Do not add new automatic behavior as part of a navigation repair.
8. **Release review:** `GovernmentRollout.tsx` records readiness and independently reviewed operational evidence. It states that cohort review does not activate employees or change balances. Keep this distinction, but place it with rollout operations rather than ordinary employee editing.

The owner reports a corrected Government policy was published on 07/10/2026 covering 01/09/2026–07/10/2028. This reviewer did not query or change live/local personnel rows; the interface must display the actual saved version/status/dates rather than hard-code that report. All user-facing dates remain Australian DD/MM/YYYY.

## Proposed information architecture

**Employees** opens the existing server-paginated directory. Search by employee or exact Payroll ID and filter by department, status and preparation issue. Manage opens one employee workspace with a persistent name and placement. Its first section, Leave arrangements, shows:

- Current operating arrangement and whether submission is enabled, being prepared or paused.
- Current retained balances and Government certified balances as separate, clearly dated records; never add them together or imply they are equivalent pools.
- Applicable Government policy and coverage, with a clear explanation if this employee still uses retained arrangements.
- Current reporting manager and the operational leave route, each correctly labelled.
- The next necessary action, linked into this employee's service, balance, reconciliation or activation controls.

Keep Details, Service history, Leave records and Prepare Government leave as local sections. Preserve selection when opening a tool, refreshing, returning or using a deep link. Changing employee clears calculations and drafts from the previous employee. Keep administrative global queues reachable for review across employees, not interleaved with the selected employee's facts.

**Settings** groups shared configuration by purpose: Policies; Organisation & approvers; HR access; Employee setup; Readiness. Policies owns rules, public holidays and creation/verification of work schedules. Retained policy settings clearly say which records they govern and remain available where operationally needed. Employee setup contains Payroll identity import and account preparation; it does not ask the user to decide between two competing imports.

**Organisation & approvers** starts with a compact department list and search. Selecting one department reveals its divisions and scoped offices. Add/Edit controls open one form at a time. A department with many divisions has its own bounded list. Government-wide Chief Secretary and HR verifier offices are visibly separate. Assigning, closing or correcting appointments preserves effective dates and history; filtering is not deletion. Empty search results differ from an organisation that has no records.

**Leave operations** serves cross-employee pending reviews, approvals, balance updates and Payroll reconciliation. A selected employee may link here with a filter. Advanced handover/release evidence is discoverable without filling the ordinary employee screen.

## Necessary controls versus unnecessary navigation

| Preserve | Simplify |
| --- | --- |
| Verified employee identity and explicit account linking; scoped HR grants | Repeatedly searching for the same employee in separate tools |
| Dated appointment/service facts and immutable correction history | Duplicate details forms and competing imports |
| Certified remaining balances and historical/future leave reconciliation | Separate top-level destinations for each step of preparing one employee |
| Independent opening, activation and job-plan review already enforced by the API | Repeated explanations instead of one visible state and next action |
| Effective policy/calendar/schedule coverage and case-specific evidence | Work-pattern creation in one settings page and verification in another |
| Server-side authority, denied grants, self-approval protection and audit | Unbounded organisation cards/forms and raw technical names |

Operational conventions for ambiguous schedules, service anniversaries or Payroll treatment must come from recorded authority. This review does not choose new conventions, infer entitlement from a reporting line, or require new signatures beyond controls already implemented.

## Acceptance before another owner walkthrough

Use synthetic validation records or read-only restored records; do not manufacture official approval, alter restored balances or claim a rehearsal is production acceptance.

| Scenario | Pass condition |
| --- | --- |
| Publish corrected policy while an employee retains existing arrangements | Policies explains the effect immediately; employee shows current arrangement and preserved balances, the Government policy coverage, and next transition action. No automatic balance or route rewrite. |
| Open a retained employee and inspect the nominated manager | Reporting manager remains visible; UI explains retained manager-based authorization versus Government office routing without claiming the manager automatically becomes an officeholder. |
| Enroll but do not activate an employee | The action clearly warns about the workflow switch. Afterwards the summary says Government preparation; it must not promise available submissions. It accurately reflects employee-account and regime guards. |
| Prepare service, opening, reconciliation and activation | The same employee remains selected throughout; missing facts have precise links. Preparers cannot certify/activate their own preview; changed inputs invalidate stale review. |
| Government Medical versus Special request | Displayed common route matches `routeLevels`: Medical includes relevant Secretary consent; Special omits that stage; both include HR verification and Chief Secretary. Case workflows retain their own additional stages. |
| Officeholder expires, changes login, loses grant or is the applicant | UI shows the blocker and authorized reassignment path. It does not silently use reporting manager or grant permission. Existing decision history is retained. |
| Existing leave pending/future at transition | Review presents retained cases and planned dispositions; unresolved external cases block the applicable operation; transfer retains source history and requires fresh Government decisions. |
| Published activation with no enabled codes | Clearly shown as paused, not ready solely because a published row exists. |
| Policy is published but no approved accrual plan exists | Balance remains unchanged; UI says balance updates need preparation/review and shows actual scheduling state. |
| Browse 50 departments and 2,000 employees | Directory uses bounded server paging; department search finds late-list entries, one department opens at a time, and appointment filters preserve access to current and historical entries. No page filled with 50 open forms. |
| One employee selected while reviewing openings/applications | Every visible employee-specific item belongs to that person. A global queue is explicitly separate. Returning preserves filters/selection; switching clears stale state. |
| Central versus scoped HR, employee and approver | Authorized controls remain available, outside-scope records remain inaccessible server-side, and route summaries do not disclose restricted personnel data. |
| Desktop, narrow/mobile and keyboard | Search, paging, selected editor, dialogs and errors remain usable without horizontal page overflow. Focus returns to the originating action. Dates are DD/MM/YYYY, field labels are unambiguous and long names wrap. |

## Evidence and limits

Tier 2 task-directed verification. Confirmed graph project `Users-teuteulilo-MyProjects-nr-aba-webapp` ready; recorded generation `2026-10-06T10:13:51Z`, rooted at the original checkout rather than this worktree. Parent graph discovery returned the old OrgUnits, Staff and Policies symbols; new worktree modules were absent. Coverage checks included all cited paths. New modules reported missing freshness; existing OrgUnits/Staff/Policies/hr routes reported metadata match against the original checkout. All material claims above therefore use direct source reads in the working checkout. A clean coverage report does not establish completeness.

Inspected: client EmployeeManagement, EmployeeDetails, OrganisationManagement, OrgUnits, Staff, Policies, GovernmentFoundation, GovernmentWorkflowManagement, GovernmentPayroll, GovernmentRollout and EmployeeOnboarding; backend employeeManagement, employeeDirectory, governmentLeave, governmentLeaveWorkflow, governmentLeaveCutover, employeeDirectory/hr routes and governmentLeaveRules. This is a bounded workflow/contract review, not a complete security audit or an independent interpretation of legislation. No personnel data is reproduced. At initial review, no browser validation or repaired-code acceptance had yet been performed; implementation review is recorded separately below when available.

## Implementation review

First implementation pass independently inspected the compact OrgUnits browser, OrganisationManagement and StatutoryOffices registers, their list/count queries, and the proposed employee arrangement summary.

- The department browser filters the complete authorised organisation reference response before paging. It finds divisions in the fiftieth department and shows one selected department rather than all open forms. Appointment queries apply the same parameterized filter to list and count and retain central HR authorization.
- Review found an integration defect: both appointment clients initially sent empty UUID/enum query parameters which the API rejects. The implementation was corrected to omit unset filters. The reviewer independently ran `npm test -- --run src/apps/leave/organisationBrowse.test.ts`: **7 tests passed**, including all 50 departments, the fiftieth department's division, paging, inclusive dates and the query contract.
- Review requested consistency between the statutory search hint and fields searched by SQL, employee-scoped cap alerts, and employee-scoped application lists. Selected-employee controls must not retain a picker that can change only part of their context.
- Review requested that arrangement summaries distinguish recorded service facts from category eligibility, avoid implying every employee needs all three common openings, and avoid showing generated retained defaults as stored Government employee balances.

The reviewer also added `app/backend/src/routes/organisationBrowse.integration.test.js` and independently ran it against a uniquely named disposable PostgreSQL 15 container: **10 tests passed, 0 skipped**. The fixture has 60 departments, 63 approval assignments and 64 statutory offices. Real HTTP checks traverse every appointment, find an officer outside the first 50, verify filtered totals/paging, effective dates including withdrawn offices, government-wide versus department scope, source-reference search, invalid filter rejection and central-HR-only access. Snapshots verify that reads preserve personnel, balances, policies, onboarding, appointment and audit data. The disposable container was removed after testing; restored personnel data was not used or changed.

The same suite checks selected-employee onboarding history across 22 matching batches and account pagination. A multi-employee cohort keeps its full count in history and cannot be opened as a concealed single-employee preview; another employee's single preview is rejected too. Global cohort review remains available to authorized central HR. Invalid employee filters and unauthorized reads are rejected. These tests verify scoped reads, not new account provisioning or application activation.

These findings were sent to the implementing agent during development. The subsequent employee-workspace source review is recorded below. Focused test results do not establish complete operational acceptance.

The final bounded source review then inspected EmployeeLeaveWorkspace, EmployeeManagement and their embedded tools. The workspace now keeps the employee in the URL, resets the component on employee changes, shows arrangements/details/applications/preparation locally, and retains cross-employee Finance maintenance under operations. Openings, migration reviews, applications, cap alerts and onboarding reads use the employee filter. Work schedules are created and verified under Policies.

That pass found and obtained fixes for three integration problems: the new retained-eligibility form initially used values outside the existing API enum; the status badge initially ignored an employee-only account on a retained record; and returning from successful preparation initially retained the old arrangement summary. Source now preserves the existing temporary/intern/study-leave values, distinguishes the blocked account case, and reloads the summary when changing sections or preparation steps. Global workflow selection also clears a previously selected application's detail when changing employee.

No additional permission bypass or automatic data conversion was identified within these reviewed edits. This is a bounded source conclusion, not complete security assurance. Final source feedback also requested a useful destination for the old `view=foundations` URL and wording that plainly explains the submission pause after enrollment. The implementing agent reports read-only browser verification of restored Finance/Treasury records, with existing managers and balances retained and the published Government policy separately labelled. This reviewer did not independently execute that browser session; modal focus, refresh behavior and retained adjustment flow remain part of the implementing agent's final checks.


The final focused integration run added selected-employee application coverage: 51 pending records traverse two pages with matching counts, one approved record obeys the status filter, and an employee's own-account scope cannot be broadened by supplying another employee ID. Administration tests verify that balance-cap alerts and update plans belong to the selected employee, uncapped posts are excluded from alerts, invalid IDs are rejected, and noncentral accounts cannot read administration. Personnel, requests, service facts, plans, posts, balances and audit snapshots remain unchanged by these reads. All **10 tests passed with none skipped** on a fresh disposable PostgreSQL 15 instance, which was then removed.

Final source inspection confirms that the old foundations URL resolves to a usable workspace, the arrangement screen uses compact disclosures for route and preparation details, and an empty Government balance panel is omitted for a retained employee without certified Government entitlements. The profile's placement dialog proposes only a unique exact existing-name match and requires an explicit save; it does not silently verify historical placement. Existing calculation and eligibility values remain editable through their original APIs.

Enrollment sequencing remains a deliberate constraint: `prepareOpening` rejects employees who are not yet enrolled, and `migrationPlan` likewise requires the Government arrangement. Read-only migration preview and recording service facts can precede enrollment, but the interface cannot honestly promise that opening certification and reconciliation are completed first. The current ordered preparation and explicit submission-pause message match those contracts. A future transition preflight or atomic cutover would require a separately designed and tested change; this navigation repair does not weaken existing gates or silently convert employees.

**Disposition:** the reviewed consolidation addresses the identified navigation, scale and employee-context defects. Independent evidence is limited to source/API review, the seven organisation helper tests and the ten focused database integration tests. Broader suite results and final visual acceptance are reported by the implementing agent. Official readiness, policy authority, independent certification and employee activation remain separate existing operational controls.


The final UI split was reviewed after the disposition above: employee Applications mounts assisted case entry, follow-up tasks and the filtered request list; the Activation preparation step mounts configuration, update plans and cap events only. Cross-employee operations expose those two purposes separately alongside Payroll and retained Finance tools. Selected employee views remain keyed by employee ID and omit the global picker. Assisted Government case entry is hidden until the selected employee is enrolled; preparation/run controls are disabled for retained arrangements. Independent review and draft-history actions remain present. No new blocking defect was identified in this bounded source check; final screenshots and client build results remain the implementing agent's evidence.


## Integrated local acceptance

The implementing agent completed desktop and mobile browser checks against the restored local copy, without saving personnel, office, policy, balance, cohort or application changes. Finance/Treasury names remain visible and are preselected in the explicit placement-verification form. The temporary eligibility selector retains the existing value. The selected employee retains the existing nominated manager and stored balances. Service/opening, login lifecycle, reconciliation and activation screens stay in that employee context; activation does not contain unrelated application-entry forms. Returning to arrangements refreshes its summary. The policy screen reports 29 existing-workflow employees and zero Government preparation/active/paused employees. Holidays and work schedules have a single owner under Policies.

Browser verification caught duplicate React sibling keys in the follow-up register and request list, causing repeated follow-up sections. Separate tasks-/requests- keys fixed it. A fresh load and application refresh then showed exactly one follow-up register, and activation displayed none. This defect illustrates why the static review was followed by integrated browser verification. Mobile checks showed document scrollWidth equal to clientWidth (375 CSS pixels in the browser's responsive override); desktop and mobile screenshots were inspected. The viewport was restored afterward.

Final combined checks: 440 backend tests / 49 suites passed, no skips, on disposable PostgreSQL; 116 frontend tests passed with one pre-existing skip; lint, TypeScript/production build and git diff whitespace checks passed. New integration fixtures are removed at teardown; a first combined run exposed leftover synthetic leave types, which were corrected before the final green run. The restored database was not used for mutation tests.

Private screenshots remain in .leave-production-review/screenshots/; no personnel screenshots, environment files or SQL backups are committed. The original backup hash remains unchanged. This is acceptance of the local consolidation, not authorisation to publish or migrate employee records in production. Signed policy authority, verified identities/service, Gazette dates, actual officeholders, certified balances, cutover timing and the independently approved departmental pilot remain rollout prerequisites. Enrolment currently precedes opening/migration preparation and pauses existing submissions; this boundary is stated explicitly in the preparation flow.
