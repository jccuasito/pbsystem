import fs from 'node:fs'
import mysql from 'mysql2/promise'

const sql = fs.readFileSync(new URL('../database/payroll-processing-finalization.sql', import.meta.url), 'utf8')
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})
try {
  await connection.query(sql)
  console.log('Payroll finalization mapping ready.')
} finally {
  await connection.end()
}
