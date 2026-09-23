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
- [x] **2. UTC date bug.** *Done.* `lib/date.ts` now holds `toIsoDate`,
      `todayIsoDate` and `toDateInputValue`, and the four call sites use them.
      The review found two instances; there was a **third**, `Calendar.tsx:21`,
      where `monthBounds` shifted the whole query window back a day, so leave on
      the last day of any month never appeared on the calendar.

      The suite's timezone is pinned to `Pacific/Nauru` in `vite.config.ts`, so
      this class of bug now fails in `npm test` rather than in production.
      Covered by `lib/date.test.ts`.
- [x] **3. `PUT /employees/:id` cannot clear a field.** *Done.* The handler
      builds its `SET` list from the keys the body actually carries, via the new
      `lib/sqlUpdate.js` (`collectUpdates`, `buildUpdateAssignments`,
      `changedFields`), so an unmentioned field keeps its value and an explicit
      null clears it. A `blankToNull` step maps the empty string a cleared date
      or select posts onto null before validation. Unlinking a login now also
      drops the adopted email, so notifications cannot keep reaching an account
      that is no longer that person's. The audit row records exactly which
      fields moved, rather than only recording links.

      No client change was needed: all four callers already send a single field
      at a time, and `Staff.tsx` was already written as
      `manager_id: managerId || null`, expecting a clear that silently did
      nothing. Covered by `lib/sqlUpdate.test.js`.
- [x] **4. Overview KPIs do not reconcile.** *Done.* Every "days taken" figure
      now counts **working days falling inside the window**, via one shared
      `WORKING_DAYS_IN_RANGE` lateral subquery, so the type bars, the department
      bars and the trend line measure the same thing and add up to each other.
      The trend attributes each day to the month it falls in, so a leave
      spanning two months is split between them rather than credited entirely
      to its start month.

      A "Days taken" tile states the total the three panels sum to, and a line
      under it says outright that "Applications submitted" counts by date
      applied and will not match — two different measures, no longer presented
      as if they should agree. Counts exclude applications contributing zero
      days, so a weekend-only absence no longer pads them.

      **`GET /report` changed too.** It had the same overlap-plus-full-length
      shape, which counted a leave straddling two pay periods in full against
      both. It now uses the same measure as the overview, so the CSV export and
      the dashboard agree. *Figures in this export will differ from before —
      they were overstated for any leave crossing a period boundary.*

      Also moved `calculateWorkingDays` and the new `monthsBetween` into
      `lib/leaveDates.js`. They are pure, but reaching them through
      `routes/hr.js` meant importing `config.js` and needing a `JWT_SECRET` just
      to test arithmetic — a small taste of why item 5 matters. Covered by
      `lib/leaveDates.test.js`, and verified end to end against a real Postgres:
      five panels, one number.

Phase 1 is complete.

## Phase 2 — Next sprint

Complete.

- [x] **5. Extract `services/leaveService.js`.** *Done.* `applyForLeave`,
      `cancelLeave`, `decideLeave`, `adjustBalance` and `setOpeningBalance` hold
      the workflow; routes do auth and response shape and nothing else — there
      is no longer a single `pool.connect()` in the router. `withTransaction()`
      replaced the BEGIN/COMMIT/ROLLBACK/release ladder each write path
      repeated, and `ServiceError` lets a service refuse something without
      knowing HTTP exists. Who may approve whose leave stays in the route, as a
      predicate passed in.
- [x] **6. Backend test coverage of the leave arithmetic.** *Done.* The
      decisions moved to `lib/accrualRules.js` and are unit-tested; the engine
      and the workflow are covered against a real Postgres. 112 tests.
      `npm test` runs the unit tests with no dependencies; `npm run test:db`
      starts a throwaway Postgres in Docker and runs everything.
- [x] **7. Frontend structure and design system.** *Done.* 26 hand-typed card
      surfaces collapsed onto `.app-panel`; `Card`, `CardHeading` and `StatTile`
      added to `Ui.tsx`, replacing the duplicate tile in Overview and Staff;
      `Staff.tsx` 956 → 763 lines with CSV, shapes and the balances report moved
      to `features/hr/`; `csvCell` deduplicated; `HrApp` lazy-loaded (a 61 kB
      chunk, off the main bundle).
- [x] **8. Accrual off the bare `setInterval`.** *Done.* The scheduled run takes
      a Postgres advisory lock, so scaling the API out no longer has two
      containers racing to credit the same fortnight. `ACCRUAL_SCHEDULER=off`
      plus `npm run accrual -- --due` moves it to cron; both take the same lock,
      so the two can overlap during a migration. Documented in
      `.env.prod.example`.

### Found by the Phase 2 tests — needs a decision

- **`reset_period = 'financial_year'` resets on 1 January**, i.e. the calendar
  year, despite the name. Naoero's financial year runs July to June. Balances
  are also keyed by calendar year, so this is not a one-line change — it is a
  policy question about when leave should actually be forfeited. Left exactly
  as it was; current behaviour is pinned by a test that says so.
- **Resets use today's date, not the period being run.** A catch-up run for a
  period three months ago applies today's reset boundary. The net balances come
  out right because `last_reset_at` stops a second application, but the
  attribution is wrong. Using `periodEnd` would be more correct.
- **Leave spanning 31 December** is charged wholly to the year it began, and
  `balanceYearFor` in `leaveService.js` is the single place that decides it.

### Still open from this phase

- Set-based accrual. `leaveAccrual.js` still issues ~3 queries per employee per
  leave type inside one transaction (~4,500 sequential queries at 500 staff).
  Now safe to attempt: the behaviour is pinned by tests.
- Pagination on `/employees`, `/leaves`, `/team`, `/calendar`, `/report`,
  `/employees/balances` — all still return full result sets.
- Reconcile duplicate employee records: `hr.js` auto-creates a row keyed on
  `reviewer_id` on any `hr_access` request, while `/employees/import` creates
  unlinked rows matched only by name.
- One icon system. `lucide-react` is an app-wide dependency used by `apps.ts`,
  `Login`, `Admin` and `Staff`, while `Ui.tsx` has a hand-rolled `Icon`. HR is
  internally consistent; converging the whole app is a separate change.
- `PUT /policies/:id` still uses COALESCE, so a leave type's `description`
  cannot be cleared (carried over from item 3).

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

## Follow-ups found while doing the work

- `Generator.tsx:320` and `Generator.tsx:354` build ABA download filenames with
  `toISOString().slice(0, 10)` — the same UTC bug as item 2, naming a file with
  yesterday's date at UTC+12. Left alone deliberately: that is the payment-file
  flow, not HR, and `lib/date.ts` is now there whenever it is picked up.
- `PUT /policies/:id` uses the same COALESCE shape as item 3, so a leave type's
  `description` cannot be cleared. Harmless today only because the Policies form
  never sends `description` at all — worth folding into item 5.

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
