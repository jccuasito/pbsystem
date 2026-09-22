import fs from 'node:fs'
import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database,
  multipleStatements: true,
})

try {
  const [columns] = await connection.execute(
    "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'employee' AND COLUMN_NAME = 'Beneficiaries'",
    [database],
  )
  const [indexes] = await connection.execute(
    "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'employee' AND INDEX_NAME IN ('uq_employee_email', 'uq_employee_contact_number')",
    [database],
  )

  if (!Number(columns[0]?.count || 0)) {
    await connection.query(fs.readFileSync('database/employee-beneficiaries-and-uniques.sql', 'utf8'))
    console.log('Employee beneficiaries and unique identifiers migration applied.')
  } else {
    const existingIndexes = new Set(indexes.map(row => row.INDEX_NAME))
    if (!existingIndexes.has('uq_employee_email')) await connection.query('ALTER TABLE employee ADD UNIQUE KEY uq_employee_email (Email)')
    if (!existingIndexes.has('uq_employee_contact_number')) await connection.query('ALTER TABLE employee ADD UNIQUE KEY uq_employee_contact_number (ContactNumber)')
    console.log('Employee beneficiaries and unique identifiers migration already applied.')
  }
} finally {
  await connection.end()
}
