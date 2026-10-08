# Government Leave: production deployment and Treasury setup

Prepared 08/10/2026; updated 09/10/2026 for the existing live Treasury register, initial admin migration and MC/non-MC approval forms. PR #15 is already deployed. The initial admin migration/Medical-form follow-up is prepared on `fix/treasury-admin-initial-migration`; test and merge the follow-up into `main` before updating production. Production checkouts remain deploy-only; use `git pull --ff-only`.

## What Treasury gets in this release

The existing personnel register opens in the consolidated employee workspace, with retained balances, eligibility, managers, accounts, applications and approval PDFs. Government policy, initial setup, configurable approval routes and nominations, cohort balance consolidation, applications, Medical tracking, Payroll and readiness tools become available to authorised staff.

**The Treasury rollout finishes with existing credited balances carried into Government Leave and the Government policy governing future leave for the cohort.** The code upgrade, setup adoption, balance certification and employee activation are steps in this same rollout. The schema upgrade alone does not complete it: no employee is automatically enrolled and no balance is converted at startup. Treasury is already live: staff continue using their current arrangements during preparation. The reviewed cohort switches atomically when the administrator applies it; there is no roster-wide submission pause for preparation. A source changed by normal live use requires a fresh preview. Do not restore the development database over production or import the Treasury employees again.

The 07/10/2026 backup used for verification contains 29 Finance/Treasury employees, 25 linked logins, 109 balance rows and six applications. Of those linked logins, 24 are active and one is inactive. Four staff have no linked login. Production may have newer records: compare against its own fresh snapshot, not these historical counts.

The policy publication and initial-setup adoption performed locally are **database records, not Git changes**. A clean restore has zero Government policies and zero adopted setups. Prepare/adopt them in production as described below; copying the whole local database is not part of deployment.

## 1. Before the maintenance window

- Merge the release PR, record the merged SHA, and arrange a brief no-write maintenance window with Treasury. Include other portal users because the database is shared with ABA, FOREX and Wellness.
- Check the production checkout is on `main` and clean. Resolve server-only changes through a branch/PR before pulling. Do not reset them.
- Retain the current `.env.prod`, JWT/SMTP/data encryption keys, network, database volume and existing file stores. Use the current production configuration, never the local-review runtime file.
- Confirm a portal administrator/central HR account has `hr_access` and `hr_admin`. Ordinary employees need `hr_access` and `hr_leave_apply`; approval officers need their explicit approval capability and the correct scope.
- Use the existing supported backup/recovery procedure for external files and any externally hosted database. The commands below cover the standard repository Docker Compose database and served frontend. Keep the recovery set restricted and copy it to the approved off-host backup destination.

From the existing production checkout, in one Bash session:

```bash
set -euo pipefail
umask 077
dc() { docker compose --env-file .env.prod "$@"; }
git status --short --branch
dc ps
LEAVE_PREVIOUS_SHA=$(git rev-parse HEAD)
LEAVE_RELEASE_STAMP=$(date +%Y%m%d-%H%M%S)
LEAVE_RELEASE_DIR="$PWD/archive/government-leave-$LEAVE_RELEASE_STAMP"
mkdir -p "$LEAVE_RELEASE_DIR"
printf '%s\n' "$LEAVE_PREVIOUS_SHA" > "$LEAVE_RELEASE_DIR/previous-code-sha.txt"
cp -p .env.prod "$LEAVE_RELEASE_DIR/production.env.backup"
tar -czf "$LEAVE_RELEASE_DIR/frontend-before.tar.gz" -C app/client dist
LEAVE_PREVIOUS_IMAGE=$(docker inspect --format '{{.Image}}' ron-aba-backend-prod)
docker image tag "$LEAVE_PREVIOUS_IMAGE" "ron-aba-backend:before-government-leave-$LEAVE_RELEASE_STAMP"
printf '%s\n' "ron-aba-backend:before-government-leave-$LEAVE_RELEASE_STAMP" > "$LEAVE_RELEASE_DIR/previous-api-image.txt"
```

