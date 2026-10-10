import mysql from 'mysql2/promise'

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

const columns = [
  ['AgencyContributionVersionID', 'INT NULL'],
  ['CorrectionKind', "ENUM('Original','Version') NOT NULL DEFAULT 'Original'"],
  ['PreviousAmountPerCutoff', 'DECIMAL(10,2) NULL'],
  ['NewAmountPerCutoff', 'DECIMAL(10,2) NULL'],
  ['PreviousDeductOn', "ENUM('First','Second','Both') NULL"],
  ['NewDeductOn', "ENUM('First','Second','Both') NULL"],
]

try {
  for (const [name, definition] of columns) {
    const [[existing]] = await db.execute(`SELECT COUNT(*) AS total FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agency_contribution_plan_date_correction'
        AND COLUMN_NAME = ?`, [name])
    if (!Number(existing.total)) {
      // Names and definitions come only from the fixed list above.
      await db.query(`ALTER TABLE agency_contribution_plan_date_correction ADD COLUMN ${name} ${definition}`)
    }
  }
  const [[foreignKey]] = await db.execute(`SELECT COUNT(*) AS total FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_contribution_date_correction_version'`)
  if (!Number(foreignKey.total)) {
    await db.query(`ALTER TABLE agency_contribution_plan_date_correction
      ADD CONSTRAINT fk_contribution_date_correction_version FOREIGN KEY (AgencyContributionVersionID)
      REFERENCES agency_contribution_plan_version(AgencyContributionVersionID) ON DELETE CASCADE`)
  }
  console.log('Original contribution plan edit audit fields are ready.')
} finally {
  await db.end()
}
