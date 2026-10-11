# Settings: access and SQL backups

Apply the repeat-safe access migration before opening Settings:

```powershell
node --env-file=.env scripts/apply-settings-access.mjs
```

An Admin can change each user's role, active status, and per-module view/edit access. Existing non-admin accounts initially have view access to all modules; Viewers are read-only, while Supervisor and Encoder accounts can edit unless an explicit override removes access. Payroll finalization and other sensitive actions keep their stricter role checks. Admin accounts always have full module access. A changed role or status is checked against the database on every module API request, so an old login token cannot retain earlier access.

Set `MYSQLDUMP_BIN` and `MYSQL_BIN` in `.env` if the MySQL/MariaDB clients are not on PATH or in `C:\xampp\mysql\bin`. Set `DB_BACKUP_DIR` to a secure folder if the default `.data/database-backups` is unsuitable. Never put that folder in a web-served directory or in Git. The app creates a daily dump when it is running and detects that today's backup is missing. For an independent daily job on Windows, install the 12:00 AM task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-daily-backup-task.ps1
```

The Windows installer first attempts an unattended task. If Windows denies that mode, it installs a task that runs while the current user is signed in. The running Nitro server also checks at Singapore midnight and retries missing daily backups hourly. On Linux, schedule `node --env-file=.env scripts/backup-database.mjs` at midnight with cron/systemd using this repository as the working directory. A backup still requires a running database and available local disk. A stopped computer cannot create a backup; keep downloaded SQL files on separate storage. The current Settings implementation does not send backups to cloud storage. The backup list reports only completed dumps; each file has a SHA-256 metadata record checked before download or restore.

Only an Admin can create, download, import, or restore backups in Settings. The downloaded `.sql` file includes its SHA-256 manifest in a SQL comment at the top, so the UI needs only one file for download and import. Web import accepts files up to 100 MB and verifies the embedded checksum before admitting them to the backup list. The local `.sql.json` metadata files remain in the server backup folder for managed-file verification. Restore accepts a managed backup from the list and requires a confirmation checkbox in the UI (the API still requires `confirmation: 'RESTORE'`). The app takes a fresh safety backup first. MySQL/MariaDB SQL restore is not a single atomic transaction: do it during a quiet period, keep the safety file, then inspect key records and sign in again if needed. Test recovery on a separate database regularly.