Before restarting, edit the **existing** `.env.prod`:

```dotenv
GOVERNMENT_LEAVE_SCHEDULER=off
```

Retain `ACCRUAL_SCHEDULER` at its current production value for normal operation. The release keeps Finance accrual separate from Government jobs. Confirm `LOCAL_REVIEW_ONLY` is absent, `NODE_ENV` is not overridden to development, and no `VITE_LOCAL_REVIEW_KIND` is set in the frontend build environment. Do not change SMTP, Google sign-in or encryption keys for this release.

## 2. Pull and build while the current site keeps running

```bash
git fetch origin
git pull --ff-only origin main
git rev-parse HEAD
dc config --quiet
npm --prefix app/client ci --no-fund --no-audit
npm --prefix app/client run build
dc build api
```

Verify `HEAD` contains the merged release. Stop here if any build fails. The frontend now builds to `app/client/build`; Nginx still serves `app/client/dist`. A build alone does not publish the new frontend.

## 3. Freeze writes, back up, then switch the API and frontend

At the agreed maintenance window, pause external writers/sync jobs and stop the public web service. Stop the API as well so its accrual scheduler cannot alter the backup/snapshot during the update. PostgreSQL stays running.

```bash
dc stop web api
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$LEAVE_RELEASE_DIR/database-before.sql.gz"
gzip -t "$LEAVE_RELEASE_DIR/database-before.sql.gz"
dc exec -T postgres sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/leave-production-snapshot.sql > "$LEAVE_RELEASE_DIR/leave-before.jsonl"
```

For the comparison, temporarily run the new API with both schedulers off. This override affects only this startup and does not alter the saved production accrual setting:

```bash
cat > "$LEAVE_RELEASE_DIR/verify-schedulers.yml" <<'YAML'
services:
  api:
    environment:
      ACCRUAL_SCHEDULER: 'off'
      GOVERNMENT_LEAVE_SCHEDULER: 'off'
YAML
docker compose --env-file .env.prod -f docker-compose.yml -f "$LEAVE_RELEASE_DIR/verify-schedulers.yml" up -d --no-deps --wait api
dc exec -T postgres sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/leave-production-snapshot.sql > "$LEAVE_RELEASE_DIR/leave-after.jsonl"
diff -u "$LEAVE_RELEASE_DIR/leave-before.jsonl" "$LEAVE_RELEASE_DIR/leave-after.jsonl"
```

A zero diff confirms all retained employee fields, balances, applications/PDF snapshots and legacy leave-type settings in the snapshot are preserved. New Government columns/tables are deliberately outside this comparison. If the comparison or API health fails, keep the site closed and investigate before continuing.

Restore the saved Finance accrual setting for staff who have not yet cut over, publish the built frontend and start the web service. Existing Treasury submissions remain available during setup:

```bash
dc up -d --no-deps --wait api
bash scripts/publish-frontend.sh
dc up -d --no-deps --wait web
dc ps
dc logs --tail=100 api
```

The first API startup applies the additive, idempotent schema through `initSchema()`. There is no separate SQL migration to run. Do not run `install.sh`, a review seed, or any database restore as part of this update. Never remove the existing PostgreSQL volume.

## 4. Finish Treasury setup in the portal

