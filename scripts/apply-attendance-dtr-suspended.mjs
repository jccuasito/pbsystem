import fs from 'node:fs'
import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})
try {
  const [[column]] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'AttendanceStatus'")
  const previous = "enum('Present','Absent','Late','Half-Day','On-Leave','Vacation Leave','Holiday','Rest Day','Reliever','Sick Leave')"
  const next = previous.slice(0, -1) + ",'Suspended')"
  if (![previous, next].includes(column?.Type)) throw new Error('Unexpected AttendanceStatus definition. Review the enum before applying this migration.')
  await connection.query(fs.readFileSync('database/attendance-dtr-suspended.sql', 'utf8'))
  console.log('Suspended attendance status is ready. Existing attendance records retained.')
} finally {
  await connection.end()
}
