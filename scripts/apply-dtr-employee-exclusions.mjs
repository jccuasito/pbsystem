import fs from 'node:fs'
import mysql from 'mysql2/promise'
const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  await db.query(fs.readFileSync('database/attendance-dtr-employee-exclusion.sql', 'utf8'))
  console.log('DTR cutoff removals are ready. Existing assignments and attendance retained.')
} finally { await db.end() }
