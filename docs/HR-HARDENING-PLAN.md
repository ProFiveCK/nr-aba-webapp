# HR / Leave hardening plan

Outcome of the module review on 2026-09-24. Working branch: `feature/hr-hardening`.

The module works and the domain model is sound (employment identity kept out of
the auth table, mandatory-reason adjustments, append-only audit, accrual made
idempotent on `period_end`). What is missing is a domain layer, a shared UI
system, any test coverage of the leave arithmetic, and a dashboard that reports
risk rather than activity. The items below are ordered so that each one makes
the next one safer to do.

Tick items off here as they land.

## Phase 1 — Week one

Small, independent, each one a user-visible or operational defect.

- [x] **1. Global error handling.** *Done.* `middleware/errors.js` adds
      `enableAsyncErrors()` (patches route registration so a rejected promise
      reaches `next`), a single `errorHandler` that maps Postgres and
      body-parser failures to real status codes and gives every error a short
      reference shared between the log and the response, a JSON 404 for
      unmatched `/api` paths, and process-level guards. `hr.js:561` and
      `hr.js:766` now behave as intended instead of hanging.

      Note: the patch must run before any route is registered, so `server.js`
      loads the four routers with `await import()` *after* calling it. **Add new
      routers to that block, not to the static imports.** Covered by
      `src/middleware/errors.test.js` — which also brings item 6's runner
      forward: `npm test` in `app/backend` now runs `node --test`, no new
      dependency.
- [ ] **2. UTC date bug.** `Overview.tsx:35` and `Report.tsx:18` build ISO dates
      with `toISOString().slice(0,10)`, converting local midnight to UTC. At
      UTC+12 every preset lands one day early — "This year" asks for 31 Dec.
      `Staff.tsx:12-25` already has the correct local-safe helper; promote that
      one to `lib/date.ts` and delete the other two.
- [ ] **3. `PUT /employees/:id` cannot clear a field.** `hr.js:529-540` uses
      `COALESCE($n, existing)` on every column, so HR can set a manager but
      never remove one, and cannot blank a wrong join date. Build the `SET`
      list from the keys actually present in the request body.
- [ ] **4. Overview KPIs do not reconcile.** Three different definitions of
      "leave in this period" run on one screen: application tiles filter on
      `applied_at` (`hr.js:988`), the type/department bars filter on range
      *overlap* and then sum the *entire* application (`hr.js:1002`, `1011`),
      and the trend filters on `start_date` (`hr.js:1020`). A 10-day leave
      starting before the window contributes all 10 days to the bars and zero
      to the line. Settle on days actually falling inside the window.

## Phase 2 — Next sprint

Structural. Item 6 gates the rest: nothing else here is safe to refactor
without it.

- [ ] **5. Extract `services/leaveService.js`.** `routes/hr.js` is 1,149 lines
      of HTTP, authorization, SQL, transactions and notification fan-out
      interleaved. Pull `applyForLeave`, `decideLeave`, `adjustBalance` out as
      functions taking an open client. Routes become thin.
- [ ] **6. Stand up a backend test runner** (`node --test`, no new dependency)
      and cover the accrual/reset matrix first: fortnightly accrual,
      anniversary vs financial-year boundaries, carryover on
      `reset_period='none'`, working-day counting, pending hold/release.
      These numbers decide what people are paid out and none of them are
      tested today.
- [ ] **7. Frontend structure and design system.** Split the 956-line
      `Staff.tsx` into `features/hr/`. Extract shared `StatTile`, `Card` and
      `DataTable` into `components/Ui.tsx` — `Overview.tsx:65` and
      `Staff.tsx:94` currently define near-identical tiles separately. Replace
      the 27 hand-typed `rounded-xl border border-zinc-200 bg-white shadow-sm`
      occurrences in `pages/Hr/` with the existing `.app-panel` class. Settle
      on one icon system (local `Icon` vs raw `lucide-react`). Lazy-load
      `HrApp` like Banking/Payroll/Admin already are.
- [ ] **8. Move accrual off `setInterval`.** `server.js:4193-4202` runs the
      scheduler in-process, so it stops whenever the API is down over a pay
      date and double-runs on a second replica (the `period_end` UNIQUE
      constraint prevents double-credit, but one replica's transaction will
      crash). `scripts/run-accrual.js` and `npm run accrual` already exist —
      this is mostly a matter of moving to cron and deleting the interval, or
      taking a `pg_advisory_lock`.

Also in this phase, as capacity allows:

- Set-based accrual. `leaveAccrual.js:88-104` issues ~3 queries per employee
  per leave type inside one transaction (~4,500 sequential queries at 500
  staff), and should be two `INSERT … SELECT … ON CONFLICT DO UPDATE`
  statements.
- Pagination on `/employees`, `/leaves`, `/team`, `/calendar`, `/report`,
  `/employees/balances` — all currently return full result sets.
- Reconcile duplicate employee records. `hr.js:37` auto-creates a row keyed on
  `reviewer_id` on any `hr_access` request, while `/employees/import` creates
  unlinked rows matched only by name, so an imported staff member who later
  logs in gets a second, empty record with a fresh balance.

## Phase 3 — The enterprise lift

This is what moves the dashboard from "an internal tool that works" to
something that looks bought. The current five equal-weight tiles report
activity; none of them carry a comparison or imply an action.

- [ ] **9. Leave liability in dollars.** Add a daily rate to the employment
      record and make `SUM(available_days × daily_rate)` the hero KPI — it is a
      balance-sheet provision and the number a Treasury actually cares about.
      One hero metric with a sparkline and a period-over-period delta, the rest
      demoted to a secondary strip.
- [ ] **10. Exception KPIs.** Pending-approval aging ("3 pending > 5 days", not
      "12 pending"), coverage risk (departments with >30% out in the same
      week), excess balances (staff carrying > 2× entitlement), and negative
      balances — `Staff.tsx` already renders those in red, so they happen, but
      the overview never surfaces them.
- [ ] **11. Drill-through.** Clicking a department bar should filter through to
      the staff list. Nothing on the dashboard is clickable today.
- [ ] **12. Public-holiday calendar,** wired into a *single* shared working-days
      calculation. `calculateWorkingDays` is currently hand-maintained twice,
      in `hr.js:17` and `types.ts:78`, in two languages — they will drift the
      moment holidays are added.

## Smaller gaps noted during the review

- Three competing accents: navy `#002B7F` (tabs), orange `#E8842C` (submit),
  amber-500 (inherited `.toolbar-button-primary`), plus a fourth blue
  `#2a78d6` hardcoded for charts at `Overview.tsx:13`.
- `csvCell` is copy-pasted into `Report.tsx:23` and `Staff.tsx:91`.
- `hr_leave_applications.attachment` exists but nothing writes it — medical
  certificates for Sick leave are half-built.
- No half-day leave. Leave spanning a year boundary is charged entirely to the
  start year's balance.
- `pg` returns `NUMERIC` as a string, and the client calls `Number(...)` ad hoc
  at each use site rather than at the boundary.

## Not verified

Both need a running stack:

- Whether the concurrent-approval path can drive a balance negative. The
  application row is locked `FOR UPDATE` at `hr.js:369` but the balance row is
  not, and the only sufficiency check happens at apply time.
- Actual bundle-size impact of the eager `HrApp` import.
