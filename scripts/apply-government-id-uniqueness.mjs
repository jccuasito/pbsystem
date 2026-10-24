import mysql from 'mysql2/promise'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { typeKeySql, numberKeySql, identityColumns } from '../database/government-id-uniqueness.mjs'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  const [[lock]] = await db.execute("SELECT GET_LOCK('pbsystem:government-id-write',30) AS acquired")
  if (Number(lock.acquired) !== 1) throw Error('Government IDs are being updated. Retry after the current save finishes.')
  const [duplicates] = await db.query(`SELECT COUNT(*) AS records FROM government GROUP BY ${typeKeySql},${numberKeySql} HAVING COUNT(*)>1`)
  if (duplicates.length) throw Error(`${duplicates.length} duplicate ID group(s) already exist. Review them before installing unique constraints; no records were changed.`)
  const [records] = await db.execute('SELECT GovernmentID,AttachmentPath FROM government WHERE AttachmentPath IS NOT NULL')
  const hashes = [], seen = new Set()
  const root = path.resolve(process.env.GOVERNMENT_ID_STORAGE_DIR || '.data/employee-government-ids')
  for (const record of records) {
    if (!/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(record.AttachmentPath)) throw Error('An existing attachment path needs review. No records were changed.')
    let data
    try { data = await readFile(path.join(root,record.AttachmentPath)) } catch { throw Error('An existing ID scan is missing. Restore it before installing scan duplicate prevention.') }
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    if (seen.has(hash)) throw Error('Duplicate scan files already exist. Review those records before installing unique constraints; no records were changed.')
    seen.add(hash); hashes.push([hash,record.GovernmentID])
  }
  const [columns] = await db.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='government'")
  const names = new Set(columns.map(row=>row.COLUMN_NAME))
  const [indexes] = await db.query('SHOW INDEX FROM government')
  const indexNames = new Set(indexes.map(row=>row.Key_name))
  const changes = Object.entries(identityColumns).filter(([name])=>!names.has(name)).map(([name,definition])=>'ADD COLUMN '+name+' '+definition)
  // A prior interrupted installation may have columns but no unique index yet.
  if (!indexNames.has('uq_government_identity')) for (const name of ['GovernmentTypeKey','GovernmentNumberKey']) {
    if (names.has(name)) changes.push('MODIFY COLUMN '+name+' '+identityColumns[name])
  }
  const needed = changes.length || !indexNames.has('uq_government_identity') || !indexNames.has('uq_government_scan')
  if (needed) {
    const backup = await createDatabaseBackup('before-government-id-uniqueness')
    console.log('Safety SQL backup: '+backup.name)
    if (changes.length) await db.query('ALTER TABLE government '+changes.join(', '))
    await db.beginTransaction()
    try {
      for (const values of hashes) await db.execute('UPDATE government SET AttachmentSHA256=? WHERE GovernmentID=?',values)
      await db.commit()
    } catch(error) { await db.rollback(); throw error }
    const keys=[]
    if (!indexNames.has('uq_government_identity')) keys.push('ADD UNIQUE KEY uq_government_identity (GovernmentTypeKey,GovernmentNumberKey)')
    if (!indexNames.has('uq_government_scan')) keys.push('ADD UNIQUE KEY uq_government_scan (AttachmentSHA256)')
    if (keys.length) await db.query('ALTER TABLE government '+keys.join(', '))
  }
  console.log('Global ID-number and exact-scan duplicate protection is ready. Existing IDs and scans retained.')
} finally {
  await db.execute("SELECT RELEASE_LOCK('pbsystem:government-id-write')").catch(()=>{})
  await db.end()
}
