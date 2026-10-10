import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  const [columns] = await connection.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agency_contribution_plan' AND COLUMN_NAME = 'SiteRateID'`)
  if (!columns.length) {
    await connection.query(`ALTER TABLE agency_contribution_plan
      ADD COLUMN SiteRateID INT NULL AFTER AgencyID,
      ADD KEY idx_agency_contribution_site_rate (SiteRateID, Status, DeductOn, EffectiveStartDate),
      ADD CONSTRAINT fk_agency_contribution_site_rate
        FOREIGN KEY (SiteRateID) REFERENCES site_rate(SiteRateID)`)
  }
  console.log('Site-rate contribution plans are ready.')
} finally {
  await connection.end()
}
