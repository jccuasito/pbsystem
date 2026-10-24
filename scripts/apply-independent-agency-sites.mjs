import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'
import { splitAgencySites } from '../server/utils/splitAgencySites.mjs'

const restoreArg = process.argv.find(value => value.startsWith('--restore-site-id='))
const restoreSiteIds = restoreArg ? [Number(restoreArg.split('=')[1])] : []
const siteArg = process.argv.find(value => value.startsWith('--site-id='))
const siteIds = siteArg ? [Number(siteArg.split('=')[1])] : []
if (!siteIds.length || [...siteIds,...restoreSiteIds].some(id => !Number.isInteger(id) || id <= 0) || restoreSiteIds.some(id => !siteIds.includes(id))) throw new Error('An explicit site ID is required and restoration must use that same site.')
const db = await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
try {
  const backup = await createDatabaseBackup('before-independent-agency-sites')
  console.log('Safety SQL backup: ' + backup.name)
  const changes = await splitAgencySites(db,{siteIds,restoreSiteIds})
  const [[index]] = await db.execute("SELECT COUNT(*) AS total FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='site_agency' AND INDEX_NAME='uq_site_single_agency'")
  const [[remaining]] = await db.execute('SELECT COUNT(*) AS total FROM (SELECT SiteID FROM site_agency GROUP BY SiteID HAVING COUNT(*)>1) shared')
  if (!Number(index.total) && !Number(remaining.total)) await db.execute('ALTER TABLE site_agency ADD UNIQUE KEY uq_site_single_agency (SiteID)')
  console.log(JSON.stringify({separatedSites:changes.length,restoredSites:restoreSiteIds.length,changes}))
} finally { await db.end() }
