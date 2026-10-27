# Daily leave work

Use **Employees** to change one person's leave, **Work queue** to process outstanding work, and **Settings** to maintain shared rules and access.

## Applying for leave and approving it

Employees choose the leave type and dates; the end date defaults to the start date and the balance impact appears automatically, with no separate check step. A written reason is optional, except that Special leave still needs its justification.

Recreation leave asks for the notice period set in policy. A shorter notice can still be submitted; the application carries a **short notice** flag, and every approver must tick a waiver of the notice requirement before they can approve it.

An application is refused at submission, naming the stage, if no approver can currently receive it (no officeholder, an approver without leave-approval access, or the employee themself). This replaces applications that used to wait silently.

Approvers open **Work queue**, which starts on **Only applications waiting on me**. Untick it to see everything in scope.

If a stage is stuck, central HR sees **Fix approver assignment** on that application. Re-confirming the current approver needs no reason or reference; delegating to a substitute still needs an authority reference.

Employees can cancel their own approved leave before it starts: open the application and select **Cancel this leave**. The assigned approver confirms it and the balance is restored only then. Early returns, leave that has already started and part-period changes stay with central HR.

## Find and change an employee application

1. Open Leave → Employees and search for the employee.
2. Select Manage. The employee opens at **Leave**, showing all application statuses.
3. Search or filter the list and open the application.
4. The application shows only the actions it allows: download its approved PDF, cancel it while pending, request cancellation or early return once approved, or fix a stuck approver assignment.

The employee stays selected while you switch between **Leave**, **Balances**, and **Details and access**. Balances includes the account and movement history. Details and access includes appointment facts, the current login, approvers and verification history.

To submit a new request for an employee, select **Apply on behalf**. The form opens only when requested and closes after successful submission. The application remains in that employee's list for tracking.

## Approval for every leave type

Every new application uses the configured approval route for its department, or the Government default. Without a configured route, it goes to the employee’s assigned Supervisor. Leave types never add HR, Head of Department, Secretary or Minister stages automatically. More stages are used only when explicitly configured.

The assigned approver opens the application, reviews the reason and supporting documents, confirms the application and chooses **Approve**, **Amend** or **Reject**. Comments are optional for approval; rejection requires a reason.

**Amend** changes the dates (or the hours of hourly leave) of a pending Recreation, Medical or Special application. Give a reason. The days and balance hold are recalculated, the documents and the original notice date are kept, and the application starts its approvals again with the new dates; the original is kept as cancelled and linked. Other leave types are rejected and reapplied for instead.

**Reject** is final for that application: it is not approved and the held balance is released. The employee sees the reason and can select **Change and resubmit**, which copies the application into the form so they can fix it, attach documents again and submit it as a new application with fresh approvals. Medical and Special evidence is checked with the approval, without a separate HR verification. Evidence access is limited to valid assigned approvers for that application and existing employee/evidence permissions; it does not open unrelated clinical records.

Medical applicants, including HR applying on behalf, must explicitly select **With MC** or **Without MC**; neither is preselected. With MC requires an attachment. The server checks the allowance for non-consecutive uncertified absences, including reviewed earlier usage and pending requests. Both options use the same Medical balance.

Application lists show the recorded MC status. Authorised Medical reviewers also see the latest balance for each service year charged by the request, its submitted charge, its own reserved days, other pending holds, usage with and without MC, and remaining uncertified occasions. Available days already exclude pending holds; approval converts this request’s reservation into a deduction without deducting it again. Unknown history and missing reservations are flagged for HR review. This summary does not disclose other applications’ dates, reasons or documents. Staff see their current Medical usage and remaining uncertified allowance on the application form.

Parental dates and eligibility, extended Medical pay, extended LWOP purpose and financial benefit details appear in the application or final approval screen as needed. Fixed pay rates and parental service-milestone splits are calculated automatically. Benefit history and actual monetary valuations remain required for payments, with balance and duplicate-use checks in the same transaction. There is no separate HR preparation or independent verification step for new applications.

For LWOP, pay is zero and paid leave days are not deducted. Final approval records the service pause and produces the PDF. A period over twelve months needs the study or exceptional-circumstances basis in the same application and approval.

