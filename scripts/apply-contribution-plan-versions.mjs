import mysql from 'mysql2/promise'

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  const [tables] = await db.execute(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agency_contribution_plan_version'`)
  if (!tables.length) {
    await db.query(`CREATE TABLE agency_contribution_plan_version (
      AgencyContributionVersionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      AgencyContributionID INT NOT NULL,
      EffectiveDate DATE NOT NULL,
      AmountPerCutoff DECIMAL(10,2) NOT NULL,
      DeductOn ENUM('First','Second','Both') NOT NULL,
      Reason VARCHAR(500) NOT NULL DEFAULT '',
      CreatedBy INT NOT NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_contribution_version_date (AgencyContributionID, EffectiveDate, AgencyContributionVersionID),
      CONSTRAINT fk_contribution_version_plan FOREIGN KEY (AgencyContributionID)
        REFERENCES agency_contribution_plan(AgencyContributionID) ON DELETE CASCADE,
      CONSTRAINT fk_contribution_version_user FOREIGN KEY (CreatedBy)
        REFERENCES \`user\`(UserID)
    )`)
  }
  console.log('Contribution plan versions are ready.')
} finally {
  await db.end()
}
