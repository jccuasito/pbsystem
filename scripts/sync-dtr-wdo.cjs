const mysql = require('mysql2/promise')

function databaseDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  return String(value || '').slice(0, 10)
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'pbsystem',
  })

  try {
    const [columns] = await connection.execute("SHOW COLUMNS FROM attendance LIKE 'IsWDO'")
    if (!columns.length) {
      await connection.execute(
        'ALTER TABLE attendance ADD COLUMN IsWDO TINYINT(1) NOT NULL DEFAULT 0 AFTER AttendanceType, ADD KEY idx_attendance_dtr_employee_wdo (BatchID, EmployeeID, IsWDO)',
      )
    }

    const [targets] = await connection.execute(
      'SELECT DISTINCT a.BatchID, a.EmployeeID, d.PeriodStart, d.PeriodEnd FROM attendance a INNER JOIN attendance_dtr d ON d.BatchID = a.BatchID',
    )
    let marked = 0

    for (const target of targets) {
      await connection.beginTransaction()
      try {
        const [worked] = await connection.execute(
          `SELECT AttendanceID
           FROM attendance
           WHERE BatchID = ? AND EmployeeID = ? AND AttendanceDate BETWEEN ? AND ?
             AND AttendanceStatus NOT IN ('Absent', 'Rest Day', 'On-Leave', 'Reliever')
           ORDER BY AttendanceDate DESC, AttendanceID DESC
           FOR UPDATE`,
          [
            target.BatchID,
            target.EmployeeID,
            databaseDate(target.PeriodStart),
            databaseDate(target.PeriodEnd),
          ],
        )
        const wdoCount = worked.length >= 15 ? 2 : worked.length >= 14 ? 1 : 0
        await connection.execute('UPDATE attendance SET IsWDO = 0 WHERE BatchID = ? AND EmployeeID = ?', [target.BatchID, target.EmployeeID])
        if (wdoCount) {
          const ids = worked.slice(0, wdoCount).map(row => row.AttendanceID)
          await connection.execute(`UPDATE attendance SET IsWDO = 1 WHERE AttendanceID IN (${ids.map(() => '?').join(', ')})`, ids)
        }
        await connection.commit()
        marked += wdoCount
      } catch (error) {
        await connection.rollback()
        throw error
      }
    }

    console.log(`IsWDO ready; recalculated ${targets.length} cutoff employee records; marked ${marked} WDO entries.`)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