Historical completed applications retain their original decisions and PDFs. Maintenance can move unreviewed pending applications to this rule through an immutable correction with an audit entry, preserving the original facts, stages, decisions and balances. It never records approval on behalf of an officer. Applications with existing review decisions require explicit reconciliation rather than automatic reinterpretation.

## Cancel approved Government leave

Open the approved application, select **Cancel or shorten approved leave**, and choose the intended change.

- Cancellation retains the currently approved dates and requests restoration of the remaining deduction.
- Early return asks for the last date of leave taken and restores only the released portion.

Central HR records the employee's authority (a personnel-file reference is optional). The created amendment opens immediately and follows the same configured approval route. The assigned approver confirms the requested change in the application; no separate HR determination or verification is added. The balance changes at final amendment approval. The original approval and PDF remain in history. Leave already shortened can be cancelled for its remaining portion; a completed cancellation cannot refund the same deduction twice.

Cancelled approved leave appears as **Cancelled after approval** and is found under the Cancelled filter. A shortened grant is labelled **Shortened after approval** and remains in the Approved filter. An approved form downloaded from the original application records the original grant.

Older applications that remain solely in the retained leave system still lack an approved-cancellation route. Ask central HR to review these records. Rejection and an unrelated manual balance adjustment are not substitutes for an audited cancellation.

## Process the work queue

The Work queue starts at **Approvals**. Review the application and record the required certification and decision there. Ordinary approvers see the records available to their assigned authority.

Central leave administrators also have:

- **Follow-ups** for evidence and reconciliation still required after approval. Opening a follow-up takes you to its application.
- **All applications** for searching across employees and statuses.
- **Planning** for the overview, exceptions and department planning information.

An employee's Leave tab links to that person's outstanding follow-ups. The Work queue shows when it is filtered to one employee and provides a return link and a Show all employees action.

## Change a verified login

For an individual employee, open Details and access → **Payroll ID and login** to review or change the login. Login history and leave history stay on the employee record.

In Administration → User Management, edit the account and choose its **Leave staff record**. The selection can replace another login, move the account from a former employee, or clear the link. Review the displayed replacement and record a reason before saving. Both links change together; affected users must sign in again. A stale or failed staff assignment leaves the links unchanged and keeps the form open with an explanation. Account details and the staff assignment are separate saves, so the message explicitly identifies partial success.

## Maintain shared settings

Settings contains **Policy and calendars**, **Organisation and approvers**, **Administration access**, and **Advanced maintenance**.

In Policy and calendars → Rules, use **Extend dates** when the same allowances should continue. The current dates are shown automatically. Enter a later Effective through date or select **No end date**, then **Save changes**. This applies immediately and records the administrator and old/new dates in history. Existing approved leave, balance postings and original policy facts stay unchanged; no replacement or separate approval is needed.

Use **Change allowances** only when the leave rules themselves change. The form copies the current values and suggests a start after existing approved leave and balance updates. System administrators save and apply the change together with **Save changes**; other policy managers can save a draft for an authorised reviewer. Previously saved drafts have an **Apply changes** action without another verification-reason dialog. Signed replacement references and mandatory source fields have been removed from routine policy editing. Qualifying periods and an optional source are under Advanced settings; a note is optional. Previous policies remain available under Previous policies.

No end date extends future coverage. It does not add coverage before the original policy start date. Application errors now identify the first date missing published policy coverage.

Advanced maintenance contains leave activation and balance schedules, bulk account lifecycle tools, and payroll reconciliation. For one employee, a missing setup item shows a **Leave setup needs attention** notice on their record with a button to the exact step. Ordinary active employees open at their leave list.

Approvals between HR officers (calendars, schedules, service basis, opening balances, leave access, balance schedules, appointment corrections) all use **Approve**. An appointment correction appears on the employee's Details and access only while it awaits approval.

Staff balance browsing is under Employees → **Staff balances**. Accounts with only balance permission open that view directly and do not gain employee editing access. The primary navigation only shows destinations allowed by the account's permissions.

Older links to Approvals, Overview, Staff, Staff balances and application follow-ups continue to open the corresponding destination. Employee filters are retained when a bookmarked Staff or Staff balances link is redirected.
