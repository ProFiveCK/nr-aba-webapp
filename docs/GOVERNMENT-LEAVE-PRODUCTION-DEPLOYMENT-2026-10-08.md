# Government Leave: production deployment and Treasury setup

Prepared 08/10/2026. Release branch: `codex/government-leave-production`. Merge its pull request into `main` before the production update. Production checkouts remain deploy-only; use `git pull --ff-only`.

## What Treasury gets in this release

The existing personnel register opens in the consolidated employee workspace, with retained balances, eligibility, managers, accounts, applications and approval PDFs. Government policy, initial setup, dated offices, service/opening certification, applications, Medical tracking, Payroll and readiness tools become available to authorised staff.

**The Treasury rollout finishes with existing credited balances carried into Government Leave and the Government policy governing future leave for the cohort.** The code upgrade, setup adoption, balance certification and employee activation are steps in this same rollout. The schema upgrade alone does not complete it: no employee is automatically enrolled and no balance is converted at startup. Keep Treasury submissions paused until the reviewed transfer and activation below are complete. Do not restore the development database over production or import the Treasury employees again.

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

Restore the saved Finance accrual setting for staff who have not yet cut over, publish the built frontend and start the web service for the authorised setup work. Keep the agreed Treasury submission pause in place through steps 4 and 5:

```bash
dc up -d --no-deps --wait api
bash scripts/publish-frontend.sh
dc up -d --no-deps --wait web
dc ps
dc logs --tail=100 api
```

The first API startup applies the additive, idempotent schema through `initSchema()`. There is no separate SQL migration to run. Do not run `install.sh`, a review seed, or any database restore as part of this update. Never remove the existing PostgreSQL volume.

## 4. Finish Treasury setup in the portal

1. **Sign in as central HR.** Open Leave → Employees. Check the current Treasury roster, an employee's existing eligibility/manager, balance history and approved personnel PDF. Check normal employee sign-in/My Leave too.
2. **Verify organisation placement before manager approvals resume.** Retained manager authority now checks managed placement. Ensure Finance and its Treasury division exist under Settings → Organisation & approvers. The default upgrade does not infer placement IDs from text labels. Use Initial setup's unique exact matches, or Employees → Manage → Employee details → verified organisation placement. Until this is done, an old nominated manager can have an empty approval queue; central HR retains authorised access. After placement verification, check the real manager's approval queue before resuming approvals.
3. **Prepare the actual policy record.** Under Settings → Policies, reuse a suitable authorised published version if one exists. Otherwise prepare the corrected Government version, record its signed source and actual effective coverage, review the rules, and publish it when authorised. The form defaults are ordinary Recreation 3 months, temporary 12 months, Recreation 20 days/cap 60/14 days notice, Medical one 10-day pool/3 qualifying uncertified occasions, and Special 3 days. These are configuration defaults, not opening balances. The local record's publication authority was pending; do not copy that placeholder as production approval evidence.
4. **Adopt the existing register.** Settings → Initial setup: select the production policy and intended planning date; review every old-to-new type mapping; decide the unresolved Compassionate mapping explicitly; select only correct unique exact Finance/Treasury matches; review, save the draft, then Adopt existing database. If records changed since review, refresh and save a new revision. Adoption creates a production receipt and fills selected missing placement IDs; it does not enrol staff, change managers, replace rules or merge balances. See [initial setup guide](LEAVE-INITIAL-DATABASE-SETUP.md).
5. **Resolve access exceptions.** Use Employees → Preparation issues → No verified login and Manage → Employee details to link each existing employee to their verified active portal account. Do not create duplicate personnel records. Review the linked inactive account with HR; reactivate only if it should currently have access. Confirm employee Leave capabilities and any unfinished password-change requirements. Existing linked active accounts keep their passwords/Google identities. Payroll IDs are not a prerequisite for continued retained Finance self-service.
6. **Check HR and approval scopes.** Under Settings → HR access, set dated department/division scopes for noncentral HR/approvers. A capability alone no longer means government-wide personnel access. Existing nominated managers remain distinct from Government approval-office appointments. Test using each responsible officer's own account; appointments alone do not grant permissions.
7. **Continue to the Government cutover below.** Organisation setup and login access are preparation; they are not the Treasury go-live acceptance. Keep submissions paused, name the Treasury support contact and complete the balance transfer and activation before staff resume leave applications. Government workflow queues are in-app; this release does not add Government workflow email reminders.

