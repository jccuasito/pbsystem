# Running and deploying pbsystem

Prepared November 14, 2026 for an initial target of 30–50 office users. Actual capacity depends on the machine, database size, workload and hosting quotas. A local read test is not a shared-hosting capacity guarantee.

## Controls in the application

- MySQL uses 10 connections per process by default, a finite queue of 200, a 10-second connection handshake timeout and a 5-second acquisition timeout. A connection arriving after acquisition timeout is released, not leaked. Idle connections expire after 60 seconds. Pool/database outages produce a temporary 503 where recognized. There is no automatic retry after a network error or uncertain commit. Payroll review alone retries at most twice after a confirmed InnoDB deadlock and rollback; each attempt reacquires business locks and rechecks eligibility.
- A Node process admits at most 128 API requests at once. At most 2 simultaneous DTR/payroll/billing/backup mutations or unpaged payroll previews run by default; excess receives 503 and `Retry-After: 3` before auth/body/database work. Capacity is released after the handler finishes or unwinds through Nitro request-error rendering, including errors, not immediately when a browser disconnects. These are per-process safeguards, not a distributed job queue or a WAF.
- Simultaneous identical dashboard and selected directory reads share the same in-flight query result after each caller is authenticated/authorized. Settled responses and failures are not cached, so a later refresh still reads current data. Payroll progress coalesces separately for each cutoff. Staff sessions/permissions are never shared by this mechanism.
- Automatic page refresh defaults to 10 seconds with jitter, skips hidden/offline tabs, avoids overlap, and backs off when its callback rejects. Existing callbacks that catch errors internally cannot signal failure to the composable. Manual buttons remain available.
- Request diagnostics log slow API method/path/duration without query strings, payloads, cookies or SQL values. Public health responses contain no database identity or exception details. Existing transaction locks, duplicate checks, financial review snapshots and parameterized SQL remain.

Settings are documented in `.env.example`. Increasing the pool blindly can exhaust a shared MySQL quota: **all application processes × DB_POOL_SIZE**, plus backup/maintenance/other applications, must fit the account's limit. Start with one Node process and measure. A queue or concurrency rejection means wait and retry; a network failure after a payroll action means inspect the saved status before resubmitting.

## Database indexes and backups

Before enabling notification bells on a new/restored deployment database, run `node --env-file=.env scripts/apply-notifications.mjs` from the app root. It makes a verified SQL backup before adding missing per-user notification receipt tables and does not change payroll/attendance records. The API does not create tables automatically. See [NOTIFICATIONS.md](NOTIFICATIONS.md) for alert eligibility, read-state behavior and scheduled-backup monitoring limits.

Preview missing indexes with:

```powershell
node --env-file=.env scripts/apply-performance-indexes.mjs
```

During a maintenance window, add them with `--apply`. The script creates a SQL backup first, skips equivalent existing leading-column indexes and uses online secondary-index creation with a short metadata-lock wait. It never changes payroll/attendance amounts. SQL engines/permissions that cannot honor `LOCK=NONE` must be reviewed rather than silently falling back to a blocking table copy. Back up before every future migration as well.

SQL backup does **not** include private files. Back up `.data/profile-images`, government-ID attachments, archived payslips and any other configured private directories separately. Retain a copy off the application machine/account and periodically test a restore into a separate database. Never test restore against working payroll data.

The in-process backup timer cannot run while a PC is off or a hosting process is sleeping. For local Windows unattended backups use the existing `scripts/install-daily-backup-task.ps1`; on cPanel schedule `node --env-file=/home/USER/pbsystem/.env /home/USER/pbsystem/scripts/backup-database.mjs` in Cron Jobs using the actual selected Node executable. Keep the working directory/environment and `MYSQLDUMP_BIN` correct. A Linux host cannot use the Windows XAMPP binary paths.

## Local office production mode

Use `npm run dev` for development. For office service use a production build:

```powershell
npm run build
npm start
```

`npm start` loads the private `.env` and uses the production startup wrapper, which sets production mode and DEBUG=false. `deployment/ecosystem.config.cjs` is an optional single-process PM2 configuration with restart backoff, a memory threshold and graceful shutdown time. If PM2 is installed, start it with `pm2 start deployment/ecosystem.config.cjs`; configure OS startup separately. This file alone does not install a service or guarantee restart after Windows reboot. Do not run another app on the same port. Configure a dedicated MySQL user and actual backup paths.

The supervisor defaults to loopback. Before authorized LAN use, configure the listening interface and set `APP_URL` to the single URL all users will open. Keep the office server awake and provide reliable power/network. `localhost` on another employee's laptop refers to their laptop, not the server PC.

## Namecheap cPanel preparation

