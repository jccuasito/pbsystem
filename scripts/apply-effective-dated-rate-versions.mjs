import fs from 'node:fs'
import mysql from 'mysql2/promise'

const sql = fs.readFileSync(new URL('../database/effective-dated-rate-versions.sql', import.meta.url), 'utf8')
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
  const [tables] = await connection.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('payroll_rate_version', 'billing_rate_version')
    ORDER BY table_name`)
  if (tables.length !== 2) throw new Error('Rate version tables were not created.')
  console.log(`Rate version schema ready: ${tables.map(row => row.table_name).join(', ')}`)
} finally {
  await connection.end()
}
