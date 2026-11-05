import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  const [[column]] = await connection.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [process.env.DB_NAME || 'pbsystem', 'attendance', 'ManualFieldOverrides'])
  const [[table]] = await connection.execute('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME || 'pbsystem', 'site_attendance_field_control'])
  if (!Number(column.n) || !Number(table.n)) {
    const backup = await createDatabaseBackup('before-attendance-field-controls')
    console.log('Database backup saved:', backup.name)
  }
  await connection.query(`CREATE TABLE IF NOT EXISTS site_attendance_field_control (
    SiteID INT NOT NULL PRIMARY KEY, EditableFields JSON NOT NULL, UpdatedBy INT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_attendance_fields_site FOREIGN KEY (SiteID) REFERENCES site (SiteID) ON DELETE CASCADE,
    CONSTRAINT fk_attendance_fields_actor FOREIGN KEY (UpdatedBy) REFERENCES \`user\` (UserID) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  if (!Number(column.n)) await connection.query('ALTER TABLE attendance ADD COLUMN ManualFieldOverrides JSON NULL')
  console.log('Attendance field controls ready. Existing records and site policies retain automatic defaults.')
} finally { await connection.end() }
