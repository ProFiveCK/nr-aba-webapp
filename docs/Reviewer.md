# Reviewer Manual

## Overview
Use the Reviewer tab to find batches, open them in Reader (to view the actual ABA), check validations and duplicates, see the matched bank account preset, and record a decision. Approved batches can be downloaded.

## Archives & retrieve
- Archives list: Shows all batches; includes search and refresh.
- Actions per batch:
  - Open → loads Reviewer view for that code
  - Copy → copies batch code
  - Download → available once approved (downloads ABA)
- Retrieve form accepts several code formats (with or without separators).

## Summary panel
Shows:
- Code, Stage, PD Reference, Department
- Prepared by, Submitted by, Created time
- Transactions count, Total credits
- Duplicate sets (from submitter’s metrics)
- Bank account preset (e.g., CBA-RON)
- Account (BSB and account for the balancing debit)
  - Derived from payload header when available
  - Otherwise from the approved file (decoded and parsed)

## Open in Reader
- Displays the actual ABA content:
  - Header: FI, User, APCA, Description, Processing Date, Reel
  - Bank account preset
  - Account (BSB and account used for balancing debit)
  - Control totals (Net, Credits, Debits, Record Count)
  - Transactions table with duplicate highlighting ("dup" badge and row highlight)
- Integrity check: warns if sum of credit entries doesn’t match control credits.
- Optional: "Load into Generator" to recreate/edit just the credits (headers unchanged).

## Decisions
- Record decision:
  - Note only (no stage change)
  - Approve (if allowed)
  - Reject (requires comments)
- Approval enables the Download action and preserves the approved file.
- Rejection may notify submitter (email) depending on settings; admins can do a silent revert.

## Reviewer workflow (step-by-step)
This section explains the typical tasks a Reviewer performs and the exact steps to follow when handling a batch.

1. Access reviewer tools
  - Sign in and open the **Reviewer** tab. Only accounts with the `reviewer` or `admin` role see this tab.
  - Use the **Retrieve Batch** form to look up a batch by code or PD#. Recent archives and quick-search are available on the same panel.

2. Retrieve and triage
  - Open the batch in the Reviewer view (or the Reader) to load header, control totals and transactions.
  - Check the summary panel first: PD#, department, prepared/submitted by, totals, duplicate groups and preset detection.
  - Quick triage checklist:
    - Is the bank preset detected and does the balancing account match the expected preset?
    - Do control totals (Net, Credits, Debits) balance?
    - Are there blocked accounts flagged? Any missing lodgement refs?
    - Are duplicate groups expected (e.g., repeated payroll payments) or suspicious?

3. Inspect the ABA file
  - Use the **Reader** to view the actual Type 0/1/7 file payload.
  - Expand duplicate groups and inspect individual transactions if needed. The UI highlights duplicates with a `dup` badge.
  - If needed, use **Load into Generator** to reconstruct only the credits (for deep inspection or to test a fix locally). Note: loading into Generator creates a local draft and does not change the archived batch.

4. Make a decision
  - Note Only: leave an internal comment for audit purposes.
  - Approve: select Approve and optionally add reviewer notes. Approval moves the stage to `approved` and unlocks the ABA for download.
  - Reject: select Reject and provide mandatory reviewer comments explaining why. Rejecting returns the batch to the submitter for correction (and may trigger an email notification depending on configuration).

5. Post-decision actions
  - On Approval: the approved file is persisted; you may download the ABA for delivery or record-keeping.
  - On Rejection: include actionable comments (line numbers or transaction identifiers) so the submitter can correct and resubmit. Reviewer comments are stored in the stage history.

6. Exceptional flows
  - PD collision: If you suspect a PD has been re-used incorrectly or there is ambiguity, do not approve. Contact an administrator (include both batch codes and context). Admins can investigate and, if appropriate, allow a PD to be reused.
  - Malformed file or missing balancing debit: reject with detailed notes asking the submitter to regenerate using the Generator.
  - Urgent approvals: if an urgent payment must be approved outside normal process, record explicit reviewer notes and notify an admin. Administrators can also override in exceptional circumstances.

## Reviewer responsibilities & permissions
- Reviewers (Level 2) can retrieve, inspect, approve, or reject batches. They cannot create reviewers, manage blacklists, or delete archives.
- Administrators (Level 3) have full access: manage reviewer accounts, update blacklist entries, and delete or reopen archived batches.
- Session & security: reviewer sessions are configured by environment variables (see `REVIEWER_SESSION_MINUTES` in backend `.env`) and temporary password policies.

## Audit trail & notifications
- Every reviewer action (approve, reject, note) is recorded with reviewer id, timestamp and comments in the stage history.
- Rejections may trigger an email to the submitter with reviewer comments (configurable). Approvals may trigger internal notifications as required.
- When in doubt, add an internal note rather than immediately approving — notes are preserved for auditors.


## Tips
- Use Copy in archives to quickly share the batch code.
- If the preset doesn’t show in summary, open in Reader; it will detect from the file.
- Need to verify or rebuild credits? Use "Load into Generator" from Reader.

## Troubleshooting
- Can’t open Reader → Ensure you are logged in as a reviewer.
- Download disabled → Batch must be approved.
- No preset shown anywhere → File may be malformed or missing balancing debit; contact the submitter to regenerate.

## Support
For assistance, email Treasury support: fmis@finance.gov.nr
