import mysql from 'mysql2/promise'

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  await db.query(`CREATE TABLE IF NOT EXISTS agency_contribution_plan_date_correction (
    AgencyContributionDateCorrectionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    AgencyContributionID INT NOT NULL,
    AgencyContributionVersionID INT NULL,
    CorrectionKind ENUM('Original','Version') NOT NULL DEFAULT 'Original',
    PreviousStartDate DATE NOT NULL,
    PreviousEndDate DATE NULL,
    NewStartDate DATE NOT NULL,
    NewEndDate DATE NULL,
    PreviousAmountPerCutoff DECIMAL(10,2) NULL,
    NewAmountPerCutoff DECIMAL(10,2) NULL,
    PreviousDeductOn ENUM('First','Second','Both') NULL,
    NewDeductOn ENUM('First','Second','Both') NULL,
    Reason VARCHAR(500) NOT NULL DEFAULT '',
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_contribution_date_correction_plan (AgencyContributionID, CreatedAt),
    CONSTRAINT fk_contribution_date_correction_plan FOREIGN KEY (AgencyContributionID)
      REFERENCES agency_contribution_plan(AgencyContributionID) ON DELETE CASCADE,
    CONSTRAINT fk_contribution_date_correction_version FOREIGN KEY (AgencyContributionVersionID)
      REFERENCES agency_contribution_plan_version(AgencyContributionVersionID) ON DELETE CASCADE,
    CONSTRAINT fk_contribution_date_correction_user FOREIGN KEY (CreatedBy)
      REFERENCES \`user\`(UserID)
  )`)
  console.log('Contribution plan date corrections are ready.')
} finally {
  await db.end()
}
