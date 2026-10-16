import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'

const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
const connection = await mysql.createConnection({
  host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root', password: env.DB_PASSWORD,
  database: env.DB_NAME || 'pbsystem',
})
try {
  const [columns] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'AttendanceScopeBatchID'")
  if (!columns.length) {
    await connection.query('ALTER TABLE attendance ADD COLUMN AttendanceScopeBatchID INT GENERATED ALWAYS AS (COALESCE(BatchID, 0)) PERSISTENT')
  }
  const [indexes] = await connection.query('SHOW INDEX FROM attendance')
  const names = new Set(indexes.map(row => row.Key_name))
  if (!names.has('uq_attendance_emp_date_scope')) {
    await connection.query('ALTER TABLE attendance ADD UNIQUE KEY uq_attendance_emp_date_scope (EmployeeID, AttendanceDate, AttendanceScopeBatchID)')
  }
  if (names.has('uq_attendance_emp_date')) {
    await connection.query('ALTER TABLE attendance DROP INDEX uq_attendance_emp_date')
  }
  console.log('Attendance now permits one row per employee, date, and DTR while retaining one pending HR-status row.')
} finally {
  await connection.end()
}
