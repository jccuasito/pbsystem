# Returning employees: local development

Updated November 18, 2026. **LOCAL_ONLY**: this feature and schema were prepared in `pbsystem` only. The Namecheap deployment copy and live server were not changed. Any later release needs a reviewed counterpart patch and its schema prerequisite; opening both folders does not synchronize them.

## Rehire versus transfer

- **Rehire**: a previously Resigned employee returns after a confirmed resignation date, either to the same agency/position, another active position in that agency, or another active agency. Keep the same EmployeeID and employee number; do not create a duplicate person.
- **Agency transfer**: an Active employee moves agencies without a resignation/return gap. Continue using the existing Agency transfer workflow.
- **Position change**: an Active employee changes position in the same agency; continue using Change position / history.

## Employee List

1. Filter **Employment status > Resigned** and find the employee.
2. Select the clock/history action **Employment history / Rehire**. It is available on Active employees for history review as well.
3. Review the original hire date, latest return date, current agency/position and resignation date. A legacy Inactive record with no resignation date requires the actual previous resignation date; the system does not guess it.
4. Choose **Return agency**, **Return position**, **Return date** and a 5-500 character **Reason / reference**. The return must be after resignation and no later than today in Asia/Manila.
5. Select **Confirm rehire**. Employees Edit access and a non-Viewer staff role are required; Viewers can review the history but cannot submit a rehire. A stale/conflicting record is rejected and never automatically reposted.
6. The employee becomes Active with the selected agency-position. Assign the new site through Deployment History or the relevant DTR. Rehire does not reopen the previous site or enroll the employee automatically.

The Employee List distinguishes employment status from deployment status. Active/Resigned badges stay on one line; resignation dates, legacy Date not recorded and latest return dates are visible. Unassigned is neutral rather than an active-post indicator. A resigned employee is not shown as having a current site merely because an old deployment remains open. Filtering still applies to the complete loaded list and resets progressive rendering.

## History and dates

- `employee.DateHired` stays the original hire date; after a rehire, profile editing cannot overwrite it. `LastRehireDate` is the current period's return date. `ResignationDate` describes the current resignation and is cleared on rehire only after its previous value has been saved in history.
- `employee_rehire` stores the previous period start (nullable when genuinely unknown), confirmed resignation, return date, old/new agency-position, reason, actor and timestamp. Repeated resign/rehire cycles append records; they do not overwrite older returns. Historical agency/position names are joined from their retained master records, not immutable text snapshots.
- Prior deployment IDs, attendance, payroll, payslips, financial records and position-change records are retained. Old deployments that extend beyond the confirmed resignation are ended at that date. Existing ended deployments are left alone. The new employment period starts unassigned.
- Return is blocked if attendance/BTR after resignation, a later deployment, payroll or a DTR roster covering the return, or conflicting later position history requires review. Nothing is silently removed to make the return succeed. An existing roster spanning both old and new employment in one cutoff must be reviewed rather than overwritten.
- New DTR enrollment ending before the return is blocked. A return part-way through a new cutoff starts its new fixed/cutoff-only deployment on the return date. Dated attendance respects that deployment's range. Original deployments still identify valid earlier work; the gap is not converted into attendance.
- Daily Employee Status editing on a rehired employee is limited to the current return date onward. Earlier history is still readable. New profile position changes, deployment creation and transfers cannot be dated before the latest return.
- Rehire closes old employee-portal sessions so an old browser session cannot regain access automatically. The separate portal account status, password, documents and posted payslip ownership are not reset. An Inactive portal account still needs authorized review. Recheck site rates, payment details, loans/deductions and portal access before the next payroll.
- This feature does not calculate continuous-service benefits, reconcile final pay, forgive old loans, or automatically decide 13th-month eligibility/coverage. Those workflows still require their existing reviews.
- Retained rehire history restricts permanent employee deletion with a clear 409 message. Resignation remains available. No cascade deletes this employment ledger.

## Local schema

`database/employee-rehire.sql` adds nullable `employee.LastRehireDate` and the `employee_rehire` ledger with a unique employee/return-date key and restrictive owner/agency-position foreign keys. It seeds no events and does not reactivate or change existing employee dates.

`node scripts/apply-employee-rehire.mjs` is restricted to the loopback `pbsystem` database. It creates a verified private backup before adding a missing schema element; a second run is a no-op when ready. This script is deliberately not a hosting migration runner. A future hosting migration must be separately reviewed and authorized.

## Verification

- `EMPLOYEE_REHIRE_TEST_DATABASE=1 node --env-file=.env --test scripts/test-employee-rehire.cjs` runs real SQL against connection-local temporary shadow tables only. It checks same-agency and different-agency returns, repeated cycles, validation, stale forms, role restrictions, legacy dates, audit rollback, unchanged historical financial rows, portal-session closure, return-date DTR enrollment and conflict rejection.
- `node scripts/test-employee-rehire-ui.cjs` uses Playwright on `NODE_PATH` and the actual Vue list/modal with synthetic HTTP: status layout/filter, same/different agency options, failed-load retry, failed-save preservation, duplicate-submit prevention, success history, legacy dates, Viewer restrictions, dark mode and mobile widths. Screenshots are ignored in `.data/employee-rehire-tests`.
- Related resignation, profile position/history, DTR add-employee, employee status/list-loading and permanent-deletion tests cover the surrounding workflows. Backend fixtures use local temporary data; no real employee is rehired for validation.

Local schema application and a local build are not evidence of a live release. The deployment-copy backport and live migration/publication remain pending by the user's explicit scope.

## Verification record - November 18, 2026

- Applied only the local additive schema, after verified private backup `pbsystem-20261118-142138-7ff8cf67.sql`; the second installer run confirmed the repeat-safe no-op. No real employee was rehired by the implementation/testing work.
- 47/47 targeted tests passed with all four local SQL integration flags enabled: employee rehire, resignation, position changes, daily status, status sheet, list loading, DTR enrollment and permanent-deletion safeguards. Real SQL tests used connection-local temporary shadow tables. Next-day same-agency/same-site returns create a separate deployment instead of extending the adjacent old employment period. All conflict branches and audit rollback passed; original financial rows stayed equal.
- Actual Vue rehire/list and resignation browser fixtures both passed, including desktop/mobile, dark mode, one-line status badges, filters, legacy dates, retry/error behavior, single-submit protection and Viewer restrictions. Browser HTTP was synthetic; no real employee/account was modified.
- Curated helper tests: 15 passed; the unrelated optional aggregate-database test was not enabled. The existing resignation guide now explains how returning employees use Rehire in English and Filipino.
- Final local production build passed in 56.4 seconds. Generated `docs/CODE_MAP.md` and updated detailed API contracts; diff whitespace check passed.
- Status: LOCAL_ONLY. No deployment-copy patch, live SQL, SSH operation, live release, GitHub push or production functional acceptance was performed.
