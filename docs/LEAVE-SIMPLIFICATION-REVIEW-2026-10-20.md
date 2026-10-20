# Leave management review and simplification plan

20 October 2026

The application should organise routine administration around an employee and their leave application. Today it exposes parts of employee onboarding, Government policy implementation, payroll reconciliation and historical migration alongside daily leave work. Previous navigation changes reduced the number of visible tools, but an administrator still has to understand the underlying processes to choose the right action.

The recommended order is to repair cancellation and login assignment, give each application one clear set of actions, and then move exceptional maintenance out of everyday navigation. Keep the existing balance calculations, authority checks and history while simplifying how people reach them.

## The three reported problems

| Problem | Code finding | Resolution |
| --- | --- | --- |
| Cancel approved leave and restore credit | Government amendments support `cancel_grant` and `shorten_grant`. The first amendment dialog had no action selector; cancellation was selected later in a case determination. A previous shortening also hid the button entirely. | Local changes add an explicit cancellation or early-return choice, retain it in the application, default the determination to that choice and reject a conflicting determination. A shortened grant can be amended again. |
| Change a staff login in Administration | The form only linked a nonempty staff selection. Clearing it did nothing. Moving the login failed the unique-link constraint because its old employee was still linked. Staff already linked to another login were excluded. Link errors were caught after an account-success toast and the form still closed. The helper text incorrectly promised automatic employee creation on first use. Employee-only accounts were also required to supply an ABA Department Head code when editing account details. | Local changes introduce a transaction that detaches the former employee and assigns the selected employee together. A replacement identifies the displaced login and requires a reason. Stale mappings reject the change. Errors retain the form and distinguish saved account details from an unsuccessful staff assignment. Employee-only edits no longer require an ABA department code. |
| Too much HR administration in daily leave | Two leave engines, several account-entry paths, employee preparation, approval-office registers, balance schedules, cases and payroll instructions coexist. Many controls reflect internal records rather than the administrator's task. | Consolidate daily application actions, employee context and work queues first. Put migration, bulk provisioning and specialist reconciliation in a restricted maintenance area. |

These code changes are local and have not been deployed. Account details and the staff-link operation remain separate requests; staff links themselves change atomically. If the second request fails, the form explicitly reports that account details were saved and the staff assignment was not changed.

## Cancellation and balance restoration

For Government leave, including approved older leave already carried into that workflow, open the employee's Applications, view the approved application and choose **Cancel or shorten approved leave**. Select cancellation or early return and record the employee authority and reason. HR then prepares the determination, an independent HR officer verifies it, and the required approval stages complete.

The balance changes at final amendment approval. Submitting the amendment or preparing its determination does not refund leave. Cancellation reverses only the remaining original deductions. Early return reverses deductions for dates after the revised end date. Previously refunded units are subtracted, preventing a second refund of the same leave. The original approval and PDF remain in history, and the calendar uses the approved amendment's effective absence. Leave without pay and financial benefits have their own service or commitment effects and may have no leave-day balance to restore.

Older leave that remains solely in `hr_leave_applications` is different: `leaveService.cancelLeave` only accepts pending applications, and `RecordedLeaveReview` has no approved-cancellation action. That gap remains. Do not tell an administrator to reject already approved leave or manually add days as a substitute. The next cancellation work must define a controlled reversal for these records, including which account receives the refund if the employee has since moved to Government leave or the original entitlement year has closed.

The existing approved-carryover implementation records matching credit and use movements with zero net balance change. This preserves a debit that a later Government amendment can reverse without deducting the old leave twice.

## Scope and current ownership

The review covers the Leave navigation, employee workspace, application and case screens, balance account, policy/setup screens, account administration and the corresponding routing, account-link, cancellation, ledger and carryover services. It is a workflow and maintainability review; deployment settings and production employee records were not changed.

| Area | Current code owners | Simplification |
| --- | --- | --- |
| Navigation | `sections.ts`, `LeaveApp.tsx`, `EmployeeManagement.tsx`, `LeaveSetupStatus.tsx` | Separate daily work from maintenance. Keep existing URLs as redirects where needed. |
| Employee context | `EmployeeLeaveWorkspace.tsx`, `EmployeeDetails.tsx`, `LeaveAccount.tsx` | One persistent employee header and one place for applications, balances and access. |
| Applications and approvals | `GovernmentRequests.tsx`, `RecordedLeaveReview.tsx`, `GovernmentApprovalForm.tsx`, `governmentLeaveWorkflow.js`, `leaveService.js` | One application action menu with server-provided availability and plain explanations. |
| Special cases and amendments | `GovernmentCases.tsx`, `governmentLeaveCases.js`, `governmentLeaveCaseRules.js` | Ask for the intended change first; show only the fields that apply. |
| Account access | `Admin.tsx`, `EmployeeOnboarding.tsx`, `employeeDirectory.js`, `employeeOnboarding.js` | Share one verified linking operation. Keep bulk provisioning separate from changing an existing login. |
| Policy and opening balances | `GovernmentFoundation.tsx`, initial-setup and commissioning modules | Show readiness and the next missing item. Move historical conversion tools out of the normal employee workflow. |
| Accrual and balances | `governmentLeave.js`, `governmentLeaveBalances.js`, `governmentLeaveJobs.js`, `leaveAccrual.js` | Display recorded balance, holds, forecast and posting history consistently; retain distinct engines behind the interface. |
| Organisation and access | `OrganisationManagement.tsx`, `StatutoryOffices.tsx`, `HrAccessManagement.tsx`, approval-route services | Manage approvers and data access in separate, plainly named settings groups. |
| Calendar and reporting | `Calendar.tsx`, `GovernmentActivity.tsx`, reporting services | Use the same effective application state as the application screen. |
| Payroll and historical transfer | `GovernmentPayroll.tsx`, `GovernmentRollout.tsx`, `governmentLeavePayroll.js`, `governmentLeaveApprovedCarryover.js` | Give specialists a separate maintenance destination; retain history and reconciliation. |

