# Leave setup and daily use

Open **Leave → Settings** to see the policy in use, employee access needing review and balance schedules. Treasury uses the current policy approval workflow. Earlier applications, certified opening records and PDFs are retained as history.

## Finish setup

1. **Policy & calendars:** reuse the current published policy, or prepare the authorised version with its effective dates. Maintain shared holidays and work schedules here.
2. **Employees:** find the existing employee or choose **Add employee**. Confirm their appointment, credited service, department and work schedule in **Details & appointment**. Creating a record does not grant balances or leave access.
3. **Organisation & approvers:** choose the approval levels and nominate the responsible people. The last nominated level grants leave; no employee can approve their own application.
4. **Employee → Leave setup:** review **Service & balances**, **Account access** and **Leave access & schedules**. Certify opening balances and complete the required access reviews before accepting applications. Temporary staff receive Medical and Special only; Contract staff explicitly recorded without leave entitlement remain outside leave activation. Existing certified credits above a new annual allowance carry forward; future renewals follow the current policy.
5. **Settings → Balance schedules:** select staff, confirm the saved fortnightly payroll cycle and review the schedules. If existing credits ended at the last recorded payroll, select **Continue accrual after the last credited payroll**. This records the payroll boundary separately from the administrative transfer date: the next full fortnight includes eligible service between payroll and transfer, at the agreed opening-policy rate, without backdating policy publication or applications. Continuity is limited to the reviewed first schedules after initial staff transfer and rechecks the latest recorded payroll credit. Save the reviewed schedules together. Existing schedules are retained. The server’s Government scheduler must be enabled for due postings; this is shown on the screen. Saving a schedule does not immediately credit a balance.

The active system administrator with central HR authority can complete routine policy replacement, activation and schedule reviews they prepared. Other central HR officers need a different configuration reviewer. Leave decisions, private evidence review and ordinary balance certifications retain their existing authority checks.

## Daily work

- **My Leave:** your current balances and account, an application form and application history. Choose dates, leave type and Medical certificate route when relevant. Review the date and balance check before submitting. Expand **Leave movements — in & out** for your credits and deductions, or **How leave is calculated** for the calculation basis.
- **Approvals:** requests awaiting the nominated approver. Earlier requests appear only while they still need a decision or have recent history.
- **Staff balances → View account:** search staff or department, compare available Recreation, Medical and Special days, then open an account for credits, deductions, pending holds and running balances. Central HR can see all active staff; officers with balance access see only their assigned scope. Missing certified balances show a dash rather than a policy default. Previous service-year balances are marked for renewal review; future openings are excluded from current availability.
- **Employees → Manage:** manage personnel details, policy and approvers. Officers with balance access see the same balance account in **Balances & policy**. **Leave setup** contains preparation and correction tools for central HR.
- **Overview:** activity and departmental planning, with a direct link to Staff balances.
- **Reports:** approved current-policy leave by period, with a CSV download.

The account reconciles **credits − deductions = balance**, then **balance − pending holds = available days**. The certified opening is included in credits. Each entry has its effective date, recording date, reason and source reference. Running balances follow recording order separately for each leave type and service year, including across pages. A backdated correction retains both dates. Pending requests hold days; final approval posts a deduction; rejection or cancellation releases the hold. Approved amendments return days through separate entries.

For the confirmed Treasury payroll boundary of **7 October 2026**, the next posting is **21 October**, covering **8–21 October**. The **9 October** administrative transfer does not remove 8 October from credited service. A full uncapped first fortnight credits **0.769230 Recreation days** under the 20-day annual policy; partial credited service remains prorated. Medical and Special renew on service anniversaries. Scheduled runs post only due dates and are idempotent; a prior fortnight is never credited twice.

Settings groups **HR access**, **Employee accounts**, **Payroll instructions** and **Applications & follow-ups** with the policy and balance schedule controls. Import and transfer tools are absent from normal navigation. The duplicate earlier balance editor and calculation settings have been removed. The earlier application submission endpoint rejects new requests, including from staff awaiting setup; historical reads, cancellations and decisions remain available. Advanced operational reviews and individual exceptions retain their authority checks.

For deployment, backups and the production cutover, use the [production deployment guide](GOVERNMENT-LEAVE-PRODUCTION-DEPLOYMENT-2026-10-08.md).
