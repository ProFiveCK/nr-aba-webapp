# Leave experience review — 9 October 2026

This change starts from `origin/main` at `0314274` and treats the portal as the
single place for leave management. It does not change production data.

## Everyday workflow

- Dashboard links lead to applications, approvals and employee records according
  to the signed-in person's permissions.
- Leave overview puts current priorities and departmental balance planning first.
- Add employee creates a record under the current policy and opens appointment
  details. Service, work schedule, balances and access are completed on that record.
- My Leave shows available balances, application preview and submission, and
  application history. Approvals and Calendar retain their permission boundaries.
- Settings groups policy/calendars, organisation/approvers, balance schedules,
  HR access, employee accounts and payroll instructions.

Staff-transfer, import and system-handover tools are removed from normal
navigation. Old bookmarks return to the current workspace. Earlier records and
approved forms remain available; no automatic data conversion, credit grant,
account activation or approval is introduced. Balance corrections continue to
require the appropriate authority and an audit reason.

## Layout and reliability

Fields use consistent labels, control heights and spacing. Cards and action rows
wrap at narrow widths. The mobile calendar uses a readable absence list. Detailed
charts, history and review evidence use expandable sections so daily tasks remain
prominent. Missing data has an explicit empty or error state.

Request filters show loading for the selected query. Calendar requests cannot
replace a newer month with a stale response. Earlier application history can
retry independently without blocking current leave. Reports clear stale results
when dates change.

Scoped balance views use current entitlement accounts and pending reservations.
Missing balances remain unrecorded instead of showing assumed allowances.
Current-policy corrections require certified HR authority; scope restrictions and
existing correction history remain enforced. This endpoint reports current
balances and rejects a different year rather than combining different periods.

## Verification

An isolated synthetic stack runs at `http://localhost:8083`; it has no production
records or outbound email. The walkthrough covers desktop and 390px layouts,
main leave pages, settings subpages, employee views and application actions.
Local screenshots and the detailed checklist are in
`.leave-review/walkthrough/` (intentionally ignored by Git).

The walkthrough inspected 24 authenticated pages/subviews at 390px, plus desktop
layouts, with no page-level horizontal overflow. It completed direct employee
creation, Recreation preview/submission and Division-to-HoD approval, Medical
submission with an attachment, current scoped balance checks, PDF/CSV downloads,
validation messages, keyboard navigation and active mobile tab visibility.

Advanced statutory decisions, payroll publication/reconciliation, account
activation, policy publication, certified corrections and schedule posting were
not executed through the browser. Existing integration tests cover their server
controls. The downloaded approved PDF was checked for a valid file signature;
its print layout was not re-audited.

The final `npm run ci:local` passed: 540 backend tests (none skipped), client
lint and production build, 145 frontend tests (one existing skipped test), and
the backend runtime dependency audit (zero vulnerabilities). `git diff --check`
also passed. This branch has not been deployed.
