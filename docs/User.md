# Submitter (User) Manual

## Overview
Use the Generator to build an ABA file from a list of credit transactions. The app enforces key validations (blocked accounts, missing lodgement references, duplicate detection) and automatically adds the balancing debit to the correct preset bank account.

- Panels: Generator, Reader (to inspect files), Reviewer (restricted), Admin (restricted), CSV→BAI2 (optional access)
- ABA output format: 120-character records with CRLF line endings; Types 0, 1, and 7

## Quick start
1. Choose a preset (e.g., CBA-RON, CBA-Tank Farm) or fill header fields.
2. Add credit transactions: BSB, Account, Amount, Account Title, Lodgement Ref (Txn Code stays 53 for credits).
3. Fix any issues shown in warnings (blocked accounts, missing lodgement ref) and resolve duplicates as needed.
4. Click "Generate ABA File". Complete submission details (PD number, your name, notes).
 
## Generate ABA File — detailed
When you click "Generate ABA File" the app runs a final set of validations and opens a helper (submission) modal that guides you through the last checks before the file is created and stored.

What the helper does:
- Summarises totals: shows the net total, total credits, number of transactions, and the balancing debit that will be added.
- Duplicate summary: shows potential duplicate groups (same BSB, account, amount, lodgement ref) so you can confirm these are intended or fix them.
- Validation checks: verifies there are no blocked BSB/account combinations, no missing lodgement references, and that amounts and account formats are valid.
- PD uniqueness check: the PD# you enter is validated against submitted batches. If the PD has already been used in a previously submitted batch, the helper will show an error and prevent submission. You must choose a unique PD (or contact an administrator if the PD should be reused for a special case).

Submission behaviour:
- Preview: you can preview the generated ABA file in a read-only view to confirm records and totals.
- Confirm: after reviewing, click Confirm/Submit to store the batch. The system will create the Type 0/1/7 file, persist the batch metadata, and record the submitting user.
- Blocking errors: if any blocking validation fails (blocked account, missing lodgement ref, duplicate PD), submission is prevented and you will see actionable messages in the helper modal explaining what to fix.
- Non-blocking warnings: cosmetic warnings (for example, unusual but permitted account titles) are shown but do not block submission.

If submission fails for any reason (server error, timeouts, or validation race conditions), an error message is shown and the batch remains as a Draft so you can correct and retry.

Tips:
- Choose PD numbers carefully — the system prevents accidental reuse to maintain auditability.
- Use the Preview to open the ABA and scan control totals before confirming.
- If you believe a PD is reserved or was used in error, contact Treasury support and include the batch code or PD# so the admin team can investigate.
5. Submit. The batch is stored for reviewers; you receive a batch code.
6. **Email notifications:**
   - You will receive an email if your batch is rejected by a reviewer (with comments/reason).
   - You may receive an email if your batch is approved (if enabled by admin/reviewer).
   - You will receive an email for password reset requests.

## Header
- Presets autofill: FI, trace account, balancing account (code 13), etc.
- Required: User Name, APCA (6 digits), Remitter Name.
- Processing Date: defaults to today (DDMMYY), editable if needed.
- Balancing debit (code 13) is enforced to the preset’s balancing account.

## Transactions
- Add/edit inline or import CSV.
- Required fields per row:
  - BSB (NNN-NNN) — auto-formatted
  - Account (5–9 digits)
  - Amount (> 0)
  - Lodgement Ref (non-empty)
  - Txn Code: 53 (auto)
- Real-time helpers:
  - Blocked Accounts panel: lists disallowed BSB/Account combos. You must remove/correct them.
  - Missing Lodgement References panel: lists rows missing Lodgement Ref.
  - Duplicate summary: groups potential duplicates (same BSB, Account, Amount, Lodgement Ref).

## Validations before submit
- Blocked account detected → an error modal appears (you must fix before continuing).
- Missing lodgement references → a modal lists rows to fix.
- If all good → a submission modal captures PD number, preparer, notes; you’ll see a duplicate summary metric.

## After submit
- File is built with Type 0 header, Type 1 credits, a balancing debit (code 13), and Type 7 control.
- Batch is stored with your metadata and visible to reviewers.
- **Email notifications:**
  - If your batch is rejected, you will receive an email with the reason and any reviewer comments.
  - If your batch is approved, you may receive an email notification (if enabled).
  - For password resets, you will receive an email with a reset link.

## My Batches
The "My Batches" tab shows batches you created (drafts, submitted, rejected or approved). Use this view to find, manage and review your own submissions.

What you see:
- Code: unique batch code assigned on submission.
- Stage: current lifecycle stage (Draft, Submitted, Rejected, Approved).
- PD#: procurement/processing number recorded at submission.
- Department: the department associated with the batch.
- Created / Updated: timestamps for quick auditing.

Actions you can perform:
- Search: type a batch code or PD# in the search box and press Enter or click Refresh.
- Refresh: reload the list from the server to see the latest status.
- Open/View: click the batch code or the View action to open full details in the Reader or a side-panel.
- Load into Generator: for Drafts or Rejected batches you can load the batch back into the Generator to make edits and re-submit.
- Delete Draft: remove draft batches you no longer need. Submitted batches cannot be deleted from this view.

Behavior notes:
- Draft batches are editable — you can modify transactions, header details, and then re-submit.
- Submitted batches are read-only in the Generator; reviewers will see the same read-only view.
- Rejected batches include reviewer comments; you can load them into the Generator to create a revision and submit again.
- All actions (submit, edit, delete, approve, reject) are audited — the system records who performed the action and when.

See also: the Reviewer manual for reviewer-specific actions (downloads, approve/reject workflow).

## Reader (optional)
- Use Reader to open an ABA file and inspect: header, control totals, transactions, and duplicates.
- You can "Load into Generator" from Reader to recreate/edit (only credits are loaded; headers remain unchanged).

## CSV to BAI2 (optional)
- Upload a statement CSV with expected columns.
- Configure sender/receiver IDs, account number, currency, and transaction codes.
- Generate and download the .bai file.

## Password & access
- "Forgot password" on login sends a reset link to your email.
- You may be prompted to change your password on first login.

## Troubleshooting
- Generate does nothing → Check top-of-page warnings and fix blocked/missing fields.
- BSB field jumps or loses focus → Behavior fixed; tabbing works smoothly.
- Department required → Ensure department code is set in the submission modal if not prefilled by your account.

## Support
For assistance, email Treasury support: fmis@finance.gov.nr
