import fs from 'node:fs'
import mysql from 'mysql2/promise'
const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  await db.query(fs.readFileSync('database/employee-position-changes.sql', 'utf8'))
  console.log('Employee position history is ready. Existing employee records retained.')
} finally { await db.end() }
