import fs from 'node:fs'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  const backup = await createDatabaseBackup('before-billing-workflow')
  console.log('Database backup:', backup.name)
  await db.query(fs.readFileSync(new URL('../database/billing-workflow.sql', import.meta.url), 'utf8'))
  console.log('Finalized billing status enabled. Existing bill statuses and amounts are unchanged.')
} finally { await db.end() }
