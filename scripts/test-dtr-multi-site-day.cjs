const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('different site DTRs may hold one employee/date while one DTR cannot duplicate it', { skip: process.env.MULTI_SITE_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    const [indexes] = await connection.query("SHOW INDEX FROM attendance WHERE Key_name = 'uq_attendance_emp_date_scope'")
    assert.equal(indexes.length, 3)
    const [[sample]] = await connection.execute(`SELECT source.EmployeeID, source.AttendanceDate, source.CreatedBy,
      target.BatchID, targetEnrollment.DeploymentID
      FROM attendance source
      INNER JOIN attendance_dtr sourceDtr ON sourceDtr.BatchID = source.BatchID
      INNER JOIN attendance_dtr_employee sourceEnrollment ON sourceEnrollment.BatchID = source.BatchID AND sourceEnrollment.EmployeeID = source.EmployeeID AND sourceEnrollment.AttendanceType = 'Reliever'
      INNER JOIN attendance_dtr target ON target.BatchID <> source.BatchID
        AND target.PeriodStart <= source.AttendanceDate AND target.PeriodEnd >= source.AttendanceDate
      INNER JOIN attendance_dtr_employee targetEnrollment ON targetEnrollment.BatchID = target.BatchID AND targetEnrollment.EmployeeID = source.EmployeeID
      LEFT JOIN attendance existing ON existing.BatchID = target.BatchID AND existing.EmployeeID = source.EmployeeID AND existing.AttendanceDate = source.AttendanceDate
      WHERE existing.AttendanceID IS NULL AND source.TimeIn IS NOT NULL AND source.TimeOut IS NOT NULL
        AND target.Status = 'Draft'
      LIMIT 1`)
    assert.ok(sample, 'A worked duty and a second Draft DTR with an empty same-day cell are needed for this test')
    const [[reliever]] = await connection.execute(`SELECT at.EmployeeID, at.AttendanceDate, s.SiteName,
      DATE_FORMAT(at.TimeIn, '%Y-%m-%d %H:%i:%s') AS TimeIn,
      DATE_FORMAT(at.TimeOut, '%Y-%m-%d %H:%i:%s') AS TimeOut
      FROM attendance at
      INNER JOIN attendance_dtr source ON source.BatchID = at.BatchID
      INNER JOIN attendance_dtr_employee source_enrollment ON source_enrollment.BatchID = at.BatchID AND source_enrollment.EmployeeID = at.EmployeeID
      INNER JOIN site s ON s.SiteID = source.SiteID
      WHERE at.BatchID <> ? AND at.EmployeeID = ? AND at.AttendanceDate = ?
        AND source_enrollment.AttendanceType = 'Reliever'`, [sample.BatchID, sample.EmployeeID, sample.AttendanceDate])
    assert.ok(reliever?.SiteName && reliever?.TimeIn && reliever?.TimeOut)
    await connection.beginTransaction()
    const [otherSiteRows] = await connection.execute(`SELECT at.AttendanceID, at.AttendanceDate, at.AttendanceStatus,
      DATE_FORMAT(at.TimeIn, '%Y-%m-%d %H:%i:%s') AS TimeIn,
      DATE_FORMAT(at.TimeOut, '%Y-%m-%d %H:%i:%s') AS TimeOut,
      s.SiteName
      FROM attendance at LEFT JOIN attendance_dtr ad ON ad.BatchID = at.BatchID
      LEFT JOIN site s ON s.SiteID = ad.SiteID
      WHERE at.EmployeeID = ? AND at.AttendanceDate BETWEEN ? AND ?
        AND (at.BatchID IS NULL OR at.BatchID <> ?) FOR UPDATE`,
    [sample.EmployeeID, sample.AttendanceDate, sample.AttendanceDate, sample.BatchID])
    assert.ok(otherSiteRows.some(row => row.SiteName && row.TimeIn && row.TimeOut))
    const columns = '(EmployeeID, DeploymentID, BatchID, AttendanceDate, AttendanceStatus, AttendanceType, TimeIn, TimeOut, RegularHours, IsManualEdit, CreatedBy)'
    const values = [sample.EmployeeID, sample.DeploymentID, sample.BatchID, sample.AttendanceDate, 'Present', 'Regular', `${sample.AttendanceDate} 19:00:00`, `${sample.AttendanceDate} 23:00:00`, 4, 1, sample.CreatedBy]
    await connection.execute(`INSERT INTO attendance ${columns} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values)
    const [[count]] = await connection.execute('SELECT COUNT(*) AS total FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ?', [sample.EmployeeID, sample.AttendanceDate])
    assert.equal(Number(count.total), 2)
    await assert.rejects(connection.execute(`INSERT INTO attendance ${columns} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values), error => error.code === 'ER_DUP_ENTRY')
  } finally {
    await connection.rollback()
    await connection.end()
  }
})
