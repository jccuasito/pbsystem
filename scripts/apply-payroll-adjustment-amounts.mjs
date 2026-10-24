import mysql from 'mysql2/promise'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Amount-only corrections have no original attendance or DTR. Keep those links
// null instead of inventing an attendance date or attaching the target as source.
export async function applyAmountAdjustmentSchema(connection) {
  const [columns] = await connection.query(`SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
    FROM information_schema.columns WHERE table_schema = DATABASE() AND
    ((table_name = 'payroll_adjustment' AND column_name = 'SourceBatchID') OR
     (table_name = 'payroll_adjustment_line' AND column_name IN ('SourceDate', 'EntrySource')))`)
  if (columns.length !== 3) throw new Error('Install the payroll adjustment schema first.')
  for (const column of columns) {
    if (column.TABLE_NAME === 'payroll_adjustment' && column.IS_NULLABLE !== 'YES') {
      await connection.query('ALTER TABLE payroll_adjustment MODIFY COLUMN SourceBatchID INT NULL')
    } else if (column.COLUMN_NAME === 'SourceDate' && column.IS_NULLABLE !== 'YES') {
      await connection.query('ALTER TABLE payroll_adjustment_line MODIFY COLUMN SourceDate DATE NULL')
    } else if (column.COLUMN_NAME === 'EntrySource' && !column.COLUMN_TYPE.includes("'Manual Amount'")) {
      await connection.query("ALTER TABLE payroll_adjustment_line MODIFY COLUMN EntrySource ENUM('DTR Snapshot', 'Manual Verification', 'Manual Amount') NOT NULL DEFAULT 'DTR Snapshot'")
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
  try {
    await applyAmountAdjustmentSchema(connection)
    console.log('Manual amount adjustments ready. Existing adjustment records retained.')
  } finally { await connection.end() }
}
