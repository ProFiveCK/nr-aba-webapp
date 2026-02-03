# ABA Generator Business Process Guide

This guide documents how Treasury staff use the ABA Generator to prepare, submit, review, and archive batch payment files. It complements the detailed User and Reviewer manuals by describing the end-to-end business flow and the responsibilities for each role.

## Roles & Responsibilities
- **Level 1 User (Submitter)** – Prepares ABA batches, runs validation checks, and commits batches for review. Each submitter belongs to a department head (two-digit FMIS code).
- **Level 2 Reviewer** – Retrieves submitted batches, inspects the ABA payload, records stage decisions (`submitted → approved / rejected`), and can download the approved file.
- **Level 3 Administrator** – Manages reviewer accounts, blacklist entries, and oversees the full archive (approve/reject, delete, or reopen batches).

## Batch Lifecycle Overview
1. **Preparation** – A submitter configures the batch header, loads transactions, resolves validation warnings, and generates an ABA preview.
2. **Commit for Review** – The submitter supplies the PD reference, optional notes, and commits the ABA. The backend stamps a batch code and saves the payload.
3. **Review** – Reviewers retrieve the batch, inspect details, and either approve (unlocks download) or reject (sends it back for correction).
4. **Archive & Audit** – Every decision is recorded. Approved batches remain available for download; all batches (including rejected) stay in the archive for administrators.

## Submitter Workflow
### 1. Sign in & choose a header preset
- Submitters sign in via the landing page. The app automatically locks down admin/reviewer tabs unless the account has those roles.
- In the **Generator** tab, pick a header preset (e.g., `CBA-RON`, `CBA-Agent`). Presets load consistent FI, APCA, trace, and balancing account details so every batch uses the correct banking configuration.

### 2. Add transactions
- Use the grid to add credit transactions manually or import from CSV. The UI normalises BSB formatting, keeps amounts in cents, and enforces transaction code `53` (credit).
- Live validations highlight duplicates, missing lodgement references, or rows that match a **blocked account** entry (pulled from the blacklist managed in the Admin tab).
- Totals (credits/debits/net) update automatically so submitters can reconcile before committing.

### 3. Run generation checks
- When the submitter clicks **Generate ABA**, the app runs pre-flight checks:
  - refuses to proceed if any blocked accounts remain,
  - lists transactions missing lodgement references,
  - summarises duplicate groups and totals.
- If the batch passes, the app builds the ABA text, calculates a checksum, and opens the **Commit Batch for Review** modal.

### 4. Commit for review
- The submitter confirms:
  - **FMIS PD reference** – six digits only (the app stores it as `PD123456`).
  - **Department head** – auto-filled from the user profile; if absent, the user must enter the two-digit FMIS code.
  - Optional notes for reviewers.
- On submit, the frontend sends `/api/batches` the ABA content (Base64), PD#, metadata, and optional `root_batch_id` when resubmitting a previous batch. Successful commits:
  - show the batch code (e.g., `12-2024030101`),
  - offer the ABA file for immediate download,
  - refresh the **My Batches** list so the submitter can monitor status.

### 5. Resubmission path
- If a reviewer rejects a batch, the submitter opens the file in the **Reader** tab (via download or archive “Open” action), fixes issues, and commits a fresh version. Linking back to the original `root_batch_id` keeps history connected.

## Reviewer Workflow
### 1. Access the Reviewer tools
- Reviewers sign in via the Reviewer tab. The **Retrieve Batch** form accepts formatted or raw batch codes and normalises them automatically.
- The **Recent Batch Archives** table lists the most recent submissions (or more if the reviewer searches by code/PD#).

### 2. Inspect a submission
- Retrieving a batch displays:
  - Header metadata (department, PD#, preparer, submission notes).
  - Transaction table with duplicate flags and totals.
  - Decision history (previous approvals/rejections).

### 3. Record a decision
- Reviewers choose **Approve** (moves stage to `approved`), **Reject** (requires a comment), or leave an **Internal Note**.
- Approving unlocks ABA file download for reviewers and administrators. Rejecting notifies the submitter (email if configured) and resets the stage so the submitter can revise.

### 4. Archive access
- Reviewers can download approved ABAs directly from the archive. Non-approved batches remain read-only; delete controls are hidden for reviewers.

## Administrator Oversight
- Admins inherit all reviewer capabilities plus:
  - **User Accounts** – create users/reviewers/admins, manage department codes, toggle submission notifications, and reset passwords.
  - **Blacklist** – add/remove blocked BSB/account pairs used by the generator validation layer.
  - **Archives** – view either the recent set or the full archive (toggle in the UI). Admins can approve/reject, revert, or delete batches directly from the archive table.
  - **Signup Requests & SaaS Sync** – handle onboarding requests and monitor file sync status if deployed.

## Data Retention & Audit Trail
- Every batch stores:
  - Submission metadata (PD#, department head, prepared by, notes, checksum).
  - Stage history (submitted/approved/rejected) with reviewer identity and timestamps.
  - Optional linkage to the original submission (`root_batch_id`) for resubmissions.
- The archive tables surface this history, and the backend retains records until an administrator explicitly deletes them.

## Related Documents
- [User Manual](./User.md) – step-by-step instructions for Level 1 submitters.
- [Reviewer Manual](./Reviewer.md) – detailed guide for decisions and downloads.
- [Flow Diagrams](./Flows.md) – visual swimlanes of the generator/reviewer process.
