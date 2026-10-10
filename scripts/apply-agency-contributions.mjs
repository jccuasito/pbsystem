import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS agency_contribution_plan (
    AgencyContributionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    AgencyID INT NOT NULL,
    DeductionTypeID INT NOT NULL,
    AmountPerCutoff DECIMAL(10,2) NOT NULL,
    DeductOn ENUM('First','Second','Both') NOT NULL DEFAULT 'Second',
    EffectiveStartDate DATE NOT NULL,
    EffectiveEndDate DATE NULL,
    Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    CreatedBy INT NOT NULL,
    UpdatedBy INT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_agency_contribution_agency FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID),
    CONSTRAINT fk_agency_contribution_type FOREIGN KEY (DeductionTypeID) REFERENCES deduction_type(DeductionTypeID),
    CONSTRAINT fk_agency_contribution_creator FOREIGN KEY (CreatedBy) REFERENCES \`user\`(UserID),
    CONSTRAINT fk_agency_contribution_updater FOREIGN KEY (UpdatedBy) REFERENCES \`user\`(UserID),
    KEY idx_agency_contribution_due (AgencyID, Status, DeductOn, EffectiveStartDate)
  )`)
  const [rows] = await connection.execute(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_deduction_override' AND COLUMN_NAME = 'EntryType'`)
  if (!rows[0]) throw new Error('Apply recurring-payroll-deductions migration first.')
  if (!String(rows[0].COLUMN_TYPE).includes("'AgencyContribution'")) {
    await connection.query("ALTER TABLE payroll_deduction_override MODIFY EntryType ENUM('Loan','Deduction','Recurring','AgencyContribution') NOT NULL")
  }
  console.log('Agency contribution plans are ready.')
} finally {
  await connection.end()
}
