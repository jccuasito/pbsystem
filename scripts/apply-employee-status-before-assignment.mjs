import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'MYSQLDUMP_BIN', 'DB_BACKUP_DIR']) {
  if (env[key] !== undefined) process.env[key] = env[key]
}
const connection = await mysql.createConnection({
  host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem',
})
try {
  const [[column]] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'DeploymentID'")
  if (!column) throw new Error('attendance.DeploymentID was not found.')
  if (column.Null !== 'YES') {
    const backup = await createDatabaseBackup('before-hr-status-assignment')
    console.log('Database backup saved:', backup.name)
    await connection.query('ALTER TABLE attendance MODIFY COLUMN DeploymentID INT NULL')
  }
  console.log('HR status can be saved before assignment. Existing attendance, foreign keys, and uniqueness are preserved.')
} finally {
  await connection.end()
}