1. **Sign in as the system administrator with central HR capabilities.** Open Leave → Employees. Check the current Treasury roster, an employee's existing eligibility/manager, balance history and approved personnel PDF. Check normal employee sign-in/My Leave too.
2. **Verify organisation placement before manager approvals resume.** Retained manager authority now checks managed placement. Ensure Finance and its Treasury division exist under Settings → Organisation & approvers. The default upgrade does not infer placement IDs from text labels. Use Initial setup's unique exact matches, or Employees → Manage → Employee details → verified organisation placement. Until this is done, an old nominated manager can have an empty approval queue; central HR retains authorised access. After placement verification, check the real manager's approval queue before resuming approvals.
3. **Prepare the actual policy record.** Under Settings → Policies, reuse a suitable authorised published version if one exists. Otherwise prepare the corrected Government version, record its signed source and actual effective coverage, review the rules, and publish it when authorised. The form defaults are ordinary Recreation 3 months, temporary 12 months, Recreation 20 days/cap 60/14 days notice, Medical one 10-day pool/3 qualifying uncertified occasions, and Special 3 days. These are configuration defaults, not opening balances. The local record's publication authority was pending; do not copy that placeholder as production approval evidence.
4. **Adopt the existing register.** Settings → Initial setup: select the production policy and intended planning date; review every old-to-new type mapping; decide the unresolved Compassionate mapping explicitly; select only correct unique exact Finance/Treasury matches; review, save the draft, then Adopt existing database. If records changed since review, refresh and save a new revision. Adoption creates a production receipt and fills selected missing placement IDs; it does not enrol staff, change managers, replace rules or merge balances. See [initial setup guide](LEAVE-INITIAL-DATABASE-SETUP.md).
5. **Resolve access exceptions.** Use Employees → Preparation issues → No verified login and Manage → Employee details to link each existing employee to their verified active portal account. Do not create duplicate personnel records. Review the linked inactive account with HR; reactivate only if it should currently have access. Confirm employee Leave capabilities and any unfinished password-change requirements. Existing linked active accounts keep their passwords/Google identities. Payroll IDs are not a prerequisite for continued retained Finance self-service.
6. **Check HR and approval scopes.** Under Settings → HR access, set dated department/division scopes for noncentral HR/approvers. A capability alone no longer means government-wide personnel access. Existing nominated managers remain distinct from Government approval-office appointments. Test using each responsible officer's own account; appointments alone do not grant permissions.
7. **Continue to the Government cutover below.** Treasury staff are already operating. Organisation setup and login checks prepare their migration; continue existing submissions until each reviewed cohort is applied. Government workflow queues are in-app; this release does not add Government workflow email reminders.

## 5. Consolidate Treasury into the common Government workflow

