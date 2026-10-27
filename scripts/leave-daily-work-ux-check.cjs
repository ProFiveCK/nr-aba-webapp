// All API calls are synthetic. Run against Vite, never against real records.
// PLAYWRIGHT_MODULE=/path/to/playwright LEAVE_CHECK_URL=http://127.0.0.1:5187 node scripts/leave-daily-work-ux-check.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Encountered two children')) errors.push(message.text()); });
  let permissions = { admin: true, hr_admin: true, hr_access: true, hr_leave_approve: true, hr_leave_apply: true };
  let employeeId = 'employee', posts = 0;
  const person = id => ({ id, display_name: id === 'employee' ? 'Example Employee' : 'Another Employee', status: 'active', reviewer_id: 'login', department_id: 'department', division_id: 'division', department_code: 'Example Department', division_code: 'Example Division', leave_policy_regime: 'government', external_ids: [], account_name: 'Employee Login', account_status: 'active' });
  const summary = () => ({ id: 'grant', employee_id: employeeId, employee_name: person(employeeId).display_name, code: 'recreation', start_date: '2026-11-16', end_date: '2026-11-18', charge: '3', status: 'approved', stage_index: 0, submitted_at: '2026-10-07T00:00:00Z', can_pdf: true });
  await page.route('**/api/**', async route => {
   const request = route.request(), url = new URL(request.url()), path = url.pathname;
   calls.push({ path, query: url.search, method: request.method() });
   let body;
   if (path === '/api/auth/me') body = { reviewer: { id: 'admin', email: 'admin@example.test', display_name: 'Example Administrator', role: permissions.hr_admin ? 'admin' : 'user', account_type: 'staff', permissions }, permissions };
   else if (path === '/api/hr/access-scopes/context') body = { central: true, scopes: [] };
   else if (path === '/api/hr/org-units') body = [];
   else if (path === '/api/hr/directory/work-patterns') body = [];
   else if (path === '/api/hr/directory') body = { employees: [person('employee'), person('another')], total: 2, page_size: 50 };
   else if (/\/directory\/(employee|another)\/profile$/.test(path)) { const id = path.split('/').at(-2); body = { employee: person(id), external_ids: [], service_periods: [], account_links: [] }; }
   else if (path.endsWith('/leave-arrangements')) body = { regime: 'government', account_type: 'employee', restricted: false, as_of: '2026-10-20', reporting_manager: { name: 'Manager' }, legacy: null, preparation: [], government: { policy: { label: 'Example policy', effective_from: '2026-01-01', effective_to: '2026-12-31' }, activation: { status: 'active', enabled_codes: ['recreation'] }, route: { stages: [] } } };
   else if (path === '/api/hr/directory/leave-policy-usage') body = { as_of: '2026-10-20', counts: { active_employees: 2, government_active: 2, government_awaiting_activation: 0, government_paused: 0, government_missing_job_plans: 0, legacy_awaiting_migration: 0, legacy_not_entitled: 0, legacy_excluded_contracts: 0 }, current_policy: { label: 'Example policy', effective_from: '2026-01-01', effective_to: '2026-12-31' }, initial_setup: { adopted: true }, schedulers: { government: true, legacy: false } };
   else if (path === '/api/hr/government/workflow/administration') body = { configs: [], plans: [], alerts: [] };
   else if (path === '/api/hr/government/workflow/requests') body = { requests: [summary()], total: 1, page_size: 50 };
   else if (path === '/api/hr/government/workflow/requests/grant') body = { ...summary(), stages: [], documents: [], reason: 'Approved family leave.', medical_mode: 'not_applicable', private_access: true, can_cancel: false, can_amend: !!permissions.hr_admin };
   else if (path.endsWith('/notifications')) body = { notifications: [] };
   else if (path === '/api/hr/government/workflow/case-tasks') body = { tasks: [{ id: 'task', request_id: 'grant', display_name: 'Example Employee', code: 'recreation', kind: 'amendment_reconciliation', status: 'open', due_date: null, description: 'Confirm the approved correction.' }], total: 1, today: '2026-10-20' };
   else if (path === '/api/hr/government/workflow/employees/employee/assisted-requests') { posts++; body = { id: 'new-request' }; }
   else if (path === '/api/hr/onboarding/accounts') body = { accounts: [], total: 0 };
   else if (path === '/api/hr/government/balances') body = { employees: [], total: 0, page_size: 50, departments: [], divisions: [], as_of: '2026-10-20' };
   else if (/\/government\/employees\/(employee|another)$/.test(path)) body = { employee: person(employeeId), periods: [], entitlements: [] };
   else if (path.endsWith('/account')) body = { employee: person(employeeId), accounts: [], movements: [], total: 0, page_size: 50, as_of: '2026-10-20' };
   else if (path.startsWith('/api/hr/directory/service-corrections/employees/')) body = [];
   else if (path === '/api/hr/onboarding/batches') body = { batches: [], total: 0 };
   else if (path === '/api/hr/onboarding/accounts') body = { accounts: [], total: 0 };
   else throw new Error(`Unexpected synthetic request: ${request.method()} ${path}`);
   await route.fulfill({ json: body });
  });
  const base = process.env.LEAVE_CHECK_URL || 'http://127.0.0.1:5187';
  await page.goto(base + '/leave');
  await page.getByRole('heading', { name: 'Work queue', exact: true }).waitFor();
  assert.ok(page.url().endsWith('/leave/work-queue'));
  assert.equal(await page.getByRole('heading', { name: 'Leave follow-ups' }).count(), 0);
  assert.equal(calls.some(c => c.path.endsWith('/administration') || c.path.endsWith('/case-tasks')), false);
  await page.getByRole('navigation', { name: 'Work queue views' }).getByRole('button', { name: 'Follow-ups', exact: true }).click();
  await page.getByRole('heading', { name: 'Leave follow-ups' }).waitFor();
  await page.getByRole('button', { name: 'Review follow-up case' }).click();
  await page.getByRole('dialog', { name: 'Leave application', exact: true }).waitFor();
  assert.ok(page.url().includes('request=grant'));
  await page.keyboard.press('Escape');
  // Old URLs retain the selected employee and normalise into the daily destinations.
  await page.goto(base + '/leave/staff?employee=employee');
  await page.getByRole('heading', { name: 'Employee leave', exact: true }).waitFor();
  assert.ok(page.url().includes('/leave/employees?employee=employee'));
  assert.equal(await page.getByRole('heading', { name: 'Apply on behalf of an employee' }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Leave follow-ups' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Prepare balance schedule', exact: true }).count(), 0);
  const employeeNav = page.getByRole('navigation', { name: 'Employee management' });
  assert.deepEqual(await employeeNav.getByRole('button').allTextContents(), ['Leave', 'Balances', 'Details and access']);
  assert.equal(await page.getByLabel('Application status').inputValue(), 'all');
  await page.getByRole('button', { name: 'Apply on behalf', exact: true }).click();
  await page.getByRole('heading', { name: 'Apply on behalf of an employee' }).waitFor();
  await page.getByLabel('Leave type', { exact: true }).selectOption('recreation');
  await page.getByLabel('Choose date for start date').fill('2026-11-16');
  await page.getByLabel('Choose date for end date').fill('2026-11-18');
  await page.getByLabel('Employee request / assisted-entry authority').fill('Signed employee request');
  await page.getByLabel('Reason for leave').fill('Employee authorised family leave.');
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await page.getByRole('heading', { name: 'Apply on behalf of an employee' }).waitFor({ state: 'hidden' });
  assert.equal(posts, 1);
  await page.getByRole('button', { name: 'View application', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel or shorten approved leave', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await employeeNav.getByRole('button', { name: 'Details and access', exact: true }).click();
  await page.getByRole('heading', { name: 'Payroll ID and login', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prepare account setup', exact: true }).count(), 0);
  assert.equal(await page.getByText('Advanced employee maintenance', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /^(Set up login|Activation & recovery)$/ }).click();
  await page.getByRole('heading', { name: 'Employee leave maintenance' }).waitFor();
  await page.getByRole('button', { name: '← Details and access', exact: true }).click();
  await page.getByRole('heading', { name: 'Payroll ID and login', exact: true }).waitFor();
  await employeeNav.getByRole('button', { name: 'Balances', exact: true }).click();
  await page.getByRole('button', { name: 'Leave access & schedules', exact: true }).click();
  await page.getByRole('heading', { name: 'Employee leave maintenance' }).waitFor();
  assert.ok(calls.some(c => c.path.endsWith('/administration') && c.query.includes('employee_id=employee')));
  await page.getByRole('button', { name: '← Balances', exact: true }).click();
  await page.getByRole('button', { name: 'Service & balance corrections', exact: true }).waitFor();
  await page.goto(base + '/leave/settings');
  await page.getByRole('button', { name: /Advanced maintenance Balance schedules/ }).click();
  await page.getByRole('heading', { name: 'Advanced maintenance', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Employee accounts', exact: true }).count(), 0);
  await page.getByRole('link', { name: /Bulk employee accounts Prepare/ }).click();
  await page.getByRole('heading', { name: 'Employee accounts', exact: true }).waitFor();
  await page.goto(base + '/leave/settings?view=workflow');
  await page.getByRole('heading', { name: 'Leave follow-ups' }).waitFor();
  assert.ok(page.url().includes('/leave/work-queue?view=followups'));
  await page.goto(base + '/leave/balances?employee=employee');
  await page.getByRole('button', { name: '← Staff balances', exact: true }).waitFor();
  assert.ok(page.url().includes('employee=employee') && page.url().includes('view=balances'));
  for (const width of [390, 1280]) {
   await page.setViewportSize({ width, height: 900 });
   await page.goto(base + '/leave/employees?employee=employee');
   await page.getByRole('heading', { name: 'Employee leave', exact: true }).waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  }
  await page.screenshot({ path: '/tmp/aba-leave-simplification-desktop.png', fullPage: true });
  // A balance-only user must never mount the staff editor or fetch its references.
  permissions = { hr_access: true, hr_balance_manage: true }; calls.length = 0;
  await page.goto(base + '/leave/employees');
  await page.getByRole('heading', { name: 'Staff balances', exact: true }).waitFor();
  assert.equal(calls.some(c => c.path.startsWith('/api/hr/directory') || c.path === '/api/hr/org-units'), false);
  permissions = { hr_access: true, hr_leave_approve: true }; calls.length = 0;
  await page.goto(base + '/leave/work-queue?view=followups');
  await page.getByRole('heading', { name: 'Pending approvals', exact: true }).waitFor();
  assert.equal(calls.some(c => c.path.endsWith('/case-tasks') || c.path.endsWith('/administration')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: daily navigation, employee list-first workflow, assisted entry, action disclosure focus, selected-employee maintenance, advanced tools, bookmark filters, permission boundaries and mobile layout. All API calls synthetic.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
