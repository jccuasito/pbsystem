import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  const [[column]] = await db.execute("SELECT COUNT(*) AS total FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='site_agency' AND COLUMN_NAME='SiteAccountID'")
  const [[constraint]] = await db.execute("SELECT COUNT(*) AS total FROM information_schema.table_constraints WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='site_agency' AND CONSTRAINT_NAME='fk_site_agency_account'")
  if (!Number(column.total) || !Number(constraint.total)) {
    const backup = await createDatabaseBackup('before-site-agency-accounts')
    console.log('Safety SQL backup: ' + backup.name)
    if (!Number(column.total)) {
      // One ALTER installs the column/index/FK together; reruns never overwrite chosen mappings.
      await db.execute('ALTER TABLE site_agency ADD COLUMN SiteAccountID INT NULL, ADD KEY idx_site_agency_account (SiteAccountID), ADD CONSTRAINT fk_site_agency_account FOREIGN KEY (SiteAccountID) REFERENCES site_account (SiteAccountID) ON DELETE RESTRICT ON UPDATE CASCADE')
      await db.execute('UPDATE site_agency link INNER JOIN site s ON s.SiteID=link.SiteID SET link.SiteAccountID=s.SiteAccountID')
    } else if (!Number(constraint.total)) {
      await db.execute('ALTER TABLE site_agency ADD CONSTRAINT fk_site_agency_account FOREIGN KEY (SiteAccountID) REFERENCES site_account (SiteAccountID) ON DELETE RESTRICT ON UPDATE CASCADE')
    }
  }
  console.log('Per-agency Site Accounts ready. Existing selections retained; no payroll or DTR changes.')
} finally { await db.end() }
