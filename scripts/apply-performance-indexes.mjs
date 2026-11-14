import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

// Fixed identifiers only. --apply is deliberate; a bare invocation previews work.
const indexes = [
  ['employee', 'ix_employee_status_hired', ['Status', 'DateHired']],
  ['attendance', 'ix_attendance_date_status_employee', ['AttendanceDate', 'AttendanceStatus', 'EmployeeID']],
  ['billing', 'ix_billing_date', ['BillingDate']],
  ['payroll', 'ix_payroll_status_date', ['Status', 'PayrollDate']],
  ['payroll', 'ix_payroll_recent', ['PayrollDate', 'PayrollID']],
  ['attendance_dtr', 'ix_dtr_period_agency_site', ['PeriodStart', 'PeriodEnd', 'AgencyID', 'SiteID']],
  ['employee_loan', 'ix_employee_loan_status_end', ['Status', 'EndDate']],
]
const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
try {
  const [existing] = await db.execute('SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS ColumnsUsed FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME')
  const planned = indexes.filter(([table, , columns]) => !existing.some(row => row.TABLE_NAME === table && (row.ColumnsUsed === columns.join(',') || row.ColumnsUsed.startsWith(columns.join(',') + ','))))
  console.log(`${planned.length} additional performance indexes needed.`)
  for (const [table, name, columns] of planned) console.log(`${table}: ${name} (${columns.join(', ')})`)
  if (planned.length && process.argv.includes('--apply')) {
    await createDatabaseBackup('manual')
    console.log('Verified SQL backup created before schema changes.')
    await db.execute('SET SESSION lock_wait_timeout=10')
    for (const [table, name, columns] of planned) {
      await db.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns.map(column => `\`${column}\``).join(',')}), ALGORITHM=INPLACE, LOCK=NONE`)
      console.log(`Added ${name}`)
    }
  } else if (planned.length) console.log('Preview only. Run with --apply during a maintenance window to back up and add these indexes.')
} finally { await db.end() }
