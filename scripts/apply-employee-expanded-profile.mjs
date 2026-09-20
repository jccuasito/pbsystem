import fs from 'node:fs'
import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database
})

try {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'employee' AND COLUMN_NAME = 'PhotoPath'",
    [database]
  )
  if (Number(rows[0]?.count || 0)) {
    console.log('Employee expanded profile migration already applied.')
  } else {
    await connection.query(fs.readFileSync('database/employee-expanded-profile.sql', 'utf8'))
    console.log('Employee expanded profile migration applied.')
  }
} finally {
  await connection.end()
}
