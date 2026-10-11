import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../database/settings-access.sql', import.meta.url), 'utf8')
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem', multipleStatements: true
})
try { await connection.query(sql); console.log('Settings access migration applied.') }
finally { await connection.end() }
