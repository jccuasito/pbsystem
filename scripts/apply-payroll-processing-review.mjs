import fs from 'node:fs'
import mysql from 'mysql2/promise'

const sql = fs.readFileSync(new URL('../database/payroll-processing-review.sql', import.meta.url), 'utf8')
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
  multipleStatements: true,
})
try {
  await connection.query(sql)
  const [columns] = await connection.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dtr_workflow_event'
      AND COLUMN_NAME IN ('ActorRole', 'ActorDepartment')`)
  const present = new Set(columns.map(column => column.COLUMN_NAME))
  if (!present.has('ActorRole')) await connection.query('ALTER TABLE dtr_workflow_event ADD COLUMN ActorRole VARCHAR(80) NULL AFTER ActorName')
  if (!present.has('ActorDepartment')) await connection.query('ALTER TABLE dtr_workflow_event ADD COLUMN ActorDepartment VARCHAR(150) NULL AFTER ActorRole')
  await connection.query(`UPDATE dtr_workflow_event event
    LEFT JOIN user actor ON actor.UserID = event.ActorUserID
    LEFT JOIN department department ON department.DepartmentID = actor.DepartmentID
    SET event.ActorRole = actor.UserType, event.ActorDepartment = department.DepartmentName
    WHERE event.ActorRole IS NULL AND actor.UserID IS NOT NULL`)
  console.log('Payroll processing review and DTR workflow history schema ready.')
} finally {
  await connection.end()
}
