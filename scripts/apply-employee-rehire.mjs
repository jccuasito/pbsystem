import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
// This task authorizes local development only. Never accept a hosting target here.
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || '127.0.0.1') || (env.DB_NAME || 'pbsystem') !== 'pbsystem') throw Error('This installer is restricted to the local pbsystem database.')
for (const key of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','MYSQLDUMP_BIN','DB_BACKUP_DIR']) if (env[key] !== undefined) process.env[key] = env[key]
const db = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', multipleStatements: true })
try {
  const [[column]] = await db.query("SHOW COLUMNS FROM employee LIKE 'LastRehireDate'")
  const [[table]] = await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_rehire'")
  if (!column || !table) {
    const backup = await createDatabaseBackup('before-employee-rehire')
    console.log('Verified local pre-migration backup:', backup.name)
    await db.query(fs.readFileSync('database/employee-rehire.sql', 'utf8'))
  }
  console.log('Local rehire schema ready. Existing employees, dates, assignments and financial records unchanged.')
} finally { await db.end() }