## Findings that drive the redesign

**Two engines leak into the interface.** Government and retained records appear together but have different actions, authority and balance storage. Merely merging their forms would conceal important differences. A common application view needs to resolve the supported operation on the server and explain any blocker to the administrator.

**Application state and absence state differ.** The original Government grant stays `approved` after an approved cancellation. An interface that reads only the grant status can still announce approval even though the absence is cancelled. The detail message is corrected locally; list filters and reports should next receive an explicit effective state such as Cancelled after approval or Shortened.

**The employee Applications screen starts with too many competing tasks.** `GovernmentWorkflowManagement` mounts assisted application entry, the follow-up register and the application list together. To amend an existing application, an administrator first encounters a form for creating another one. The list should be the default; Apply on behalf should open on demand, and follow-ups should be a filtered queue.

**The account lifecycle has several entrances.** Portal User Management, employee account linking and bulk onboarding serve related but different purposes. They should reuse linking and history, with a single visible current login on the employee record. Reassigning a login must not rename historical actors or move leave balances to another employee. Existing capability grants remain attached to their accounts and require separate review when duties change.

**Setup and daily operations overlap.** Settings exposes policy/calendars, organisation/approvers, balance schedules, HR access, employee accounts, payroll instructions and application follow-ups. Employee setup adds service/balances, account access and leave access/schedules. Follow-ups and leave decisions belong in daily work; migration, initial balance certification and bulk provisioning belong in maintenance.

**Forms expose implementation vocabulary.** A cancellation requires starting an amendment, preparing a factual/pay determination, providing references and entering pay segments. The engine may need these records, but the interface can collect the employee's intended change and then guide the responsible reviewer through the necessary evidence. Reuse the selected original application and dates instead of asking someone to type its ID again.

**Large components make changes hard to verify.** Case creation, determination, task handling and amendment rendering share `GovernmentCases.tsx`. `GovernmentFoundation.tsx` mixes global policy/calendar configuration with employee openings and ledger actions. `GovernmentWorkflowManagement.tsx` combines setup and operations; `Admin.tsx` contains account management alongside unrelated portal administration. Split by user task while retaining common service functions.

**There are several write paths for the same identity relationship.** Generic employee edits, dedicated employee account links, onboarding and Administration can reach login assignment. The new account operation uses the existing verified-link service, but other entry points still need to share consistent stale-state checks and conflict handling. UI hiding alone cannot enforce this consistency.

**Retired navigation does not mean retired code.** Initial setup, commissioning, rollout and legacy endpoints remain in the repository and backend mounts even where ordinary navigation no longer reaches their client screens. Establish dependencies and data ownership before removing them; old records still need readers and audit access.

## Proposed daily experience

Use six primary destinations, filtered by the user's permissions: **My leave**, **Work queue**, **Calendar**, **Employees**, **Reports**, and **Settings**. The Work queue combines the actionable parts of Overview, Approvals and application follow-ups. Administrators can land there; employees can land in My leave.

An employee record should have three everyday tabs: **Leave**, **Balances**, and **Details and access**. Leave opens the application list with a prominent Apply on behalf button. Balances shows available, held and projected days and a readable transaction history. Details and access shows the appointment, schedule, current login and authorised approvers. Show a Complete setup task only when something required is missing.

Each application should have one action menu: View approved form, Cancel pending application, Request cancellation, Record early return, Change future dates, or Resolve approval assignment. Return only actions the server authorises for that record. For changed dates, explicitly link cancellation and replacement; retain the existing requirement for new approvals. Avoid showing every specialist action beside ordinary leave.

The cancellation dialog should show the leave being changed, proposed dates, estimated refund by leave account, reason, supporting authority and required next approver. The server must recalculate the refund at final approval and reject a stale preview. After completion, display the actual refunded amount, updated balance and a link to the original approval.

Keep policy, calendar, approver and access configuration under Settings. Put opening certification, migration, rollout evidence, bulk accounts, service corrections and payroll reconciliation in **Advanced maintenance**, visible only to the existing authorised roles. Direct links from a blocked task should take the authorised person to the relevant tool with the employee and application retained.

## Implementation sequence

