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
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [database, table, column],
  )
  return Number(rows[0]?.count || 0) > 0
}

async function hasTable(table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [database, table],
  )
  return Number(rows[0]?.count || 0) > 0
}

try {
  if (!await hasColumn('site_policy', 'AutoWDOEnabled')) {
    await connection.query('ALTER TABLE `site_policy` ADD COLUMN `AutoWDOEnabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `RelieverPositionOverrideEnabled`')
  }
  if (!await hasColumn('site_policy', 'SundayWDOOTEnabled')) {
    await connection.query('ALTER TABLE `site_policy` ADD COLUMN `SundayWDOOTEnabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `AutoWDOEnabled`')
  }

  const specialHolidayTableExists = await hasTable('site_special_holiday')
  await connection.query(`CREATE TABLE IF NOT EXISTS site_special_holiday (
    SiteSpecialHolidayID INT NOT NULL AUTO_INCREMENT,
    SiteID INT NOT NULL,
    HolidayID INT NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (SiteSpecialHolidayID),
    UNIQUE KEY uq_site_special_holiday (SiteID, HolidayID),
    KEY idx_site_special_holiday_holiday (HolidayID),
    CONSTRAINT fk_site_special_holiday_site FOREIGN KEY (SiteID) REFERENCES site (SiteID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_site_special_holiday_holiday FOREIGN KEY (HolidayID) REFERENCES holiday (HolidayID) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

  if (!specialHolidayTableExists) {
    await connection.query(`INSERT IGNORE INTO site_special_holiday (SiteID, HolidayID)
      SELECT s.SiteID, h.HolidayID FROM site s CROSS JOIN holiday h
      WHERE s.Status = 'Active' AND h.Status = 'Active' AND h.HolidayType = 'Special'`)
  }

  console.log('DTR site WDO and Special Holiday policy is ready.')
} finally {
  await connection.end()
}