1. **Configure the route.** Settings → Organisation & approvers → Approval route. Select the managed Treasury/Finance department (or Government default), then Configure levels. Choose **One level: HoD**, **Two levels: first approver → HoD**, or identify up to five ordered offices with your chosen level names. Record the setup/authority reference and publish. The last level grants leave. Nominate the actual people under Leave approvers; each needs a verified active login, dated office appointment and explicit approval permission. An officeholder’s own application cannot be self-approved: HR records the authorised substitute against that pending stage (Chief Secretary requires a verified acting appointment). HR verifies Medical and Special supporting evidence separately when the chosen route has no HR approval level; ordinary Recreation can finish with the nominated approver alone. This setting governs new Recreation, Medical and Special applications. Event cases retain their specific route. Later revisions apply to new applications; pending applications retain their submitted levels, labels and decisions. A reviewed continuation obtains fresh approvals under the new route.
2. **Import the existing personnel setup.** In Settings → Readiness select staff sharing an ordinary employment category and weekly schedule, then **Import existing staff setup**. Recorded start dates carry through directly from the database; the form only requests dates that are genuinely missing. Choose the shared category once. Treasury’s confirmed Monday–Friday, 09:00–17:00 workweek with one unpaid lunch hour (7 paid hours per day) is configured once for the group and selected automatically. Confirm the group setup, preview and import. The default calendar anniversary and 1 March leap-day treatment preserve the legacy reset convention; exceptions/source details remain editable. If missing dates are not yet available, select staff with recorded dates first. Prepare teacher, intern, roster, interrupted-service or already-prepared records individually. Verify approved calendar coverage before consolidation. Payroll IDs remain required for Payroll handover, but do not block initial admin cohort migration. Keep the employee on their existing regime during cohort preparation. The current register's eligibility flag and join date do not prove every service or appointment fact. Resolve inactive/unlinked accounts through the existing account tools; preserve personnel IDs and existing active logins.
3. **Resolve pending legacy leave.** Reconcile each pending/future application and its reservations. A cohort with unresolved pending/future legacy leave is blocked; use individual cutover reconciliation and fresh-approval transfer where appropriate. Do not erase source applications or add pending amounts to balance credit.
4. **Preview the Treasury cohort as administrator.** Leave **Initial admin migration** selected.  Settings → Readiness → select the department and its existing active staff (up to 50) → Consolidate existing staff. Supply the cutover date on/before today, actual balance/Payroll/transition/history references and each employee's complete pre-cutover Medical dates and uncertified occasions. Blank Medical history requires explicit confirmation that the reviewed record has no prior absence in that service year. Preview shows the exact source rows, credited amounts, approval levels and remaining preparation issues. For a missing stored source, select **Record missing source credit**, choose the existing employee and mapped type, and enter the actual verified remaining days/year, register reference and reason. Zero must be explicitly verified. This action refuses existing rows and does not seed a default. Repeat for each missing source, then preview the cohort again.
5. **Apply as the administrator.** With **Initial admin migration** selected, the preparing system administrator reviews and freezes the complete ready cohort, then selects **Apply initial admin migration**. No second HR officer is needed for initial setup. The server rechecks current authority, roster, sources, history, rules and offices; any changed fact stops the whole transaction. It carries full source-backed credits, activates Recreation/Medical/Special together and records an immutable receipt. Repeating the same apply does not create duplicate credits. The usual independently certified option remains available when initial admin migration is not selected.
6. **Review Furlough and exceptions.** Reconcile the six recorded Furlough balances separately against verified credited service and prior leave/payout baselines under the Government Furlough/benefit controls. Preserve reviewed remaining credit through the signed transition; do not merge Furlough into Recreation or a common annual opening. Inactive personnel, nonstandard appointment/schedule cases, missing stored credit and unresolved legacy applications stay in the register for explicit individual handling; do not silently omit them from the agreed rollout.
7. **Complete future accrual and the pilot.** Under Leave operations → Activation & accrual, the administrator who applied the initial cohort can prepare and approve each employee’s first plan for each leave type. Later replacement plans retain independent approval. Confirm actual staff submission, the nominated one/two-level route, separate private HR evidence review, final PDF and Salary Unit acknowledgement. After configurations and plans are approved, set `GOVERNMENT_LEAVE_SCHEDULER=on`; recreate the API with `dc up -d --no-deps --wait api`. Use one agreed accrual owner and check the first complete due run. Cohort consolidation does not itself enable the scheduler or invent an accrual anchor.

The one-time certified credit is fully usable under Government Leave. For example, five credited Special days become five Government days at cutover; the next annual renewal uses the three-day Government rule. Recreation accrual stops at the Government cap without clipping a protected carried opening above it. On My Leave, **Medical — with MC** and **Medical — without MC (non-MC)** are explicit choices. A newly approved Government PDF starts with the Treasury approval form, checks the chosen MC/non-MC category and includes the detailed Medical usage/approval annex. This changes neither existing stored PDFs nor annual entitlements. Medical is one shared pool: active certified/uncertified source credits are reviewed together, prior usage is tracked without deducting it again, and the Government uncertified-occasion rule governs future applications. Superseded or duplicate historical Sick rows are excluded. The 07/10 copy had 15 Special balances above three days, so exact source-backed transfer matters.

The individual opening/reconciliation path remains available for an employee who needs a bespoke disposition or who already started Government operation. Individual enrolment pauses existing submissions before activation; use the cohort path for a ready initial Treasury roster to apply its switch and credits together.

**Treasury go-live acceptance:** every active employee in the agreed production cohort has verified access, the applicable Government types activated through the recorded initial admin migration or independent process, source-backed carried credits reconciled exactly, retained leave resolved, actual approval offices tested, and approved scheduling under one accrual owner. Review the cohort in Settings → Readiness and record any assisted cases explicitly; do not label the whole cohort ready while a member is blocked. Existing Treasury submissions stay available throughout preparation. Enable Government scheduled jobs after this check, then verify the first complete due run and monitor the real approval queues.

