import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  const { readFile } = await import('node:fs/promises')
  const sql = await readFile(new URL('../database/recurring-payroll-deductions.sql', import.meta.url), 'utf8')
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await connection.query(statement)
  console.log('Recurring payroll deduction schema ready.')
} finally {
  await connection.end()
}