| Phase | Concrete work | Completion condition |
| --- | --- | --- |
| 1 Repair the reported failures | Explicit Government cancellation/early return; successive amendments; atomic login replacement and unlink; accurate save feedback. | Refund only at final approval; no duplicate refund; old login loses employee access; failed assignment leaves both links unchanged. Local implementation is included in this change. |
| 2 Complete application changes | Add a refund preview and actual-refund result; effective cancellation status in lists/calendar/reports; implement the controlled retained-approved cancellation path; explain expired-period refunds. | An admin can find the employee, open leave and cancel it without visiting Settings or copying IDs. Both engines and carried approvals have tested, explicit outcomes. |
| 3 Reduce daily navigation | Introduce Work queue; default employee Leave to the list; open assisted entry on demand; put follow-ups in the queue; combine employee details and access. | Routine changes stay in one employee context. Approvers see their next decision. Employee-only accounts see their own leave. |
| 4 Guide setup and maintenance | Add one readiness summary and next action; move historical conversion, bulk provisioning and payroll tools to Advanced maintenance; reuse account assignment in the employee workspace. | Active employees are not presented with setup forms. Missing setup links directly to the exact field or authorised review. |
| 5 Consolidate code and retire duplication | Extract application actions, account assignment, case-specific forms and policy configuration. Inventory backend writes and stale-state handling. Remove unused client modules only after import/URL checks; retire mutation endpoints only after usage and migration review. | Each operation has one service owner, shared contracts and regression coverage. Existing records, audit history and bookmarked destinations remain accessible. |

Phase 2 precedes a wider redesign because leaving older approved applications without a clear cancellation outcome would preserve the main operational problem. Phases 3 and 4 can change presentation without changing entitlement rules. Removing the retained engine requires a separate data transition with reconciled opening balances and outstanding applications.

## Controls and acceptance

Preserve server permissions, employee scope, independent verification where enforced, approval history, dated policy and schedule facts, ledger precision, reversal limits, document retention, idempotency and transaction rollback. Changes to the number of approval stages or required authority are policy decisions and are outside this navigation plan.

Before deployment, verify these user tasks using synthetic records:

1. Approve three days, request cancellation, verify no early refund, complete approval and verify exactly three days restored and the absence removed.
2. Shorten three days to one, restore two days, then cancel the remaining day. Reject a second cancellation and retain the original PDF.
3. Cancel hourly leave and medical leave, checking fractional refunds and uncertified-occasion usage. Confirm leave without pay restores the correct service treatment.
4. Cancel approved carried leave without another deduction or refund beyond the original use. Define and test retained-only leave and closed entitlement periods before releasing that additional path.
5. Move an existing login between employees, replace another login on a selected employee, and clear a link. Confirm contact address, link history and session/token revocation.
6. Reject stale and concurrent assignments. Force a target-link failure and confirm the former link, target link, session state and audit records roll back together.
7. Keep a failed save form open with a precise message. Retry account creation after a linking failure without creating another account.
8. Complete the daily application tasks at desktop and mobile sizes using keyboard controls. Verify scoped HR, central HR, approvers and employee accounts independently.

Local verification passed on a disposable PostgreSQL 15 database: 27 case/amendment tests, six account-assignment tests and 41 existing employee directory, management and onboarding tests, with no skips. Client verification passed 178 tests, lint and the TypeScript/production build. A synthetic Playwright walkthrough checked replacement, clearing a link, failed-save recovery, retry after account creation, employee-only account editing, cancellation after an earlier shortening, effective cancellation messaging and mobile overflow. The browser responses were synthetic; the database tests exercised real services and HTTP routes.

The wider navigation changes and retained-only approved cancellation remain planned work. No production changes or deployment were performed.


## Daily workflow implementation

The daily navigation now contains Work queue, My Leave, Calendar, Employees, Reports and Settings, with permission filtering. Work queue groups approvals, follow-ups, all applications and planning. Employees groups the directory and staff balance browser while preserving separate staff-editing and balance permissions.

An employee opens at the application list. Assisted entry opens on demand. The employee's three daily tabs are Leave, Balances, and Details and access; setup and account lifecycle tools are reached through a missing-item notice or Advanced employee maintenance. Application actions share one disclosure. The server exposes approved-amendment availability, and list labels and filters use the approved cancellation effect while retaining the original grant status and PDF.

Settings keeps policy, calendars, organisation, approvers and administration access together. Balance schedules, bulk account lifecycle and payroll reconciliation are grouped in Advanced maintenance. Existing bookmarked URLs retain their destination and employee filters. The retained-only approved cancellation path and a calculated refund preview remain separate work; the entitlement engines and required approval stages have not been replaced by this navigation change.

See [Daily leave work](LEAVE-DAILY-WORK.md) for the user workflow.


Release verification passed `TEST_DB_PORT=55440 npm run ci:local`: 608 backend tests with no skips, 184 client tests, lint, production build and the runtime dependency audit with zero vulnerabilities. Three synthetic browser walkthroughs cover applicant/approver decisions, cancellation and login reassignment, and daily navigation with employee context, permission boundaries and mobile layout. Dated workflow tests use an explicit synthetic notice policy; a separate HTTP test verifies that clients cannot forge the real fourteen-day notice period.
