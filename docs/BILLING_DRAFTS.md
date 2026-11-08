# Client billing

## Confirmed workflow

Billing uses **finalized payroll quantities**, organized as **agency > client**. Each agency/client pair has its own saved billing setup. The client chooses separate bills per site or a combined bill for selected sites. Multiple completed cutoffs can be selected for a monthly statement. Source selections must remain within one agency and client.

1. Finalize payroll in Payroll Processing. Merely computing a DTR does not make it billable.
2. Open **Billing > Generate Billing** and expand a client under its agency.
3. Open **Client billing setup**. Enable the agreed Regular, OT, Extension, ND, holiday/rest-day charges and time credits. Choose statement labels, hours/days/units, pricing and grouping by service, position or site. Set the agency/client's invoice scope and contract charges.
4. Select the finalized payroll sources and click **Review selected bill**. Review quantities, prices, client charges and the frozen payroll breakdown. Add or adjust invoice lines if required by the contract.
5. Save the draft. **Billing History** contains saved statements and their immutable revision snapshots. Print the draft from its review window.

The restored feature prepares billing drafts and printouts; it does not issue official invoice serials, send documents, collect payments or change employee payroll. An internal `BILL-DRAFT-####` reference is not an official invoice number.

## Quantities and contract prices

- The server reads `payroll_processing_review.SnapshotJson` only when the review is Approved and every employee still has an active Approved/Released payroll posting. No live attendance query or employee net-pay calculation supplies billing quantities.
- Regular, OT, ND and Extension are independent selectable components. Only enabled components become automatic invoice lines. Employee account deductions, loans, contribution collections, payroll allowances, and manual payroll amount adjustments are not copied to client billing.
- A linked price comes from the finalized snapshot employee's SiteRateID and its billing rate effective at that payroll source's cutoff end. A future version does not apply early. Missing linked prices block preparation; explicit fixed contract rates are available in client setup. Zero rates display review notes.
- The frozen payroll snapshot aggregates quantities by employee/component rather than retaining a dated billing-price breakdown. For contracts with rate/position changes inside one cutoff, review and split the invoice lines explicitly; the preview states this limitation. The feature does not pretend these are original daily billing-rate snapshots.
- For a day/unit rule, quantity is finalized component hours divided by the configured hours per unit. Linked hourly prices are multiplied by that divisor; fixed contract prices are per selected unit. Accumulation precedes quantity rounding. Different unit prices stay on separate invoice lines.
- Retirement/uniform quantities initially use regular-hour day equivalents based on the client's hours per billing day, not a count of calendar attendance dates. Quantities remain editable per bill.
- Administrative cost, VAT and withholding percentages and bases are explicit contract inputs. Defaults are zero. The program does not infer a client's tax treatment from the sample invoice.

## Persistence and safeguards

`billing_client_profile` holds agency/client settings with an optimistic revision. `billing_draft` links the existing billing header to its scope and snapshot. `billing_draft_source` uniquely reserves each source BatchID for one saved bill. `billing_draft_revision` preserves every saved version. `billing_detail` allows null EmployeeID and SiteID because aggregate client fees have no single employee/site owner.

Saving locks source DTR parents in ID order, sharing payroll finalization/cancellation's serialization point. The transaction validates active finalized postings, agency/client/site scope, exact revision and source hash, recalculates all amounts, updates header/details, and appends an immutable revision. Client totals/status are ignored. Duplicate source use and concurrent edits return 409. A saved bill's source set cannot be silently replaced.

Changing payroll finalization, linked prices or the client setup changes the source hash. Reopen/reload source values before saving. Saved lines and charge settings remain frozen until explicitly edited. If the payroll is cancelled or otherwise no longer valid, its saved draft remains available for reading/printing and cannot be saved. No automatic billing rewrite, official issuance or receivable posting occurs.

## Install and verify

Run `node --env-file=.env scripts/apply-billing-drafts.mjs`. The installer makes a full database backup, creates the four new tables, and makes the legitimate aggregate-line owner columns nullable. It creates no invoices and does not finalize payroll or seed financial records.

`BILLING_DRAFT_TEST_DATABASE=1 node --test scripts/test-billing-drafts.cjs` covers client component rules, effective prices, finalized quantities, scope, duplicate sources, revisions, rollback and cancelled payroll. Its MySQL writes use connection-local temporary tables only. `node scripts/test-billing-ui.cjs` exercises actual Vue components at desktop/mobile sizes with synthetic responses, including setup retry, switches, consolidated selection, draft edits, print behavior and history. Playwright/esbuild must be available through NODE_PATH; BILLING_BROWSER_PATH can choose Chromium.
