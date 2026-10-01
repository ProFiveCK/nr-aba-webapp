import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { generateLeaveApplicationPdf } from './leaveApplicationPdf.js';

const form = {
  id: 'leave-001', employee_name: 'Ana Example', department_code: 'TRE',
  leave_type_name: 'Annual', start_date: '2026-10-12', end_date: '2026-10-16',
  days: 5, reason: 'Family responsibilities', approved_by_name: 'Treasury Approver',
  approved_at: '2026-10-01', approval_snapshot_available: true,
  balances: [{ leave_type_name: 'Annual', before: 18, after: 13 }],
};

test('approved leave uses the supplied one-page A4 form', async () => {
  const pdf = await PDFDocument.load(await generateLeaveApplicationPdf(form));
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 595, height: 842 });
  assert.match(pdf.getTitle(), /Ana Example/);
});

test('a long explanation is retained on a continuation page', async () => {
  const pdf = await PDFDocument.load(await generateLeaveApplicationPdf({
    ...form, reason: 'Family responsibilities and travel arrangements. '.repeat(35),
  }));
  assert.equal(pdf.getPageCount(), 2);
});

test('line breaks in an explanation continue onto further pages', async () => {
  const pdf = await PDFDocument.load(await generateLeaveApplicationPdf({
    ...form, reason: Array.from({ length: 60 }, (_, index) => `Reason line ${index + 1}`).join('\n'),
  }));
  assert.equal(pdf.getPageCount(), 3);
});

test('older approvals and unlisted leave types remain printable', async () => {
  const pdf = await PDFDocument.load(await generateLeaveApplicationPdf({
    ...form, employee_name: 'Jos\u00e9 Example', reason: null, leave_type_name: 'Compassionate',
    approval_snapshot_available: false, balances: null,
  }));
  assert.equal(pdf.getPageCount(), 1);
});
