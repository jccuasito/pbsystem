import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
for (const key of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','MYSQLDUMP_BIN','DB_BACKUP_DIR']) if (env[key]!==undefined) process.env[key]=env[key]
const connection=await mysql.createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem'})
try {
  const [[column]]=await connection.query("SHOW COLUMNS FROM employee LIKE 'ResignationDate'")
  if (!column) {
    const backup=await createDatabaseBackup('before-employee-resignation')
    console.log('Pre-migration backup:',backup.name)
    await connection.query('ALTER TABLE employee ADD COLUMN ResignationDate DATE NULL AFTER Status')
  }
  console.log('Employee resignation date is ready. No existing status, date, attendance or payroll values were changed.')
} finally {await connection.end()}
