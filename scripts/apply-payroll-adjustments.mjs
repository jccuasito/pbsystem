import fs from 'node:fs'
import mysql from 'mysql2/promise'

const sql = fs.readFileSync(new URL('../database/payroll-adjustments.sql', import.meta.url), 'utf8')
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
  multipleStatements: true,
})

try {
  await connection.query(sql)
  const [[referenceColumn]] = await connection.query(`SELECT COUNT(*) AS ColumnCount FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payroll_adjustment' AND column_name = 'VerificationReference'`)
  if (!Number(referenceColumn.ColumnCount)) await connection.query(`ALTER TABLE payroll_adjustment ADD COLUMN VerificationReference VARCHAR(255) NULL AFTER Reason`)
  const [[entrySourceColumn]] = await connection.query(`SELECT COUNT(*) AS ColumnCount FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payroll_adjustment_line' AND column_name = 'EntrySource'`)
  if (!Number(entrySourceColumn.ColumnCount)) await connection.query(`ALTER TABLE payroll_adjustment_line ADD COLUMN EntrySource ENUM('DTR Snapshot', 'Manual Verification') NOT NULL DEFAULT 'DTR Snapshot' AFTER Description`)
  const [[attendanceColumn]] = await connection.query(`SELECT is_nullable AS IsNullable FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payroll_adjustment_line' AND column_name = 'SourceAttendanceID'`)
  if (attendanceColumn?.IsNullable !== 'YES') await connection.query(`ALTER TABLE payroll_adjustment_line MODIFY COLUMN SourceAttendanceID INT NULL`)
  const [tables] = await connection.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('payroll_adjustment', 'payroll_adjustment_line')
    ORDER BY table_name`)
  console.log(`Payroll adjustment schema ready: ${tables.map(item => item.table_name).join(', ')}`)
} finally {
  await connection.end()
}
