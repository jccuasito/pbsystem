# Running and deploying pbsystem

Prepared November 14, 2026 for an initial target of 30–50 office users. Actual capacity depends on the machine, database size, workload and hosting quotas. A local read test is not a shared-hosting capacity guarantee.

## Controls in the application

- MySQL uses 10 connections per process by default, a finite queue of 200, a 10-second connection handshake timeout and a 5-second acquisition timeout. A connection arriving after acquisition timeout is released, not leaked. Idle connections expire after 60 seconds. Pool/database outages produce a temporary 503 where recognized. There is no automatic retry of a write or transaction, especially after an uncertain commit.
- A Node process admits at most 128 API requests at once. At most 2 simultaneous DTR/payroll/billing/backup mutations run by default; excess receives 503 and `Retry-After: 3` before auth/body/database work. Capacity is released after the handler finishes or unwinds through Nitro request-error rendering, including errors, not immediately when a browser disconnects. These are per-process safeguards, not a distributed job queue or a WAF.
- Simultaneous dashboard reads share the same in-flight query result after each caller is authenticated/authorized. Settled responses and failures are not cached, so a later refresh still reads current data. Payroll progress coalesces separately for each cutoff. Staff sessions/permissions are never shared by this mechanism.
- Automatic page refresh defaults to 10 seconds with jitter, skips hidden/offline tabs, avoids overlap, and backs off when its callback rejects. Existing callbacks that catch errors internally cannot signal failure to the composable. Manual buttons remain available.
- Request diagnostics log slow API method/path/duration without query strings, payloads, cookies or SQL values. Public health responses contain no database identity or exception details. Existing transaction locks, duplicate checks, financial review snapshots and parameterized SQL remain.

Settings are documented in `.env.example`. Increasing the pool blindly can exhaust a shared MySQL quota: **all application processes × DB_POOL_SIZE**, plus backup/maintenance/other applications, must fit the account's limit. Start with one Node process and measure. A queue or concurrency rejection means wait and retry; a network failure after a payroll action means inspect the saved status before resubmitting.

## Database indexes and backups

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
4. Set the real HTTPS `APP_URL`, database credentials, a private JWT secret, Google callback credentials/authorized domains if used, SMTP settings and persistent absolute private-file/backup paths. Import the schema/data and run applicable reviewed migrations. Transfer private images/documents separately. Never expose `.env`, backups, private files or source maps through the web server. All `/uploads/...` image URLs must reach authenticated Node handlers, not stale static copies.
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