## 5. Carry Treasury balances and activate Government Leave

Complete this as part of the agreed Treasury release, with the actual accountable officers. Record the production cutover date and use a fresh production source snapshot:

- Verify Payroll identifiers, appointment/category (including temporary/intern terms), credited continuity/exclusions, schedule/roster, calendar/Gazette dates and actual approval offices. Confirm appropriate acting/substitute officers where self-approval would occur.
- Reconcile each employee's opening targets, prior Medical usage/uncertified occasions, annual/service periods and every retained pending/future application. The existing credit is the starting balance; do not replace it with the new annual allowance, backdate a new award, or add pending days as extra credit.
- Under **Prepare Government Leave → Opening & cutover review**, select the exact verified latest active balance rows for Recreation, Medical and Special. The target must equal their full remaining credit. The adopted mappings must match the selected Government type, and a second central HR officer must certify the exact source snapshot. Certification posts the opening/correction and its one-time transfer certificate together. A changed source invalidates the review; the same credit cannot be transferred again. Ordinary opening entries alone do not create a protected transfer.
- Existing above-limit credit remains usable after its certified transfer. For example, five credited Special days become five Government days at cutover; the next approved annual renewal uses the Government three-day rule. Recreation accrual stops at the Government cap without clipping a protected opening above that cap. Government Medical remains one shared pool; review the active certified/uncertified source rows and baseline usage/occasions, excluding superseded or duplicate historical Sick balances. The 07/10 copy had 15 Special balances above three days, so source-backed transfer is material to Treasury's activation.
- Reconcile the six recorded Furlough balances separately against verified credited service and prior leave/payout baselines under the Government Furlough/benefit controls. Preserve the reviewed remaining credit through the signed transition; do not merge Furlough into Recreation or a common annual opening. Unresolved differences remain an assisted HR case and block that employee's completed rollout.
- Employees → Manage → Prepare Government Leave guides identity/service, login/enrolment, service/openings, retained-leave reconciliation and independent activation. **Enrolment currently pauses existing submissions before openings/reconciliation can be completed.** Schedule the whole preparation window and keep assisted HR handling available; do not enrol the whole department merely to explore the screens.
- Obtain independent certification/activation and approved update plans. Confirm the employee preview/submission, actual approval chain, evidence, final PDF and Salary Unit acknowledgement with a small real pilot. Record readiness, receiving-system reconciliation, support/training and recovery evidence.
- After configurations and update plans are independently approved, set `GOVERNMENT_LEAVE_SCHEDULER=on`; recreate the API with `dc up -d --no-deps --wait api`. Use one agreed accrual owner and check the first complete due run. Government plans and employee configuration must be independently published before scheduled jobs can post.

**Treasury go-live acceptance:** every active employee in the agreed production cohort has verified access, the applicable Government types independently activated, source-backed carried credits reconciled exactly, retained leave resolved, actual approval offices tested, and approved scheduling under one accrual owner. Review the cohort in Operations → rollout readiness and record any assisted cases explicitly; do not label the whole cohort ready while a member is blocked. Resume Treasury submissions and paused jobs only after this check, then verify the first complete due run and monitor the real approval queues.

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

- Local CI: 488 backend tests passed with none skipped; 120 frontend tests passed with one existing skip; lint, TypeScript/Vite build and runtime dependency audit passed (zero vulnerabilities).
- Production Docker API image built successfully and ran with its Node 20 runtime in an isolated local stack.
- Fresh 07/10 production-backup restore: all 37 original table projections/18,892 source rows preserved after two schema initializations; 29 personnel/25 linked logins/109 balances/six applications retained; zero Government employees, policies or adopted setups created automatically.
- Certified credit transfer tests cover full five-day Special usability, Medical source consolidation and prior usage, source ownership/mapping, changed-source rejection, atomic audit rollback, duplicate prevention, the next three-day Special renewal, and capped future Recreation accrual.
- Desktop and 390px release workspace/Settings checks use the fresh isolated copy, without changing employee records. The new transfer form was checked separately using a clearly labelled synthetic employee; source selection populated 20/10/5-day targets correctly, with no overflow or browser warnings/errors.
- The local backup and previous review database remain separate from production. These checks establish release/build/data-preservation evidence; live production setup, permissions and employee cutover remain the operator's steps above.
