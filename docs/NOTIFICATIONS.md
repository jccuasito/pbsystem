# Notification bell

The staff dashboard shows current work requiring attention, grouped into DTR review, payroll review, unposted payslips, pending HR responses, expiring employee documents, scheduled backup failures and staff accounts awaiting initial setup. Each category requires the corresponding server-side permissions. Backup failures and initial staff setup alerts are Admin only; employee requests require Admin/Supervisor plus Employees View and Edit.

The employee portal mounts a separate bell only after login. It shows only the employee's own posted payslips, posted PDF archives and HR responses to their information requests. It never calls the staff notification endpoint. Neither bell displays pay amounts or private conversation contents.

## New staff account setup

The Admin-only alert counts Inactive staff accounts that have neither module-permission records nor prior login history. It covers staff registration, including Google-created staff accounts; payslip portal registrations are separate. The alert contains no name/email or credentials. It remains until the existing Team access activation workflow configures the account. Previously configured or signed-in deactivated accounts are excluded; older records with no setup/login evidence are included for review.

Clicking the alert opens **Settings > Team access**, refreshes the directory, enables Show inactive accounts and expands department groups so pending users are visible. Admin still selects Manage and reviews the department, role and permissions before activating/saving. Reading or opening a notification does not grant access, and no signup/activation behavior was changed.

## Before enabling on another database

Run from the app root with the private database environment configured:

```powershell
node --env-file=.env scripts/apply-notifications.mjs
```

This idempotent migration creates `staff_notification_read` and `employee_notification_read`, with owner foreign keys. Before creating missing tables it makes a verified SQL backup using the existing backup service; if backup fails, it does not apply the schema. It does not modify payroll, attendance, employee statuses or existing payslips. The tables are not automatically created by an HTTP request. Include them in future SQL backups/restores and keep backups outside public web directories.

## Reading alerts

- The badge counts unread alert groups, not the number of affected records. Open an alert to visit its module or use Mark as read / Mark all as read. Marking an alert does not resolve or approve the underlying work.
- Read state belongs to the current account. When the category's source fingerprint changes, that alert becomes unread again. Current source state determines the list: resolved requests, withdrawn payslips and completed work disappear.
- DTR/payroll/payslip work covers recent cutoffs overlapping the last 90 days through today. Portal announcements cover posted dates/reply dates within 90 days, at most 10 per source. Document reminders use recorded expiry dates today through 30 days ahead. This is not a complete historical audit, attendance validation report or payroll readiness certification.
- The panel supports light/dark mode, small screens and keyboard Escape. Polling is approximately once per minute while the tab is visible/online; opening the panel, returning to the tab, and Refresh also update the feed. Errors show a safe retry message without raw API/SQL diagnostics.
- Notification links to HR responses respect the portal's existing unsaved-form confirmation. Cancelling keeps the draft. Notification links do not edit business records or bypass module permissions.

## Scheduled backup alert

The in-process daily backup wrapper records only `{status:'failed',failedAt}` in private `DB_BACKUP_DIR/daily-status.json` on failure. A successful daily backup or an already recorded daily backup for that day clears the file. Ordinary manual backup failures are reported by the existing backup UI, not this scheduled alert. Setting `DB_AUTO_BACKUP=false` hides the scheduled alert.

This flag cannot detect a stopped server, sleeping host, failed external cron/task invocation or an unwritable status directory; absence of an alert does not prove backup coverage. Continue monitoring process/scheduler logs, off-machine backups and restore verification as described in [OPERATIONS.md](OPERATIONS.md). No external email, push or SMS delivery is configured.

## Verification

```powershell
$env:NOTIFICATIONS_TEST_DATABASE='1'
node --env-file=.env --test scripts/test-notifications.cjs

# Requires an existing Playwright installation in NODE_PATH and Chrome.
$env:NOTIFICATIONS_BROWSER_TEST='1'
node --test scripts/test-notifications-ui.cjs
```

Database regression writes use connection-local temporary tables, not working payroll records. Backup failure tests use a private isolated test directory. Browser checks use the actual Vue component with synthetic API replies. These checks cover role/owner isolation, stale source rejection, source publication validity, separate read receipts, safe diagnostics, navigation and responsive theme layout.