1. Confirm **Setup Node.js App** on the account, exact Node patch version, memory/CPU/process/MySQL quotas, SSH/build access, and outbound email availability. Current dependencies require an updated LTS satisfying all engines (Node 22.22.3+ or 24.15+). Do not assume a provider's generic “22.x”/“24.x” label proves the required patch is available. The development runtime's older patch may build successfully while still showing engine warnings.
2. Keep the app root outside `public_html`, e.g. `/home/USER/pbsystem`, with private storage outside all web document roots. Upload source/lockfile; install dependencies and run `npm run build` **on Linux**. Do not copy Windows `node_modules` or Windows-built `.output` with native bcrypt bindings to Linux. If building on shared hosting exceeds limits, build on a matching Linux environment and verify native dependencies there.
3. Create the app in Production mode. Startup file: `deployment/namecheap/app.js`, relative to the app root. That folder has a CommonJS package marker; the wrapper imports the built Nitro ES module. If the UI requires a root-level `app.js`, copy this wrapper to the root and adjust its `root` to `__dirname`, and use a root CommonJS deployment package after building. Do not accidentally change source package type before a build. Configure the environment in cPanel rather than relying on the wrapper to load `.env`.
4. Set the real HTTPS `APP_URL`, database credentials, a private JWT secret, Google callback credentials/authorized domains if used, SMTP settings and persistent absolute private-file/backup paths. Import the schema/data and run applicable reviewed migrations. Before serving employee pages or resignation summaries, run `node --env-file=.env scripts/apply-employee-resignation.mjs`. It creates a verified SQL backup before adding nullable `employee.ResignationDate`, skips an existing column, and never backfills legacy Inactive dates or changes employee statuses. Keep the backup private. Transfer private images/documents separately. Never expose `.env`, backups, private files or source maps through the web server. All `/uploads/...` image URLs must reach authenticated Node handlers, not stale static copies.
5. Run `node scripts/deployment-preflight.mjs` inside the app environment, or `npm run preflight` when a private `.env` is used. It checks runtime/environment/build-platform prerequisites without printing secrets. Build metadata is written by `npm run build`. This is not a substitute for a live smoke test.
6. Use cPanel Start/Restart and Passenger lifecycle management; do not start PM2 alongside Passenger on a shared account. Check `/health/live`, `/health/ready`, staff login, employee login, authorized images, an export and printing using synthetic demo data. Test a backup and a separate restore. Recheck OAuth, secure cookies and cross-origin behavior through the actual HTTPS URL.
7. The existing local Windows OCR integration requires PowerShell/Windows OCR and is not portable to Namecheap Linux. Government-ID uploads/manual entry can still be used; confirm the OCR workflow before demonstrating that feature. This preparation does not claim that provider-specific capabilities have already been tested.

Namecheap supports Node apps but shared accounts have resource limits. If CPU/IO/memory limits or required software prevent the target workload, use a VPS/managed Node service rather than increasing connection/process counts blindly. No hosting purchase, domain change, public deployment or persistent OS service was performed by these changes.

## Monitoring and controlled checks

- `GET /health/live`: process is responding, no database query. Use it for liveness; do not restart a healthy application solely because MySQL is briefly busy.
- `GET /health/ready`: one coalesced database probe cached for 2 seconds; 200 `{status:'ok'}` or 503 `{status:'unavailable'}`. Use it for dependency readiness/alerts. It does not prove every table/migration is correct.
- `GET /api/settings/health`: authenticated Admin only; returns database readiness, uptime, memory and per-process request/pool counters. It reveals no credentials, query strings or session tokens.
- Collect process logs and configure external uptime/error alerts on hosting. Log rotation/retention and OS/database supervision must be configured by the operator. A second server/failover is needed if downtime during host/power failure is unacceptable.

```powershell
node --test scripts/test-reliability.cjs
# Supply an existing active staff cookie through LOAD_TEST_COOKIE; never commit it.
node scripts/load-test-readonly.mjs --url=http://127.0.0.1:3106 --users=50 --rounds=2
```

The load script accepts loopback destinations only, executes GETs only, bounds concurrency/duration, and reports status counts/latency without printing tokens or employee data. It simulates read clients using an authorized session; separately test concurrent imports, edits and finalization on an isolated staging database with realistic volume before production rollout. Do not stress-test real payroll writes or a shared hosting account without coordination.

