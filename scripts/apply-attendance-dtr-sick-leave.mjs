import fs from 'node:fs'
import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
  multipleStatements: true,
})

try {
  await connection.query(fs.readFileSync('database/attendance-dtr-sick-leave.sql', 'utf8'))
  const [rows] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'AttendanceStatus'")
  console.log(`AttendanceStatus: ${rows[0]?.Type || 'not found'}`)
} finally {
  await connection.end()
}
