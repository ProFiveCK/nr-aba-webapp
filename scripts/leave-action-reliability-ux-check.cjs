// Run against Vite. All responses are synthetic; this never changes real leave.
// PLAYWRIGHT_MODULE=/path/to/playwright LEAVE_CHECK_URL=http://127.0.0.1:5188 node scripts/leave-action-reliability-ux-check.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.LEAVE_CHECK_URL || 'http://127.0.0.1:5188';
const certification = 'I certify that I have verified the application details and supporting information.';
const until = async (test, message) => {
    for (let i = 0; i < 100; i++) {
        if (await test()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(message);
};

(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [], held = [], decisions = [], uploads = [];
        page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
        const permissions = { hr_access: true, hr_admin: true, hr_leave_apply: true, hr_leave_approve: true };
        let holdDetail = '', detailFailure = false, approved = false, holdDownload = false, historyFailure = true, uploadFailure = true, holdUpload = false;
        let detailCalls = 0, downloadCalls = 0;
        const summary = id => ({ id, employee_id: 'employee', employee_name: `Employee ${id}`, code: 'recreation', start_date: '2026-11-16', end_date: '2026-11-17', charge: '2', stage_index: 0, status: approved ? 'approved' : 'pending', can_pdf: approved });
        const detail = id => ({ ...summary(id), stages: [{ id: 'stage', ordinal: 0, level: 'department', label: 'Head of Department', binding: { id: 'binding', approver_name: 'Approver' }, can_decide: !approved }], documents: [], private_access: true, reason: 'Verified family appointment.', can_cancel: !approved });
        await page.route('**/api/**', async route => {
            const request = route.request(), path = new URL(request.url()).pathname;
            let body = {};
            if (path === '/api/auth/me') body = { reviewer: { id: 'reviewer', display_name: 'Test reviewer', email: 'test@example.test', role: 'admin', account_type: 'staff', permissions }, permissions };
            else if (path === '/api/hr/me') body = { employee: { id: 'employee', display_name: 'Test employee', leave_policy_regime: 'government' }, balances: [] };
            else if (path.endsWith('/workflow/me')) body = { enabled_codes: ['recreation'] };
            else if (path.endsWith('/employee/account')) body = { employee: { display_name: 'Test employee' }, accounts: [], movements: [], total: 0, page_size: 50 };
            else if (path.endsWith('/workflow/requests')) body = { requests: ['A', 'B'].map(summary), total: 2 };
            else if (path.match(/\/workflow\/requests\/[AB]$/)) {
                detailCalls++;
                const id = path.split('/').at(-1);
                if (holdDetail === id) { held.push({ route, body: detail(id) }); return; }
                if (detailFailure) return route.fulfill({ status: 503, json: { message: 'Application refresh is temporarily unavailable.' } });
                body = detail(id);
            } else if (path.endsWith('/decisions')) {
                decisions.push(JSON.parse(request.postData())); approved = true; body = { status: 'approved' };
            } else if (path.endsWith('/pdf')) {
                downloadCalls++;
                if (holdDownload) { held.push({ route, download: true }); return; }
                return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
            } else if (path.endsWith('/employee/cases')) {
                uploads.push(request.postData());
                if (holdUpload) { held.push({ route, body: { id: 'case-created' } }); return; }
                if (uploadFailure) return route.fulfill({ status: 409, json: { message: 'Please verify these dates.' } });
                body = { id: 'case-created' };
            } else if (path === '/api/hr/leaves') {
                if (historyFailure) return route.fulfill({ status: 503, json: { message: 'History is temporarily unavailable.' } });
                body = [];
            } else if (path.endsWith('/notifications')) body = { notifications: [] };
            else throw new Error(`Unexpected synthetic API request: ${request.method()} ${path}`);
            await route.fulfill({ json: body });
        });
        const release = async () => {
            for (const item of held.splice(0)) {
                await item.route.fulfill(item.download ? { status: 503, json: { message: 'PDF is temporarily unavailable.' } } : { json: item.body }).catch(() => {});
            }
        };
        const row = id => page.locator('article').filter({ has: page.getByRole('heading', { name: `Employee ${id} · Recreation`, exact: true }) });
        const review = () => page.getByRole('dialog', { name: 'Review leave application', exact: true });
        await page.goto(base + '/leave/approvals');
        await row('A').getByRole('button', { name: 'Review application', exact: true }).waitFor();

        // A slow row does not block the rest of the queue; a late response cannot replace the user's newer selection.
        holdDetail = 'A';
        await row('A').getByRole('button', { name: 'Review application', exact: true }).evaluate(button => { button.click(); button.click(); });
        await until(() => held.length === 1, 'Detail request was not held');
        assert.equal(detailCalls, 1, 'A rapid repeated click must share the pending detail request');
        assert.equal(await row('B').getByRole('button', { name: 'Review application', exact: true }).isEnabled(), true);
        await row('B').getByRole('button', { name: 'Review application', exact: true }).click();
        await review().getByRole('heading', { name: 'Employee B · Recreation', exact: true }).waitFor();
        await release(); holdDetail = '';
        assert.equal(await review().getByRole('heading', { name: 'Employee B · Recreation', exact: true }).count(), 1);

        // A committed approval stays successful when its follow-up read fails, with a local retry instead of stale actions.
        detailFailure = true;
        await review().getByRole('checkbox', { name: certification, exact: true }).check();
        await review().getByRole('button', { name: 'Approve', exact: true }).click();
        await review().getByRole('status').filter({ hasText: 'Leave approved.' }).waitFor();
        await review().getByRole('alert').filter({ hasText: 'Application refresh is temporarily unavailable.' }).waitFor();
        assert.equal(await review().getByRole('button', { name: 'Approve', exact: true }).isDisabled(), true);
        assert.equal(await review().getByRole('button', { name: 'Close dialog', exact: true }).isEnabled(), true);
        assert.equal(decisions.length, 1);
        detailFailure = false;
        await review().getByRole('button', { name: 'Refresh application details', exact: true }).click();
        const approvedDialog = page.getByRole('dialog', { name: 'Leave application', exact: true });
        await approvedDialog.waitFor();
        assert.equal(await approvedDialog.getByRole('button', { name: 'Approve', exact: true }).count(), 0);

        // Downloads visibly run once, fail cleanly, and permit retry.
        holdDownload = true;
        await approvedDialog.getByRole('button', { name: 'Download approved PDF', exact: true }).evaluate(button => { button.click(); button.click(); });
        await approvedDialog.getByRole('button', { name: 'Preparing download…', exact: true }).waitFor();
        await until(() => held.length === 1, 'Download was not held');
        assert.equal(downloadCalls, 1);
        await release(); holdDownload = false;
        await approvedDialog.getByRole('alert').filter({ hasText: 'PDF is temporarily unavailable.' }).waitFor();
        assert.equal(await approvedDialog.getByRole('button', { name: 'Download approved PDF', exact: true }).isEnabled(), true);
        await approvedDialog.getByRole('button', { name: 'Download approved PDF', exact: true }).click();
        await until(() => downloadCalls === 2, 'Download could not be retried');
        await until(() => approvedDialog.getByRole('button', { name: 'Download approved PDF', exact: true }).isEnabled(), 'Download did not settle');
        assert.equal(await approvedDialog.getByRole('alert').count(), 0, 'A successful retry must clear the previous error');
        await page.keyboard.press('Escape');

        // Closing during a slow post-save refresh must not reopen the dialog later.
        approved = false;
        await page.getByRole('button', { name: 'Refresh applications', exact: true }).click();
        await row('B').getByRole('button', { name: 'Review application', exact: true }).click();
        await review().getByRole('checkbox', { name: certification, exact: true }).check(); holdDetail = 'B';
        await review().getByRole('button', { name: 'Approve', exact: true }).click();
        await review().getByText('Refreshing application details…', { exact: true }).waitFor();
        await until(() => held.length === 1, 'Post-save refresh was not held');
        await review().getByRole('button', { name: 'Close dialog', exact: true }).click();
        await release(); holdDetail = '';
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');

        // A stalled detail request times out and releases its row. Browser time is advanced, not wall-clock time.
        await page.clock.install();
        await page.getByLabel('Application status', { exact: true }).selectOption('all');
        holdDetail = 'A';
        await row('A').getByRole('button', { name: 'View application', exact: true }).click();
        await until(() => held.length === 1, 'Timeout request was not held');
        await page.clock.fastForward(30_001);
        await page.getByRole('alert').filter({ hasText: 'The server took too long to respond.' }).waitFor();
        assert.equal(await row('A').getByRole('button', { name: 'View application', exact: true }).isEnabled(), true);
        await release(); holdDetail = '';
        await row('A').getByRole('button', { name: 'View application', exact: true }).click();
        await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
        await page.clock.resume();

        await page.goto(base + '/leave/my-leave');
        await page.getByText('Leave history', { exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'History is temporarily unavailable.' }).waitFor();
        assert.equal(await page.getByText('Loading leave history…', { exact: true }).count(), 0);
        historyFailure = false; await page.getByRole('button', { name: 'Try loading history again', exact: true }).click();
        await page.getByText('No additional leave records.', { exact: true }).waitFor();

        // Exercise the actual shared components in nested dialogs, including simultaneous unmounts.
        // Match Vite's current module URL so HMR query strings do not create a second UI module.
        const fieldsSource = await (await page.request.get(base + '/src/apps/leave/ManagementFields.tsx')).text();
        const uiModule = fieldsSource.match(/from "([^"]*\/components\/Ui\.tsx[^"]*)"/)[1];
        await page.route('**/__action-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div><script type="module">
            import RefreshRuntime from '/@react-refresh';
            RefreshRuntime.injectIntoGlobalHook(window);
            window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        </script><script type="module">
            import React from '/node_modules/.vite/deps/react.js';
            const {useState}=React;
            import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
            const {createRoot}=ReactDOM;
            import {Button,Modal} from '${uiModule}';
            import {ActionDialog} from '/src/apps/leave/ManagementFields.tsx';
            import {GovernmentCaseApplication} from '/src/apps/leave/GovernmentCases.tsx';
            import {ConfirmProvider} from '/src/contexts/ConfirmContext.tsx';
            import {useConfirm} from '/src/contexts/useConfirm.ts';
            const h=React.createElement;
            window.saves=0;window.confirmResults=[];
            function Harness(){
                const [parent,setParent]=useState(false),[child,setChild]=useState(false);
                const {confirm}=useConfirm();
                return h('div',{className:'leave-workspace'},
                    h(Button,{onClick:()=>setParent(true)},'Open parent'),
                    h(Button,{onClick:()=>{confirm('First confirmation').then(result=>window.confirmResults.push(['first',result]));confirm('Second confirmation').then(result=>window.confirmResults.push(['second',result]));}},'Concurrent confirmations'),
                    h(GovernmentCaseApplication,{employeeId:'employee',assisted:true,onChanged:()=>{}}),
                    parent&&h(Modal,{title:'Parent dialog',onClose:()=>setParent(false)},
                        h('details',null,h('summary',null,'Hidden controls'),h(Button,null,'Hidden button')),
                        h('fieldset',{disabled:true},h(Button,null,'Disabled by fieldset')),
                        h(Button,{onClick:()=>setChild(true)},'Open child'),
                        child&&h(ActionDialog,{title:'Child action',onClose:()=>setChild(false),onSave:async()=>{window.saves++;await new Promise((resolve,reject)=>window.finishSave=ok=>ok?resolve():reject(new Error('Synthetic save failure.')));}},
                            h(Button,{variant:'secondary',onClick:()=>{setChild(false);setParent(false);}},'Close both'))));
            }
            createRoot(document.getElementById('root')).render(h(ConfirmProvider,null,h(Harness)));
        </script></body></html>` }));
        await page.goto(base + '/__action-harness');
        await page.getByRole('button', { name: 'Open parent', exact: true }).click();
        await page.getByRole('button', { name: 'Open child', exact: true }).click();
        let child = page.getByRole('dialog', { name: 'Child action', exact: true });
        await child.getByRole('button', { name: 'Save verified change', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await child.getByRole('button', { name: 'Close dialog', exact: true }).evaluate(button => button === document.activeElement), true, 'Tab must wrap inside the child');
        await child.getByLabel('Verification reason', { exact: true }).fill('Verified the recorded authority.');
        await child.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
        await child.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.saves), 1);
        await page.evaluate(() => window.finishSave(false));
        await child.getByRole('alert').filter({ hasText: 'Synthetic save failure.' }).waitFor();
        assert.equal(await child.getByLabel('Verification reason', { exact: true }).inputValue(), 'Verified the recorded authority.');
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
        await page.getByRole('button', { name: 'Open child', exact: true }).click();
        child = page.getByRole('dialog', { name: 'Child action', exact: true });
        await child.getByRole('button', { name: 'Close both', exact: true }).click();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'Out-of-order dialog cleanup must restore scrolling');
        await page.getByRole('button', { name: 'Concurrent confirmations', exact: true }).click();
        await page.getByText('First confirmation', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await until(async () => (await page.evaluate(() => window.confirmResults)).length === 2, 'Both confirmation promises must settle');
        assert.deepEqual(await page.evaluate(() => window.confirmResults), [['second', false], ['first', false]]);

        // Assisted applications also retain the retry identity and ignore synchronous double submits.
        await page.getByLabel('Leave type', { exact: true }).selectOption('official');
        await page.getByLabel('From date', { exact: true }).fill('16/11/2026');
        await page.getByLabel('To date', { exact: true }).fill('17/11/2026');
        assert.equal(await page.getByLabel('Event or personnel-file reference', { exact: true }).count(), 0);
        await page.getByLabel('Employee request / assisted-entry authority', { exact: true }).fill('Signed employee authority');
        await page.getByLabel('Reason for leave', { exact: true }).fill('Verified official leave request.');
        await page.getByRole('button', { name: 'Submit application', exact: true }).evaluate(button => { button.click(); button.click(); });
        await page.getByRole('alert').filter({ hasText: 'Please verify these dates.' }).waitFor();
        assert.equal(uploads.length, 1);
        uploadFailure = false;
        holdUpload = true;
        await page.getByRole('button', { name: 'Submit application', exact: true }).click();
        await until(() => held.length === 1, 'Upload timeout request was not held');
        await page.clock.fastForward(120_001);
        await page.getByRole('alert').filter({ hasText: 'The server took too long to confirm this action.' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Submit application', exact: true }).isEnabled(), true);
        assert.equal(await page.getByLabel('Reason for leave', { exact: true }).inputValue(), 'Verified official leave request.');
        await release(); holdUpload = false;
        await page.getByRole('button', { name: 'Submit application', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Submitted for reviewed approvals.' }).waitFor();
        assert.equal(uploads.length, 3);
        const requestId = body => body.match(/name="request_id"\r\n\r\n([^\r]+)/)[1];
        assert.equal(requestId(uploads[0]), requestId(uploads[1]));
        assert.equal(requestId(uploads[1]), requestId(uploads[2]));
        for (const width of [320, 390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.getByRole('button', { name: 'Open parent', exact: true }).click();
            await page.getByRole('button', { name: 'Open child', exact: true }).click();
            await page.getByRole('dialog', { name: 'Child action', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.getByRole('button', { name: 'Close both', exact: true }).click();
        }
        assert.deepEqual(errors, []);
        console.log('PASS: independent row actions, request deduplication, late-response protection, saved-action refresh failure/retry, download progress and retry, close during refresh, request deadline recovery, history retry, nested focus/Escape/scroll restoration, simultaneous confirmation settlement, action/assisted-submit duplicate prevention, retry identity and mobile layouts. All API calls synthetic.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
