# Leave review with the production backup

7 October 2026. Local review only; no production deployment or employee policy cutover.

## Open the application

Open <http://localhost:8081/review/local>. This signs into a separate **Local migration reviewer** account, created only in the isolated copy. It does not impersonate a Finance employee, change existing passwords or add a demo employee to the directory. Existing production account records remain available for normal local sign-in. The copy uses a fresh JWT secret, so production browser tokens do not authenticate here.

The Leave menu now has **Employees** and **Settings**. Employees opens the list directly. Its view selector provides **Existing leave records**, **Government balances & service**, **Government applications & jobs**, and **Payroll & handover**. Settings holds **Leave policies**, **Organisation & approvers**, **HR access**, **Payroll import**, **Onboarding**, and **Rollout readiness**. Old `/leave/staff` and `/leave/policies` bookmarks redirect to the corresponding new pages. Settings remains restricted to central HR; employee and scoped HR navigation retain their permission controls.

Start with **Employees → Employee list → Manage**, then **Employees → Existing leave records** to inspect the retained Finance data. Under **Settings → Leave policies**, expand **Existing leave policy settings** for the earlier rules and calendar. The government policy/calendar lists are empty until sourced versions are prepared.

## Restored data and upgrade evidence

Source: `backup/aba-prod-20261007.sql.gz` in the original project checkout. PostgreSQL dump version 15.19. SHA-256: `878a2251ff8ea57b2daa24ecc535593f925b562ab2063d48879cc94da987a1d4`.

The restore copied **37 tables and 18,892 rows**; every restored source table row count matched its COPY section. Leave contains **29 employees**, all **Finance / Treasury**, **109 balance records**, **6 applications**, and **0 leave attachments**. The backup contained **125 portal accounts** before the separate local reviewer was added. The dump contains the whole portal database, beyond the Leave records; it stays in the private local environment.

The application added the new schema successfully, and a second schema initialization completed. All original records in all **37 source tables** matched their baseline row counts and row-set hashes afterward, comparing the original source columns. The audit explicitly excludes the additional local reviewer and its test sessions. New columns, tables and indexes are additional schema and are outside that source-column comparison. User edits made during later local walkthroughs can legitimately change the audit result; keep the initial audit as migration evidence.

The original backup file is unchanged. The demo database remains in the separate `ron-leave-review` stack, stopped while the production-copy stack occupies port 8081. Neither a production Docker volume nor an existing review database was overwritten.

## Local isolation and restart

The new stack is `ron-leave-production-review`; its fixed database is `leave_production_review`. Only Nginx publishes a host port, bound to **127.0.0.1:8081**. API, database, review gateway and Vite run on an internal Docker network without outbound routing. Nginx also has a separate frontend network to serve the local port. A runtime check confirmed that the API cannot reach an external HTTPS endpoint.

The deployment flag `LOCAL_REVIEW_ONLY=production-copy` prevents mail transport creation/reloading and skips outgoing mail, including when the restored database holds live SMTP settings. This takes precedence over Admin settings. It refuses production runtime or an ordinary database name. Both accrual schedulers and AI are disabled. No synthetic personnel seed is mounted. The gateway and production-copy Compose file are separate local tooling and are not mounted by production Compose.

Generated secrets, restore logs, baseline/audit JSON and screenshots are in ignored `.leave-production-review/`, with a restricted parent directory and secret/report files. The runtime copies encryption keys from the local original checkout's `.env.prod` when available; a database-only restore does not prove recovery of production encrypted fields or external files. Existing Leave has no attachments in this backup. Complete portal recovery still requires checking the real keys and any external assets.

From this worktree root:

```sh
node scripts/leave-production-review.mjs status
node scripts/leave-production-review.mjs up
node scripts/leave-production-review.mjs audit
node scripts/leave-production-review.mjs stop
```

`up` starts the already restored copy and stops the demo stack to free port 8081. It does not import the backup again. `stop` retains the database volumes. To return to the demo after stopping the copy, run `./scripts/leave-review.sh up`.

The initial import was performed with `node scripts/leave-production-review.mjs restore /absolute/path/to/backup.sql.gz`. The restore tool accepts a complete plain PostgreSQL SQL dump compressed with gzip, validates COPY boundaries and permitted psql commands, checks its fixed Docker project/database, and **refuses any destination that already contains public tables**. A newer backup needs a separately prepared fresh copy; do not delete the current volume to repeat a walkthrough.

## Preparing Government Leave

The restored employees retain the **legacy** policy regime. The copy has no verified TechnologyOne Payroll IDs, service appointments, government policy/calendar versions or certified government openings. Those facts are not inferred from names, join dates or old leave-type labels.

Use the real Payroll export to reconcile identities and preserve leading zeros. Verify each person's appointment/category, service continuity, work schedule and placement. Record actual dated division/HOD/Chief Secretary assignments and applicable HR/Secretary/Minister offices. Publish signed policy and Gazette versions. Reconcile remaining balances, prior use and pending/future leave through **Payroll & handover → Opening & cutover review** and obtain independent certification. Only then prepare independent workflow activation and a pilot. The successful database upgrade does not itself approve policy interpretations, convert balances or activate employees.

## Verification

The PostgreSQL backend suite passed **389 tests**, with no skips. Frontend tests passed **104**, with one pre-existing skip; lint and production build passed. Desktop and fresh 390px mobile walkthroughs checked the actual employee list, a record dialog, existing leave tools, Settings, organisation references and old links. No horizontal overflow, HR API errors or browser errors were detected. Local isolation checks confirmed no mail transport and blocked API egress. All five local services were healthy.
