const { test } = require('node:test')
const assert = require('node:assert/strict')

test('post BTR regular-rate earnings and finalize an account-free DTR exactly once', {
  skip: process.env.PAYROLL_FINALIZATION_TEST_DATABASE !== '1',
}, async () => {
  const mysql = require('mysql2/promise')
  const jwt = require('jsonwebtoken')
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'pbsystem', timezone: 'Z',
  })
  const start = '2098-11-01', end = '2098-11-15'
  let batchId = null
  try {
    const [[owner]] = await connection.execute("SELECT UserID, Email, UserType FROM user WHERE UserType = 'Admin' AND Status = 'Active' LIMIT 1")
    const [[worker]] = await connection.execute(`SELECT ed.DeploymentID, ed.EmployeeID, ed.SiteID, s.ClientID, ap.AgencyID
      FROM employee_deployment ed
      INNER JOIN site_rate sr ON sr.SiteRateID = ed.SiteRateID
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
      INNER JOIN site s ON s.SiteID = ed.SiteID
      INNER JOIN employee e ON e.EmployeeID = ed.EmployeeID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      WHERE ed.IsPermanentSite = 1 AND ed.StartDate <= ? AND (ed.EndDate IS NULL OR ed.EndDate >= ?)
        AND pr.EffectiveDate <= ? AND COALESCE(pr.Allowance, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM employee_loan l WHERE l.EmployeeID = ed.EmployeeID AND l.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM employee_deduction d WHERE d.EmployeeID = ed.EmployeeID AND d.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM payroll p WHERE p.EmployeeID = ed.EmployeeID AND p.DeploymentID = ed.DeploymentID AND p.StartDate = ? AND p.EndDate = ?)
      LIMIT 1`, [start, start, start, start, end])
    assert.ok(owner && worker, 'An active admin and account-free fixed employee are needed')
    const [insert] = await connection.execute(`INSERT INTO attendance_dtr
      (AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status, CreatedBy)
      VALUES (?, ?, ?, ?, ?, 'Computed to Payroll', ?)`,
    [worker.AgencyID, worker.ClientID, worker.SiteID, start, end, owner.UserID])
    batchId = Number(insert.insertId)
    await connection.execute(`INSERT INTO attendance_dtr_employee
      (BatchID, EmployeeID, DeploymentID, AttendanceType, IsPermanentSite, CreatedBy)
      VALUES (?, ?, ?, 'Regular', 1, ?)`, [batchId, worker.EmployeeID, worker.DeploymentID, owner.UserID])
    await connection.execute(`INSERT INTO attendance
      (EmployeeID, DeploymentID, BatchID, AttendanceDate, AttendanceStatus, AttendanceType, RegularHours, CreatedBy)
      VALUES (?, ?, ?, ?, 'Present', 'Regular', 8, ?)`,
    [worker.EmployeeID, worker.DeploymentID, batchId, start, owner.UserID])
    const cookie = 'pbs_session=' + jwt.sign({ sub: owner.UserID, email: owner.Email, userType: owner.UserType },
      process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'pbsystem', audience: 'pbsystem-web' })
    const base = process.env.PAYROLL_WORKFLOW_TEST_URL || 'http://localhost:3100'
    const [[restWorker]] = await connection.execute(`SELECT ed.EmployeeID, ed.DeploymentID
      FROM employee_deployment ed INNER JOIN employee e ON e.EmployeeID = ed.EmployeeID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      WHERE ed.SiteID = ? AND ed.EmployeeID <> ? AND ap.AgencyID = ?
        AND ed.StartDate <= ? AND (ed.EndDate IS NULL OR ed.EndDate >= ?) LIMIT 1`,
    [worker.SiteID, worker.EmployeeID, worker.AgencyID, start, start])
    assert.ok(restWorker, 'A second same-site worker is needed to verify BTR payroll earnings')
    {
      await connection.execute(`INSERT INTO attendance_dtr_employee
        (BatchID, EmployeeID, DeploymentID, AttendanceType, IsPermanentSite, CreatedBy)
        VALUES (?, ?, ?, 'Regular', 1, ?)`, [batchId, restWorker.EmployeeID, restWorker.DeploymentID, owner.UserID])
      await connection.execute(`INSERT INTO attendance_dtr_btr
        (BatchID, AttendanceDate, ReplacedEmployeeID, RelieverEmployeeID, Hours, CreatedBy)
        VALUES (?, ?, ?, ?, 2, ?)`, [batchId, start, restWorker.EmployeeID, worker.EmployeeID, owner.UserID])
      const btrResponse = await fetch(`${base}/api/payroll/processing?periodStart=${start}&periodEnd=${end}`, { headers: { cookie } })
      const btrData = await btrResponse.json()
      assert.equal(btrResponse.status, 200, btrData.statusMessage || JSON.stringify(btrData))
      const btrSite = btrData.sites.find(item => Number(item.BatchID) === batchId)
      const btrLine = btrSite.employees.find(item => Number(item.EmployeeID) === Number(worker.EmployeeID))
        .components.find(item => item.code === 'BTRHours')
      assert.equal(btrLine.hours, 2)
      assert.ok(btrLine.amount > 0)
      await connection.execute('DELETE FROM attendance_dtr_btr WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ?', [batchId, restWorker.EmployeeID])
    }
    const get = await fetch(`${base}/api/payroll/processing?periodStart=${start}&periodEnd=${end}`, { headers: { cookie } })
    const data = await get.json()
    assert.equal(get.status, 200, data.statusMessage || JSON.stringify(data))
    const site = data.sites.find(item => Number(item.BatchID) === batchId)
    assert.ok(site)
    assert.equal(site.peopleCount, 1)
    assert.ok(site.gross > 0)
    assert.equal(site.warningCount, 0)
    const post = () => fetch(`${base}/api/payroll/processing/${batchId}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'finalize' }),
    })
    const response = await post(), result = await response.json()
    assert.equal(response.status, 200, result.statusMessage || JSON.stringify(result))
    assert.equal(result.payrollCount, 1)
    const [[payroll]] = await connection.execute(`SELECT p.PayrollID, p.GrossPay, p.NetPay, p.Status
      FROM payroll_processing_posting pp INNER JOIN payroll p ON p.PayrollID = pp.PayrollID
      WHERE pp.BatchID = ? AND pp.EmployeeID = ?`, [batchId, worker.EmployeeID])
    assert.equal(payroll.Status, 'Approved')
    assert.equal(Number(payroll.GrossPay), Number(site.gross))
    assert.equal(Number(payroll.NetPay), Number(site.netPreview))
    assert.equal((await post()).status, 409)
  } finally {
    if (batchId) {
      await connection.execute('DELETE FROM attendance_dtr_btr WHERE BatchID = ?', [batchId])
      const [posted] = await connection.execute('SELECT PayrollID FROM payroll_processing_posting WHERE BatchID = ?', [batchId])
      for (const row of posted) {
        await connection.execute('DELETE FROM payroll_detail WHERE PayrollID = ?', [row.PayrollID])
        await connection.execute('DELETE FROM payroll_deduction WHERE PayrollID = ?', [row.PayrollID])
      }
      await connection.execute('DELETE FROM payroll_processing_posting WHERE BatchID = ?', [batchId])
      for (const row of posted) await connection.execute('DELETE FROM payroll WHERE PayrollID = ?', [row.PayrollID])
      await connection.execute('DELETE FROM dtr_workflow_event WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM payroll_processing_review WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr_employee WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr WHERE BatchID = ?', [batchId])
    }
    await connection.end()
  }
})
