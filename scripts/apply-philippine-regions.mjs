import mysql from 'mysql2/promise'

// PSA PSGC as of 30 September 2026: https://psa.gov.ph/classification/psgc/summary
// RegionCode stores the first two digits of the ten-digit PSGC code as text.
const regions = [
  ['01', 'REGION I (ILOCOS REGION)', 'REGION I'],
  ['02', 'REGION II (CAGAYAN VALLEY)', 'REGION II'],
  ['03', 'REGION III (CENTRAL LUZON)', 'REGION III'],
  ['04', 'REGION IV-A (CALABARZON)', 'REGION IV-A'],
  ['05', 'REGION V (BICOL REGION)', 'REGION V'],
  ['06', 'REGION VI (WESTERN VISAYAS)', 'REGION VI'],
  ['07', 'REGION VII (CENTRAL VISAYAS)', 'REGION VII'],
  ['08', 'REGION VIII (EASTERN VISAYAS)', 'REGION VIII'],
  ['09', 'REGION IX (ZAMBOANGA PENINSULA)', 'REGION IX'],
  ['10', 'REGION X (NORTHERN MINDANAO)', 'REGION X'],
  ['11', 'REGION XI (DAVAO REGION)', 'REGION XI'],
  ['12', 'REGION XII (SOCCSKSARGEN)', 'REGION XII'],
  ['13', 'NATIONAL CAPITAL REGION (NCR)', 'NCR'],
  ['14', 'CORDILLERA ADMINISTRATIVE REGION (CAR)', 'CAR'],
  ['16', 'REGION XIII (CARAGA)', 'REGION XIII'],
  ['17', 'MIMAROPA REGION', 'REGION IV-B'],
  ['18', 'NEGROS ISLAND REGION (NIR)', 'NIR'],
  ['19', 'BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)', 'BARMM'],
]

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  await connection.beginTransaction()
  const [rows] = await connection.execute('SELECT RegionID, RegionCode, RegionName FROM region FOR UPDATE')
  let inserted = 0
  let updated = 0

  for (const [code, name, legacyCode] of regions) {
    const matches = rows.filter(row => [code, legacyCode].includes(String(row.RegionCode).toUpperCase()))
    if (matches.length > 1) throw new Error(`Duplicate region records for PSGC code ${code}; resolve them before seeding.`)
    if (matches.length) {
      const row = matches[0]
      await connection.execute(
        "UPDATE region SET RegionCode = ?, RegionName = ?, Status = 'Active' WHERE RegionID = ?",
        [code, name, row.RegionID],
      )
      updated++
    } else {
      await connection.execute(
        "INSERT INTO region (RegionCode, RegionName, Status) VALUES (?, ?, 'Active')",
        [code, name],
      )
      inserted++
    }
  }

  await connection.commit()
  console.log(`Philippine regions synced: ${regions.length} official regions, ${updated} existing IDs preserved, ${inserted} added.`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