Government policy is the common operating rule after cutover, including its category-specific eligibility and approvals. Historical Finance records remain audit history. The portal remains the interim leave system; TechnologyOne Leave handover is a later project.

## Recovery if the release fails

Keep the portal closed to writes, stop the API and pause external writers. Retain failure logs privately. Use the saved API image plus frontend archive for a code rollback through a temporary Compose override pointing `api.image` to the saved tag and `api.pull_policy` to `never`; run `up` **without `--build`**. Restore the prior frontend into the existing `app/client/dist` directory while web is stopped, then restart Nginx. Do not check out or commit rollback changes on the production `main` branch.

Using the saved release directory from this deployment:

```bash
dc stop web api
LEAVE_ROLLBACK_IMAGE=$(cat "$LEAVE_RELEASE_DIR/previous-api-image.txt")
cat > "$LEAVE_RELEASE_DIR/rollback-api.yml" <<YAML
services:
  api:
    image: $LEAVE_ROLLBACK_IMAGE
    pull_policy: never
YAML
docker compose --env-file .env.prod -f docker-compose.yml -f "$LEAVE_RELEASE_DIR/rollback-api.yml" up -d --no-deps --wait api
tar -xzf "$LEAVE_RELEASE_DIR/frontend-before.tar.gz" -C app/client
dc up -d --no-deps --wait web
```

This restores the old served page/assets without deleting the bind-mounted directory. Keep the rollback override in use until a reviewed forward fix is deployed; a normal API rebuild would select the new checkout again.

Additive tables can usually remain for a code rollback before any Government cutover. If records were enrolled or operational data changed, decide recovery with HR before reopening; older code cannot safely handle activated Government employees. Restoring the pre-release database loses later writes across the whole portal and requires a controlled restore/reconciliation. Preserve the failed database first. Never use the local 07/10 backup for a production rollback.

## Release verification

The initial admin follow-up adds coverage for same-admin migration without Payroll IDs, fresh role checks, changed-source rejection, first-plan-only administrative approval, 29-person atomic rollback, bulk foundation rollback and missing-credit audit/overwrite protection. Historical accrual holds ordered employee locks through its transaction, so concurrent migration rechecks the employee regime. Both MC and non-MC PDFs have been rendered and checked on the Treasury form. Static publication has been checked under a restrictive backup umask. The counts below describe the original PR #15 release.

- Local CI: 498 backend tests passed with none skipped; 120 frontend tests passed with one existing skip; lint, TypeScript/Vite build and runtime dependency audit passed (zero vulnerabilities).
- Production Docker API image built successfully and ran with its Node 20 runtime in an isolated local stack.
- Fresh 07/10 production-backup restore: all 37 original table projections/18,892 source rows preserved after two schema initializations; 29 personnel/25 linked logins/109 balances/six applications retained; zero Government employees, policies or adopted setups created automatically.
- Configurable-route and cohort tests cover one-level HoD final grant, ordered two-level decisions, frozen route revisions, private HR evidence verification, stale permissions/sources, a 29-person cohort, all-cohort rollback after the second employee, unchanged historical balances and idempotent application.
- Certified credit transfer tests cover full five-day Special usability, Medical source consolidation and prior usage, source ownership/mapping, changed-source rejection, atomic audit rollback, duplicate prevention, the next three-day Special renewal, and capped future Recreation accrual.
- Desktop and 390px release workspace/Settings checks use the fresh isolated copy, without changing employee records. The configurable one/two-level editor and cohort review/blocked-fact preview were checked on desktop and phone with synthetic records, without publishing a live route or consolidating real personnel. The transfer form was checked separately using a clearly labelled synthetic employee; source selection populated 20/10/5-day targets correctly, with no overflow or browser warnings/errors.
- The local backup and previous review database remain separate from production. These checks establish release/build/data-preservation evidence; live production setup, permissions and employee cutover remain the operator's steps above.
