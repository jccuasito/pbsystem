import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem', multipleStatements: true })
try {
  const [[legacy]] = await db.execute('SELECT COUNT(*) AS n FROM thirteenth_month_pay WHERE AgencyID IS NULL').catch(() => [[{ n: 0 }]])
  const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM thirteenth_month_pay')
  const [[hasAgency]] = await db.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='thirteenth_month_pay' AND COLUMN_NAME='AgencyID'")
  if ((!Number(hasAgency.n) && Number(count.n)) || Number(legacy.n)) throw new Error('Existing annual records need an agency and payment-history review before migration. No records were changed.')
  const backup = await createDatabaseBackup('before-thirteenth-month')
  console.log('Database backup:', backup.name)
  await db.query(await fs.readFile(new URL('../database/thirteenth-month-workflow.sql', import.meta.url), 'utf8'))
  const [indexes] = await db.query('SHOW INDEX FROM thirteenth_month_pay')
  if (indexes.some(row => row.Key_name === 'uq_13thmonth_emp_year')) await db.query('ALTER TABLE thirteenth_month_pay DROP INDEX uq_13thmonth_emp_year, ADD UNIQUE KEY uq_thirteenth_employee_agency_year(EmployeeID,AgencyID,PayYear)')
  console.log('13th-month workflow ready. No payroll or benefit amounts were created or changed.')
} finally { await db.end() }
