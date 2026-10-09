# Treasury divisions and approval levels

The live organisation can record Finance → Treasury → staff divisions. Existing Treasury records keep their IDs, service dates, appointment categories, balances, managers and history until an administrator explicitly changes a staff placement.

## Initial administration

1. Refresh the leave application and open **Settings → Organisation → Departments & divisions**.
2. Select **Finance**. Beside **Treasury**, select **Add division under Treasury**. Keep **Parent unit = Treasury**, enter **Financial Systems**, and save. Repeat for **Economic and Fiscal** and **Accounting**.
3. Open each employee's **Employee details → Verify placement**. Select **Department = Finance** and the appropriate **Treasury → [division]**. Save. This changes organisation placement; do not add a new service period to move a staff member between divisions. A routine placement records its action automatically and has only an optional setup note.
4. Open **Settings → Organisation → Leave approvers → Assign officeholder**. Select **Approval office = Divisional approver**, **Department scope = Finance**, and the staff division under Treasury. Nominate its actual officer and save. Repeat for each division that has staff. Nominees need an active verified login and leave approval permission; assigning an office does not grant permissions.
5. Open **Settings → Organisation → Approval route**, select **Finance**, and retain or configure **One level: division approver**. Each new common-leave application ends at the nominee for the employee's actual division.

If additional levels are wanted later, choose **Two levels: division → Treasury** or **Three levels: division → Treasury → HoD**. The middle office is **Treasury / parent unit approver**, scoped to Finance / Treasury. The final office is **Head of Department**, scoped to Finance. Nominate those offices only when the selected route needs them.

Temporary and permanent staff can share a division. Division placement does not change employment category or leave entitlement. The existing Temporary migration continues to activate Medical and Special only, retaining Annual records as history.

## Application history and activation

Creating divisions does not move staff automatically. Once Treasury has child divisions, staff need an actual child placement before a new Government consolidation or application can proceed. Applications submitted earlier retain their recorded route and division scope and can still be decided by their existing officeholders. Moving an employee who has a pending Government application requires reconciliation or cancellation and resubmission; their submitted placement is retained. Published route revisions affect new applications only.

Organisation setup alone does not activate Government leave for existing staff. After placement and nominations, refresh the consolidation preview and handle its remaining actual readiness items before applying the cohort. Creating divisions supplies no leave credits, calendar or medical history.

## Code recovery

The release archive contains a fresh production backup, the previous API image and frontend, a rollback script and row-hash verification. A code rollback retains the current production database and the added hierarchy column. Do not restore a development database over production. The available capabilities depend on which release is restored. Rolling back to code before optional calendar coverage restores its mandatory calendar checks; prefer forward recovery after staff have migrated without a calendar.

## Optional holiday calendar coverage

**Settings → Readiness** and **Settings → Policies → Holidays** share the checkbox **Require a published holiday calendar before using Government leave (optional)**. It starts unticked. Saving this administrator choice records the old and new setting automatically; no separate reason or second officer is required.

When unticked, missing calendar coverage does not prevent initial consolidation, activation or leave applications. Dates without a calendar use the verified work schedule. Entered calendars continue to exempt their recorded holidays for Annual/Recreation and Medical. The preview identifies when it is using the schedule without holiday coverage. No fictional holiday calendar or assumed holiday dates are created.

Tick the setting when you want missing calendar coverage to block activation and applications. Medical evidence, recorded balances, non-MC limits, self-approval checks and the nominated approval route continue to apply in either mode.