References: [MySQL2 connection pools](https://sidorares.github.io/node-mysql2/docs#using-connection-pools), [Namecheap Node.js App](https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/), [Namecheap server software versions](https://www.namecheap.com/support/knowledgebase/article.aspx/129/22/what-version-of-the-software-is-used-on-your-servers/), [cPanel Node.js installation](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/).

## Local verification on November 14, 2026

The production build and cPanel-compatible startup wrapper passed local startup checks. A loopback run with 50 concurrent dashboard read clients completed 400/400 requests with HTTP 200 (p50 179 ms, p95 265 ms, max 305 ms on this PC). Another 100 anonymous error responses did not leak capacity. After load, the pool reported zero active/acquiring leases and zero acquisition timeouts; the Admin health request itself was the only active API request. This uses an existing Admin session and current local data, not 50 distinct production accounts or concurrent payroll writes.

The regression run passed 260 checks with 30 optional checks skipped; a separate synthetic temporary-table integration run passed all 20 checks. Seven performance indexes were added locally after a SQL backup; re-running the preview reported zero missing indexes. No financial values were migrated.

The deployment preflight currently flags the local Node 24.13 runtime as below dependency engine requirements and the local blank database password. Upgrade to a supported qualifying Node patch and use a dedicated database account with a strong password before public deployment. No global runtime or database credentials were changed automatically. The Namecheap account/runtime/quotas and Linux-specific optional features still require the operator verification above.


## Local list performance checks (November 22, 2026)

Organization, Site Rate, Rate group/position and DTR directories now use server pages of 25, full-dataset server search and a 30-second single-page polling interval. The rate overview contains aggregate groups, not all position records. Appending pages omits repeated lookup metadata; form choices remain complete and are loaded on demand where full rate values are needed. APIs without a `page` parameter remain compatible with existing complete lookup/export consumers. Do not replace financial report sources with a directory's loaded rows.

Use `node --env-file=.env --test scripts/test-server-list-pagination.cjs` for read-only integration checks and `node --env-file=.env scripts/profile-list-queries.mjs` for actual SQL plans. Both refuse a non-loopback database. On the current small local dataset (9 Sites, 7 Clients, 13 Site Rates, 8 Payroll Rates, 7 Billing Rates, 4 DTR batches), paged reads without lookup metadata took approximately 3?30 ms per directory in one diagnostic run. This is a small-data development measurement, not a capacity promise. EXPLAIN confirmed existing join/roster/version indexes are available. Small-table scans/filesorts are expected here; no additional index was justified or applied from this dataset. Re-evaluate real filters and high-volume staging data before changing indexes; the existing performance-index migration remains available separately.

For a controlled loopback production-build load run, set `DB_AUTO_BACKUP=false` and `LEGAL_HOLIDAY_AUTO_SEED=false` in that child process to disable startup maintenance writes. Keep normal development/deployment defaults enabled. Run `scripts/load-test-readonly.mjs --suite=lists --users=50 --rounds=2 --health=true` against the local app with an authorized Admin cookie supplied privately in `LOAD_TEST_COOKIE`. The script prints per-route and overall latency/status counters, not tokens or record bodies. The health endpoint also exposes CPU/event-loop/heap usage and bounded request/query metrics. Do not commit session cookies or local diagnostic outputs.

Heavy import/compute concurrency and the 1,000-row import cap remain in force. A busy request receives a retryable error; lowering hosting limits or adding workers is a separate measured tuning decision. Durable queued imports need persisted job ownership/progress/retry and transaction semantics before implementation. These read-only tests do not validate concurrent financial writes, long-running jobs, hosting quotas, external uptime alerts or host failure recovery.


The November 22 local HTTP run used the production build, 50 concurrent read clients, and two rounds over six directory endpoints (including initial lookup metadata in the first round). All 600 requests returned HTTP 200; p95 was 222 ms and maximum 239 ms. Pool acquisition timeouts/failures and rejected requests remained zero, and active/acquiring connections returned to zero. RSS rose from 67 MB before warm-up to 160 MB after this run; that short sample does not establish long-term memory stability. Startup backup/holiday maintenance was disabled for the temporary test process, and no financial writes, schema migrations or live-server requests were performed. The process was stopped after verification. The browser suite separately uses 60 synthetic rows/groups to exercise append/retry/search beyond the first page, including mobile fallback and stale-request cancellation.


## Synthetic scale verification (November 22, 2026)

The previously interrupted run has now completed its final verification. Source changes remain uncommitted and local; no live server deployment or original payroll-data write was performed. The fresh verification database is `pbsystem_scale_20261121184027_94eb`. Raw per-phase JSON, the synthetic workbook, and [machine-readable summary](../.data/scale-tests/pbsystem_scale_20261121184027_94eb/summary.json) remain under `.data/scale-tests/` (ignored local evidence, not deployed files). Older failed diagnostic runs are retained separately and are not counted as successful final results.

### Fixture and isolation

The fixture clones schema only, including foreign keys, views and the existing trigger, then seeds synthetic records: 6,000 employees, 10 agencies, 500 sites, 150 clients, 1,500 site rates, and 180,000 normalized attendance rows across 1,000 site DTRs / two September cutoffs. It includes 2,000 loans (200 paused), 1,500 installment deductions, 1,200 recurring plans, agency-position contributions, effective-dated rates, flat allowances, OT, night differential, rest days, absence/leave, late and undertime. Boundary tests subsequently add 29 attendance rows and separate test DTRs.

Each phase starts a separate production-build Node process on `127.0.0.1:3196`, with a random short-lived app account granted DML only on the generated database, and verifies access to the original schema is denied. A schema marker and exact generated database-name check prevent accidentally selecting the ordinary database. Startup backups/holiday seeding and SMTP are disabled only in that child. Test private storage is isolated. The app process stops and its temporary database account is removed after each phase; final checks found no leftover temporary account or port-3196 listener. Synthetic databases are retained for inspection. `.env` is not changed by the harness.

### Results

| Check | Final local result |
| --- | --- |
| Payroll compute/finalize | All 1,000 site DTRs processed; 12,000 Approved employee-cutoff payrolls match independent integer-cent calculations. All 3,500 declining loan/installment balances checked for both cutoffs. |
| Duplicate and cancellation safety | Cancellation restores balances; recompute/refinalize succeeds; concurrent same-DTR finalization cannot double-charge. All Approved payrolls reconcile to detail/deduction lines; exactly 6,600 Posted account receipts. |
| Billing | All 500 sites included in 250 finalized agency/client invoices; totals checked independently, including concurrent new client-profile creation. |
| Payslips | 12,000 posted cutoff payslips; own-employee access, partial posting, stale review token and exact source-set checks pass, including an extra legacy source. |
| Paging correctness | First/last payroll pages equal full calculation; Employee List searches unloaded employee IDs; agency/position filters and per-caller permissions pass. An employee moved between two sites receives one allowance and one set of installments/contributions across page boundaries. |
| Biometric import | A generated seven-row XLSX roundtrip exercises late, undertime, missing punch, no punches, missing shift and unmatched employee. Oversized 1,001-row request returns 400; incomplete payroll compute returns 409. |
| Annual preview | All 6,000 basic-earnings and configured 13th-month previews match independent cent calculations; no annual payment released. |
| Ramp reads | 1,820 workload requests across 10 routes at 1/5/10/25/50 concurrent clients, all HTTP 200; 1,828 including auth/health probes. At 50 clients: p95 537.9 ms, max 650.2 ms; end-of-ramp app RSS 309 MB. |
| Mixed reads/writes | 20 readers plus 2 billing writers; 360 directory reads and 40 billing reopen/finalize writes, all successful. All invoices remain Finalized and loan balances are unchanged. |
| Capacity protection | Two intentionally blocked financial operations occupy the heavy slots; a third gets expected 503 while a directory read succeeds. After releasing the locks, duplicate guards return 409 and heavy capacity recovers to zero. |
| Sustained read run | 60 seconds / 10 read clients: 2,038 requests including probes, all HTTP 200; p95 515.2 ms, max 771.8 ms. Final app RSS 142 MB / heap 55 MB. |
| Build and regression | Production build succeeds. 74 regression tests pass, 6 optional database tests skipped, 0 failed. Three actual Chromium suites pass (employee rehire/resignation and paged Payroll Processing, including mobile checks). |

The final 10 phases contain 8,342 HTTP requests in total, including deliberate 400/401/403/409/503 rejection tests. Every phase finishes without database acquisition timeouts/failures or outstanding pool leases. Health samples count their own request as active; that is not a leak.

### Changes supported by these measurements

Employee List and Payroll Processing now request server batches instead of full financial/employee arrays. Search/filters cover unloaded data. Payroll calculation limits metadata to the selected cutoff and relevant shared-employee sites; finalization no longer recalculates 500 unrelated sites for each site. Pending identical financial-directory reads share work, while permission flags remain per caller and settled data is never cached. Payslip directory queries select page groups before exact-source checks, avoiding the reproduced large repeated grouping query. Billing directory reads extract only a source label rather than all invoice snapshots. Confirmed absent-child gap-lock contention in billing/payslip creation was removed using existing parent ownership locks; financial writes retain transactions, revision/source-hash checks, and duplicate guards. Billing line string keys are accepted only in the exact draft route's direct lines array. No scale-test schema migration or index change was required.

### Reproduce and interpret

```powershell
npm run build
node --env-file=.env scripts/test-system-scale.mjs setup
# Use the exact generated database printed by setup; keep this order.
node --env-file=.env scripts/test-system-scale.mjs payroll --database=pbsystem_scale_TIMESTAMP_SUFFIX
node --env-file=.env scripts/test-system-scale.mjs workflows --database=pbsystem_scale_TIMESTAMP_SUFFIX
# Then run directory, scope, imports, annual, capacity, mixed, load, soak individually.
```

Run phases sequentially because each owns port 3196. Do not rebuild while its child is running: native Windows modules in `.output` may be locked. `scope` creates unique future transfer fixtures and should run once on a fresh fixture. Reports record checks, durations, statuses and health counters; unexpected failures exit nonzero. Expected rejection checks are assertions, not blind retries of financial writes. Setup needs local database privileges to create a separate schema and temporary limited users; the app itself cannot create users or access the original schema.

Environment: Windows, Node 24.13.0, MariaDB 10.4.32, Intel i7-13620H / 16 logical cores / 16 GiB RAM. These measurements establish behavior for this local production build and synthetic dataset, not Namecheap Linux/shared-host capacity or a guarantee against downtime. The 6,000 employees are stored records, not 6,000 concurrent employee logins. Bulk attendance was seeded as normalized data; only the small workbook tested Excel parsing/import workflow. Billing remains a full lightweight directory, and status-filtered payslip queries still validate all matching source sets. Unpaged/export and annual-preview paths still need appropriate capacity planning as historical years grow. The one-minute run is not a multi-hour endurance test. Hosting quotas, sustained mixed financial load, multi-year growth, restore/failover, host/power/network loss, and external email/payment delivery remain separate staging/operations checks. No real salary or bank payment occurred.


## Million-record local capacity investigation (November 22, 2026)

This investigation is local and uncommitted. It is not a Namecheap/shared-host certification or a guarantee against downtime. The target fixture contains 1,000,000 employees, four agencies, 500 sites (2,000 employees each), 150 clients, 1,500 site rates, 15,000,000 normalized attendance rows for September 1-15, 2026, and 1,000,000 pre-established synthetic portal accounts/sessions. Financial expectations are one million Approved payrolls, one million posted payslips and 550,000 posted loan/installment receipts. Portal passwords are disabled test values; existing-session reads do not benchmark signup, password verification, OAuth, email or a million simultaneous logins.

### Interrupted evidence and retained failures

The first fixture is `pbsystem_scale_20261122063337_b790`. Its initial full 25-site payroll preview exhausted the isolated app's 768 MiB heap (50,000 employees / 750,000 attendance rows); this was an actual test-process crash, not a successful run. A 2,000-person finalization also exceeded the local 1 MiB MySQL packet limit; the transaction rolled back without payroll/receipt rows. These failures justified the roster/page bounds, lazy details and pre-write snapshot-size guard described in API_MAP.md.

With those fixes and the original 16 MiB database buffer, the 100-staff read stage completed 1,752/1,800 requests with 48 busy responses and p95 9,251 ms. Temporarily using a 256 MiB buffer and a 16 MiB packet limit yielded 1,779/1,800 successes, 21 busy responses and p95 8,839 ms. That still fails an all-success/fast 100-user target. A portal ramp before the single-connection fix produced 497/600 successes and 103 busy responses at 100 users; internal parallel payslip queries exhausted the pool's waiting queue. Neither result is presented as a capacity pass.

The first 100-finalization burst admitted two financial operations and rejected 98 as busy, matching the existing two-heavy-operation limit. A separate 60-second mixed run with 98 readers and two real payroll/payslip writers completed all 5,026 workload requests (p95 392 ms; the slowest request, including a financial write, took 23.5 seconds). The million-site financial loop subsequently recorded verified progress through 32 sites / 64,000 employees before interruption. Its checkpoint still said running and must not be counted as a completed million-payroll run.

On resumption, the old processes were absent and MySQL had restarted with its original settings. Exactly one of 95 synthetic tables, `payroll`, returned storage-engine error 1932 despite its metadata/files being present. The ordinary local employee, DTR and payroll tables were readable. Read-only diagnostics did not establish why the restart/storage problem occurred; a credit interruption alone is not evidence of causation. No force-recovery setting, original-data repair, table-file replacement or original-data deletion was attempted. The orphaned limited test account was removed. The old schema and raw reports remain as failed/interrupted evidence.

A replacement fixture, `pbsystem_scale_20261122130437_8efc`, copies only readable synthetic base/configuration data in bounded batches. Its payroll definition comes from the ordinary schema without copying ordinary rows. Financial posting/history tables start empty; synthetic loan/installment balances and DTR states reset to their seeded starting values, so actual application APIs must produce the financial results again. The interrupted database is preserved.

### Safe reproduction and remaining boundaries

`recreate-million-fixture.mjs --from=EXACT_GENERATED_NAME` is only for a marked synthetic million fixture. `run-million-scale-suite.mjs --database=EXACT_GENERATED_NAME` records phase progress, stops on a failed phase, and resumes completed phases rather than claiming they passed again. Each phase owns loopback port 3197 and a random DML-only account for its exact test schema; access to the ordinary schema is explicitly denied. The app child uses a 768 MiB heap; startup maintenance and SMTP are disabled only for that child. Do not build while the child is running on Windows, where native modules may be locked.

The harness's `--packet-mb=16 --buffer-mb=256` flags temporarily change local MySQL instance settings and record restoration leases in the test folder. Each normal exit stops its child, removes its temporary user, and restores prior settings after asynchronous buffer resizing finishes. An abrupt machine/process termination cannot guarantee `finally` runs; inspect leases, owned processes and actual current settings before resuming. The production APIs never raise these global settings themselves. Buffer resizing behavior is documented by [MariaDB](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/system-variables/setting-innodb-buffer-pool-size-dynamically).

A million stored records is not a million simultaneous clients. The loopback driver ramps up to 100 authenticated staff clients and 100 portal clients, with additional 100-staff-plus-100-portal read samples during financial processing. It cannot reproduce one million concurrent browsers on this 16 GiB development PC. That target requires a separately provisioned staging system and distributed load generators with their own resource monitoring; see [Grafana k6 large-test guidance](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/). These short protocol tests do not establish browser rendering speed, multi-year growth, multi-hour endurance, host/network/power-failure recovery or external delivery reliability.

Interactive payroll review/finalization is bounded to 2,000 enrolled employees per site; larger individual sites need a separate background workflow. Two heavy execution slots protect the local process but do not form a durable queue: rejected staff jobs have not been accepted for later execution. A production queue needs persisted job ownership, progress, idempotency, transaction/revision checks and controlled retries. Per-process limits must be budgeted across all worker processes and database connections. Full lookup/export and other historical/report consumers have not all been certified for million-row datasets; unpaged employee responses over 10,000 now fail safely rather than allocating the full directory. Migrate those consumers before treating the entire UI as million-employee ready.

The replacement portal ramp after the single-connection fix completed all 600 requests at 100 concurrent portal clients (p95 336 ms, max 377 ms). The fresh 98-reader/two-writer mixed phase completed all 5,347 workload requests (p95 257 ms; maximum including financial writes 13.8 seconds). A controlled pair of row-lock-blocked finalizations confirmed that a frozen Approved payroll summary stays available with both heavy slots occupied; the locks were released and the actual financial writes drained normally. A narrow existing optional `(Status,DateHired)` index was also applied only to the replacement synthetic fixture and selected by EXPLAIN for active-employee counts.

The resumed all-site financial loop completed all 500 sites: 1,000,000 Approved payrolls, 1,000,000 Posted payslips and 550,000 Posted deduction receipts. Every employee was checked against an independent cent-based expected amount, detail/deduction reconciliation and loan/installment balances. The successful phase retained 2,580 HTTP measurements (2,361 successful and 219 admission-limit 503 responses); reader samples and read-only retries remain visible in that report. Final post-population read-load and aggregate audit results are recorded below when complete; seeded counts alone are not a capacity pass.


Replacement full-loop resource stop: 174 sites / 348,000 employee payrolls and posted payslips were verified before the driver refused another batch because available system RAM fell below 512 MiB. It drained admitted work, stopped its child and restored the local packet/buffer settings. This is an incomplete million-payroll run, not a financial mismatch or an app-crash pass. Exact committed counts are recorded in `resource-stop.json`. The suite must resume only after sufficient system memory is available; do not lower the resource floor to force completion on a busy PC.

After memory was freed, revalidation encountered an expected admission-limit 503 on a workflow GET during the intentional 200-reader sample. That attempt stopped cleanly and retained its raw report. The financial harness now records every such response and permits up to six read-only attempts with a three-second cooldown; it never automatically repeats a financial POST. New batch admission waits for pending reader samples. Already finalized batches are independently reverified, and already posted cutoffs are not posted again on resume. These retries do not erase overloaded responses from the capacity measurements.

The first post-population staff-read attempt exposed a payslip-directory timeout above 60 seconds with one reader. The read-only app child was intentionally stopped after capturing that timeout; later connection failures in that failed attempt are consequences of that stop, not independent crash evidence. The directory now counts/selects groups from DTR headers using an indexed active-finalized-payroll EXISTS, and keeps page employee selection as a distinct SQL set rather than expanding tens of thousands of IDs into IN parameters. Exact publication validation still includes other-site and legacy payrolls. Database integration checks cover combined groups, totals, stale outside-site sources, posting idempotency and rollback. Posting-status-filtered directory queries still use full exact-source validation and remain a separate large-history tuning boundary. The final staff ramp includes both per-site and grouped-account directory reads and stops admitting new requests on an unexpected network/5xx failure.

### Completed replacement results

All nine suite phases and the independent aggregate audit completed. Evidence is in `.data/scale-tests/pbsystem_scale_20261122130437_8efc/summary.json`, `suite-progress.json`, timestamped raw reports, and `million-staff-route-summary.json`. The audit confirms one million distinct payroll employees, active posting payroll IDs and publication payroll IDs; one million Posted publications; 550,000 Posted loan/installment receipts; zero incorrect loan/installment balances; and aggregate net pay equal to detail earnings less deductions. These are actual API-finalized/published records, not merely pre-seeded financial rows.

After the directory fix, all 3,720 staff workload requests across 1/10/25/50/100-user stages succeeded (3,728 including health/auth probes). At 100 users, all 2,000 workload requests succeeded, with no pool acquisition failures/timeouts. The app ended at 244 MiB RSS with zero active/acquiring pool connections. This establishes successful completion, not uniformly fast response times:

| Screen/API at 100 staff clients | Requests | p95 response time |
| --- | ---: | ---: |
| Employees, varied cursor pages | 200 | 1.62 s |
| Sites | 200 | 0.70 s |
| Clients | 200 | 0.15 s |
| DTR directory | 200 | 4.02 s |
| Employee loan/deduction accounts | 200 | 6.69 s |
| Site rates | 200 | 0.57 s |
| Frozen payroll summary | 200 | 1.06 s |
| Per-site payslip directory | 200 | 7.00 s |
| Grouped-account payslip directory | 200 | 21.09 s |
| Billing directory | 200 | 13.16 s |

The final portal ramp selected authenticated employees across the full one-million-person population. All 600 requests at 100 concurrent clients succeeded (p95 375 ms, max 434 ms), and all 1,124 requests including smaller stages/probes succeeded. Every successful payslip response was checked for the account's own employee ID. This is 100 concurrent clients accessing million-record data, not one million concurrent connections.

The resumed financial run's reader samples each submitted 100 staff plus 100 portal reads around financial work. The 250- and 450-site samples each returned 127 HTTP 200 and 73 HTTP 503 responses; the first sample also captured a delayed workflow GET. These remain intentional overload evidence. The separate 100-staff finalization burst accepted two jobs and rejected 98 as busy: rejected work is not queued or guaranteed to execute later.

The aggregate audit verified restoration of the original 1 MiB packet limit and 16 MiB buffer pool, removal of the latest temporary app account, closed test port 3197, and readable ordinary local employee/DTR/payroll tables. No live server change or commit was made. The successful build completed in 1m18s; the real-database payslip integration test passed both tests using temporary tables inside the synthetic schema, including stale sources outside a selected site and rollback/idempotency cases. Earlier failed attempts remain retained as evidence.

Next capacity priorities are a durable financial job queue and bounded or precomputed financial-directory summaries, especially account payslips and billing. Preserve exact source/version validation and invalidation when designing those summaries. Do not treat the 21-second account page or the overload rejections as production-ready responsiveness. Multi-year history, status-filtered publication directories, large account-roster detail views, full exports/lookups, sustained endurance, distributed million-client traffic and actual hosting capacity remain unverified.
## Local lookup cache and payroll queue

The local database was backed up with the existing verified backup helper before adding `system_runtime` and `payroll_job`. `PAYROLL_QUEUE_ENABLED=true` and `PAYROLL_QUEUE_WORKER=true` are enabled only in the ignored local `.env`; the example defaults queue admission to disabled. No live migration, deployment or commit was performed.

Reproduction for a local database:

```powershell
node --env-file=.env scripts/apply-runtime-queue-cache.mjs
# Inspect the preview; --apply creates a backup and applies the additive schema.
node --env-file=.env scripts/apply-runtime-queue-cache.mjs --apply
# Set PAYROLL_QUEUE_ENABLED=true and PAYROLL_QUEUE_WORKER=true in local .env.
```

The organization metadata cache is server-only, bounded to 128 entries / 8 MiB (512 KiB per entry), with a 30-second TTL and pending-read coalescing. An SQL UUID epoch detects invalidation across app processes. Metadata writes invalidate before their response is acknowledged; direct SQL edits expire within the TTL. UUID epochs avoid generation collisions after restore. Epoch-read errors bypass cached values, and failed/oversized loads are not cached. Each caller gets a deserialized copy and independently evaluated edit permissions after authentication/module access. Payroll calculations, payslips, financial directories, employee profiles and sessions are not cached; their browser responses remain private/no-store. This first cache implementation does not remove the million-record account-payslip/billing summary bottlenecks reported above.

The Payroll Processing Finalize action now creates a durable job and displays Queued, Running, Finalized, Failed or Needs review. A refresh/page close does not cancel an accepted job. Pending items are prioritized in the owner's bounded status list; users can expand it. Polling uses the existing realtime-refresh helper: it pauses for hidden/offline tabs, backs off failures, and stops when the page is deactivated or unmounted. Reject/Cancel and legacy inline clients retain their explicit synchronous behavior. A disabled queue preserves the earlier UI workflow; a failed availability check does not silently submit an uncertain job inline.

Admission commits the job before HTTP 202. A UUID request key is bound to its owner, DTR and reviewed hash; a replay returns the existing job, while conflicting reuse is rejected. A unique generated active-batch column prevents simultaneous queued/running duplicates. Limits are 1,000 pending jobs per database and 100 per owner. The current conservative worker processes one queued finalization at a time per database, with an advisory lock held on a dedicated connection; it shares the existing process heavy-work budget with interactive financial work. It uses one control connection and one financial connection while processing, so reserve sufficient pool/hosting quota for ordinary reads. A full execution budget does not itself reject durable queue admission; the ordinary API admission limit still applies.

At execution, the worker locks the job, rechecks the submitting user's active role and Payroll module access, and compares the current canonical financial preview with the submitted review hash. Changed inputs require a fresh review; revoked access fails safely. The job success row, payrolls, deduction receipts and balance changes commit in one transaction. A worker restart recovers interrupted Running rows only after any surviving transaction's row lock resolves. Conditional completion/error updates cannot overwrite an already committed success. No automatic retry of an uncertain financial write is introduced. Normal shutdown drains the worker before closing the pool. This depends on a running Node process: pending jobs remain stored while the app/host is stopped and resume when a worker starts. See [MariaDB's connection-scoped advisory lock semantics](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock). The installed Nitro runtime exposes `beforeResponse` and `close` hooks; use its installed runtime contract when upgrading Nitro.

Validation evidence: `.data/scale-tests/pbsystem_scale_20261122151359_0833/queue-cache-result.json`. The fresh synthetic fixture holds 6,000 employees and two cutoffs. Its randomly generated DML-only app user was explicitly denied access to the ordinary schema. Tests verified:

- 100 simultaneous distinct job submissions all returned 202; pending jobs survived process termination/restart.
- Duplicate/replayed submissions did not create another job or payroll; another owner could not read the job, and a Viewer could not enqueue.
- Two app processes shared invalidation correctly; cached metadata did not share edit permissions or bypass authentication.
- A queued preview changed before execution became NeedsReview with zero payroll writes; a revoked role failed with zero payroll writes.
- A synthetic database error on job-success update rolled back the entire financial transaction. After fresh reviews and correction, all 101 target DTRs finalized.
- All 1,212 employee payroll amounts matched independent cent calculations, including the deliberately changed attendance row. All loan/installment balances were correct and no employee/cutoff had duplicate payrolls.
- Cache unit tests covered concurrent fills, clone isolation, in-flight invalidation races, failed epochs/loads, oversized entries and bounded memory. Capacity tests verified admission while execution slots were full and safe lease release.
- Browser tests verified one queue POST, no synchronous fallback when enabled, readable pending details, completion notification, and 375/1280-pixel layouts; existing directory scrolling/search checks also passed.

The synthetic fixture and audit/job history are retained for review; owned test apps/accounts were removed. The ordinary local jobs endpoint and Admin health check returned HTTP 200 with the queue enabled and no original-business payroll job submitted. These are focused feature tests, not a new million-record or distributed million-client certification.

## Local user activity history — 2026-11-28

The shared staff dashboard header now has an Activity history clock icon. It defaults to the current workspace, with Page and Action filters, collapsed details, PHT timestamps, Newer/Older paging and an explicit Done/close action. Admins see team activity; Supervisors see team activity only on an accessible business page. Other staff see their own activity. Settings team history is Admin-only. This is operational action history, not editable notes; users cannot erase it through the application.

The local migration creates `user_activity_event` after a verified backup, without changing business records or creating another database:

```powershell
node --env-file=.env scripts/apply-user-activity-history.mjs --apply
```

The migration was applied to ordinary local `pbsystem`. Authenticated read-only checks of localhost:3000 history and health returned 200; no original-business test action was submitted. Live/Namecheap was not changed. The history begins with future actions after activation; old edits/deletions cannot be reconstructed. API_MAP documents coverage, permissions, bounded caching and the supplemental log's crash/failure window. Existing financial transaction audits are retained. Deployments/restores must apply the additive table before enabling the queue worker: actual queued completion history is deliberately part of the financial transaction.

Validation uses the existing guarded synthetic fixture `pbsystem_scale_20261122151359_0833`, not another generated schema. The randomly generated DML-only test account was explicitly denied access to the ordinary database. The API test verified actual create/update/delete capture, actor snapshots, guest denial, own/team visibility, 100 simultaneous mutations with recorded headers, 25-row keyset pages without duplicates, and permission revocation after warming an older-page cache. A synthetic audit-storage trigger failure verified a successful business operation still returned success plus an unavailable-history header and diagnostic counter, without replay. After removing that trigger, an unused synthetic DTR finalized through the real worker and produced exactly one transaction-bound Completed event. Temporary test users, new organization rows and the owned test app were removed; synthetic activity and financial evidence were retained.

Evidence: `.data/scale-tests/pbsystem_scale_20261122151359_0833/activity-history-result.json`, `.data/activity-integration.log`, `.data/activity-unit.log`, `.data/activity-regression.log`, `.data/activity-browser.log`, and `.data/activity-history-ui/`. Unit tests cover all existing mutation route scope mappings, secret/attachment exclusion, status filtering, bound BIGINT cursors, per-user cache isolation/permission checks, read coalescing, batching/failure diagnostics and transaction connection reuse. Browser QA covers on-demand loading, 25-row paging, details, permission-denial cleanup, focus trap/restoration, Escape, body scroll locking, and 375/1280 light/dark layouts.

Reproduce focused checks:

```powershell
node --test scripts/test-activity-history.cjs scripts/test-security.cjs scripts/test-employee-portal.cjs scripts/test-lookup-cache.cjs scripts/test-reliability.cjs
node --env-file=.env scripts/test-activity-history-integration.mjs --database=pbsystem_scale_20261122151359_0833
# Optional existing Playwright installation; does not change package dependencies.
$env:NODE_PATH=(Resolve-Path '.data/assistant-browser-tools/node_modules').Path
$env:PORTAL_BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:ACTIVITY_BROWSER_TEST='1'
node --test scripts/test-activity-history-browser.cjs
```

The integration rerun uses the next unused synthetic Draft DTR; it must not be pointed at the ordinary application database. These are focused activity/queue tests, not a new million-user capacity claim. Logging is compact and paged but still consumes storage; retention/archiving should be planned according to office requirements before production. There is no automatic deletion of audit evidence.

### Follow-up: localhost recorder startup and agency address — 2026-11-28

A user agency-address edit exposed a gap in the initial verification: the already-running dev instance had refreshed the history API/UI without registering the newly added Nitro recorder plugin. The isolated production test app did load it on a fresh start. This was not history caching or a missing database table. Explicit plugin registration in nuxt.config now triggers a configuration reload and makes startup registration visible in the Admin health response. The history endpoint rejects an inactive recorder with 503 instead of reporting an empty successful history. The local dev server was restarted on port 3000 and is running with recorderRegistered=true.

Actual localhost verification used one explicitly named temporary agency, edited its address through the real dashboard form in a headless browser, and opened the real Activity history modal. The PUT returned recorded and its Update row included AgencyAddress; the address value did not appear in the audit payload. Creation and removal also recorded successfully. Only that temporary agency was removed afterward; the four existing agencies were preserved. Synthetic verification activity remains in history. No historical user action was fabricated or backfilled. The edit made before the recorder started cannot be recovered from this activity table.

Evidence: `.data/activity-local-browser-check.log` and `.data/activity-local-history-verified.png`. Tests now check missing-recorder diagnostics/503 behavior, plugin startup registration, one event per address save, and the integration fixture's recorderRegistered flag/address metadata. No live server or commits were involved.

### Named records and page coverage - 2026-11-28

History now stores up to three saved record-name snapshots per operation, including the previous name after a rename. The collapsed timeline shows the affected agency, employee, site, DTR cutoff, rate or account name; details retain its kind and ID. A permanent deletion keeps the pre-delete name. Older events without captured names are explicitly labelled and are not backfilled with today's names.

Agency updates compare the locked saved row with normalized incoming values and report only the field names actually changed (for example, Address). An identical save reports no tracked changes. Other modules say Submitted fields rather than claiming a before/after comparison. Address/contact values, passwords, files and financial snapshots are not copied into history. Ordinary organization deactivation is Update / Deactivated, while permanent removal remains Delete. The name resolver runs after module authorization and uses only fixed indexed queries with bound IDs, at most three before and three after a write. Existing 25-row keyset paging, bounded server caching and per-request permission checks remain in place.

The real API coverage run completed **45 successful mutations across 28 distinct page scopes** in the existing guarded synthetic schema. It verified both the inserted event and the real page-filtered history response, including agency address-only changes, rename/no-op/deactivation, permanent shift deletion, clients/sites/accounts/regions/positions, all three rate families, employees/documents/status/deployment/portal accounts, DTR and holidays, deduction/loan catalog and accounts, contribution plans, refundable cutoff overrides, adjustments, payroll finalization, site payslip posting, individual withdrawal, 13th-month previous earnings, billing setup and department creation/removal. A forbidden Viewer write created no successful event. This validates representative real workflows across pages; it does not certify every button or reconstruct historical edits.

Evidence: `.data/scale-tests/pbsystem_scale_20261122151359_0833/activity-pages-result.json` and `.data/activity-pages.log`. Rerun with `node --env-file=.env scripts/test-activity-pages.mjs --database=pbsystem_scale_20261122151359_0833`; it uses a DML-only app account denied access to the ordinary schema and retains synthetic financial/activity evidence. It does not create another database.

The focused integration rerun also passed 100 simultaneous real mutations, per-role visibility, duplicate-free cursor pages, warm-cache permission revocation, simulated log-storage failure without business-action replay, and exactly one transaction-bound event from actual queued payroll completion. Related regression checks passed 50 tests with two optional database tests skipped; the dedicated real-database suites above ran separately. Browser QA passed mobile/desktop, both themes, named subjects, friendly agency change labels, paging, focus handling and permission-denial cleanup. Actual localhost form verification recorded the saved agency name and only the changed Address field; the temporary test agency was removed and the original four agencies preserved. No live change or commit was made.

### Plain-language activity presentation - 2026-11-28

The history timeline now reads as a sentence: actor + action + named record (for example, Sample Staff changed the address for agency Sample Agency). The main entry shows only this sentence, its page and time; action badges, role, raw endpoint-like operations and IDs no longer crowd the timeline. Actual agency changed fields drive the wording; merely submitted fields never become a claimed change. Unchanged saves and accepted-but-not-completed requests have explicit notes. Deactivation, permanent removal, payroll calculation/finalization and payslip publication/withdrawal have distinct wording. Older entries without a name use a generic record description without inventing a historical name.

View details contains changed/submitted fields, related records and the exact timestamp. Technical references are collapsed again inside it, keeping original stored operations, IDs and counts available for investigation. The action filter uses familiar labels such as Added/Edited while sending the same canonical API values. This is a frontend presentation change; stored evidence, authorization, paging, cache and server APIs are unchanged. No migration or extra requests are introduced. Focused unit/browser checks cover truthful wording, collapsed references, filter values, keyboard interaction and mobile/desktop in both themes.

### Seven-day history archive and bounded scroll reads - 2026-11-28

Recent is a rolling last-seven-days view; Archive automatically shows older events in the same append-only storage. Refresh/reopen advances a UTC-minute boundary; continuation retains the initial boundary to prevent records crossing views mid-scroll. There is no Monday reset, destructive cleanup, weekly bulk copy or archive worker. This does not shrink the database or guarantee uptime. Disk capacity/backups and an office-approved long-term retention plan still need operational monitoring.

The index migration was applied to ordinary local pbsystem after a verified backup using `node --env-file=.env scripts/apply-user-activity-history.mjs --apply`. It preserves all history while replacing ID-only read indexes with time/cursor indexes. Apply it before deploying the new reader; runtime APIs never alter schema. Live hosting remains unchanged.

Scroll requests return at most 25 entries with an exact microsecond timestamp/BIGINT seek cursor, without OFFSET or COUNT. The modal allows only one request in flight and no background poll. It appends near the bottom, supports a Load more button, and retains at most 250 entries in a rolling browser window with preserved scroll position and Back to latest. Filters/archive switches abort/reset old reads. Network failures retain displayed entries for retry; permission failures clear them. Existing bounded server caching/coalescing applies to both periods with fresh authorization.

Validation evidence: `.data/scale-tests/pbsystem_scale_20261122151359_0833/activity-archive-result.json`, `.data/activity-archive-integration.log`, `.data/activity-archive-existing-integration.log`, `.data/activity-archive-unit.log`, `.data/activity-archive-browser.log`, `.data/activity-archive-regression.log`. The guarded existing synthetic database test read 101 recent rows across five pages and 1,001 archived rows across 41 pages, including the exact seven-day boundary and equal timestamps. Every expected row appeared once in the correct period. Forty concurrent archive continuation reads succeeded; action filtering and permission revocation after a warm cache passed; all seeded evidence remained stored. EXPLAIN verified an indexed range scan without filesort for own scoped archive. The schema upgrade's second call made no changes. No extra database was created.

The existing integration suite also passed 100 concurrent real writes, own/team permissions, log-failure handling and one transaction-bound queued payroll completion. Related regressions passed 52 tests with two optional DB suites skipped; dedicated database tests above ran separately. Browser checks cover actual scrolling/single-flight calls, a stable anchor, the 250-entry bound, archive switching, retry after a failed continuation, keyboard interaction, permission cleanup and mobile/desktop in both themes. These are focused history checks, not a hosting-capacity certification.

Reproduce: `node --env-file=.env scripts/test-activity-archive.mjs --database=pbsystem_scale_20261122151359_0833`. The DML-only app account is denied access to the ordinary schema and cleaned up after the test; synthetic history remains as evidence. No commit or live deployment was made.

Read-only localhost verification passed both Recent and Archive UI/API paths with recorderRegistered=true and unchanged history row count. Evidence: `.data/activity-archive-local.log` and `.data/activity-archive-local.png`. Production build passed; code map regenerated.

UI refinement: Recent/Archive tabs were replaced by one compact header archive icon. Recent remains the default; archive mode changes the title to Activity archive and uses the same position for an accessible Back to recent arrow. Both icon controls have descriptive accessible names/tooltips, and mobile/light/dark browser checks passed. Data, filters, permissions and scroll loading are unchanged.
