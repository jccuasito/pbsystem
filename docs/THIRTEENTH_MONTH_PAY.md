# 13th-month pay

Open **Payroll > 13th-Month Pay** (`/dashboard?view=payroll-thirteenth-month`). The direct page is `/payroll/thirteenth-month`.

## Setup

Run `node --env-file=.env scripts/apply-thirteenth-month.mjs` on each database installation before using the module. The script takes a database backup, extends the existing `thirteenth_month_pay` table, and creates earnings imports, adjustment reviews, payment records and audit events. It seeds no employee amounts or payments. Re-running it is supported. Existing annual records without an employing agency stop the migration for review instead of guessing their owner.

The annual key is employee + employing agency + pay year. Moving between client sites under the same employer does not create a separate entitlement. A different employer has a separate record.

## Computation

1. Select the year and agency, then **Review earnings** for an employee.
2. Review the source cutoffs and monthly totals. Basic earnings come from the frozen regular-pay components of active finalized payroll postings, less their late, undertime and applicable break deductions. The regular payroll engine already decides whether an automatic break is chargeable. Gross/net payroll amounts, employee loans, contributions and refundable deposits are not used as the annual earnings base.
3. Regular-pay corrections from applied payroll adjustments follow their earned dates. OT, extension, ND, rest-day and holiday premium components are excluded by default. Manual amounts require an explicit inclusion/exclusion decision and earned date. An authorized encoder can record a verified basic adjustment for an integrated benefit or paid-leave/maternity salary differential missing from the regular source. These entries need supporting references; no policy exception is inferred from a label.
4. **Import Previous Earnings** accepts manual rows or the supplied Excel/CSV template, up to 100 rows for the selected employee and agency. Columns: `start`, `end`, `basic`, `reference`, `kind`. Dates must be ISO `YYYY-MM-DD`, within one month of the selected year, and actual rather than future earnings. `kind` is `Previous earnings` or `Basic adjustment`. Previous earnings cannot overlap finalized payroll or another active imported period. Basic adjustments can be signed corrections and do not fill missing coverage. A verified zero-earnings period is allowed with a reference and reason.
5. Review the employment coverage dates, eligibility confirmation and review note. Uncovered dates and source issues block approval. Changing coverage dates cannot hide recorded earnings outside that range. Basic earnings are summed in cents, divided by 12, and rounded once to centavos. Partial-year service retains divisor 12.
6. **Save draft**, then an Admin/Supervisor can **Approve computation**. Eligibility is explicitly reviewed: the system does not guess rank-and-file classification from a position title, or infer service solely from one paid cutoff.

Coverage checks establish that a cutoff or verified manual period has been reviewed; they do not infer that every calendar day was worked. Nonstandard finalized cutoffs spanning months need their source breakdown resolved before approval. Missing snapshots never fall back to gross or net salary.

## Release history

The statuses are Draft, Approved and Released. Released means the approved entitlement for the reviewed coverage has been paid; it is not a declaration that a partial-year record fulfills the entire year's obligation. Further payroll earnings make the saved source basis stale. Reopen, review and approve a new revision while retaining all earlier payments, then record only the remaining amount.

**Record previous payment** records verified historical advances. **Record payment** records an actual release against a current approved basis. Both require the actual payment date, a unique reference, reason, gross benefit amount, verified withholding and explicit payment confirmation. Payments can occur after the pay year, but cannot precede that year's January 1 or lie in the future. The system does not transfer money, deduct another loan/contribution, or calculate annual withholding tax. Gross benefit paid (including its withheld portion) reduces the remaining entitlement. Overpayments are shown for review, never automatically recovered.

Admin/Supervisor can void an erroneous/reversed payment record with a reason; this does not reverse a bank transaction. Removed imports and voided payments remain in history. Source hashes, record revisions, employee/DTR locks and transactions guard against stale edits, repeated releases and partial bulk imports. An export contains Annual summary, Earnings details and Payments sheets; printing uses an isolated A4 statement and the saved computation when present.

Financial links are restrictive. Permanent employee deletion with retained annual workflow records fails with a clear 409 message; employee deactivation remains available. No cascading deletion of the new benefit history is installed.

The cached dashboard workspace closes its teleported dialog and releases body scrolling on navigation, then reloads data when reactivated. Automatic refresh pauses while the employee dialog is open so it cannot overwrite an in-progress review.

## Calendar-year reconciliation

The release deadline can precede the final December payroll. This version supports reviewed actual earnings and documented previous payments, not automatic future-income estimates. Partial-year approvals and payments must be reconciled when further earnings become available. Do not treat missing earlier manual payroll as zero, or treat a payment against September coverage as full-year completion. The module does not submit DOLE compliance reports or perform BIR annual tax reconciliation.

Reference: [DOLE handbook, 13th-month pay chapter](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf). Company integration policies, exceptional benefits and annual filing instructions still need HR/accounting review.

## Verification

`THIRTEENTH_TEST_DATABASE=1 node --env-file=.env --test scripts/test-thirteenth-month.cjs` exercises the financial workflow using connection-local temporary tables only. It also produces a synthetic `.data/thirteenth-month-fixture.json` for `node scripts/test-thirteenth-month-ui.cjs`. The browser checks use that fixture rather than live financial mutations, including workbook downloads, import parsing, retries, keyboard focus, mobile layouts and nonblank printing. Set `CHROME_BIN` if Chrome is not installed at the default Windows path. Run the normal production build and regenerate `docs/CODE_MAP.md` after implementation changes.
