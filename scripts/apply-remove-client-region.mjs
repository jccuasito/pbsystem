import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database,
})

async function hasColumn(table, column) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, table, column],
  )
  return Number(rows[0]?.count || 0) > 0
}

try {
  if (!await hasColumn('site', 'RegionID')) {
    throw new Error('site.RegionID is missing. Apply database/site-specific-rates.sql first.')
  }

  if (!await hasColumn('client', 'RegionID')) {
    console.log('Client region migration already applied.')
    process.exitCode = 0
  } else {
    await connection.execute(
      `UPDATE site s
       INNER JOIN client c ON c.ClientID = s.ClientID
       SET s.RegionID = c.RegionID
       WHERE s.RegionID IS NULL AND c.RegionID IS NOT NULL`,
    )

    const [missingRows] = await connection.execute('SELECT COUNT(*) AS count FROM site WHERE RegionID IS NULL')
    const missingSiteRegions = Number(missingRows[0]?.count || 0)
    if (missingSiteRegions) {
      throw new Error(`Assign a region to ${missingSiteRegions} site(s) before removing client.RegionID.`)
    }

    const [foreignKeys] = await connection.execute(
      `SELECT CONSTRAINT_NAME
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'client'
          AND COLUMN_NAME = 'RegionID'
          AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [database],
    )
    for (const row of foreignKeys) {
      const escapedName = String(row.CONSTRAINT_NAME).replaceAll('`', '``')
      await connection.query(`ALTER TABLE client DROP FOREIGN KEY \`${escapedName}\``)
    }

    await connection.query('ALTER TABLE client DROP COLUMN RegionID')
    console.log('Removed redundant client.RegionID. Site regions were preserved.')
  }
} finally {
  await connection.end()
}
