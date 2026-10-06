const assert = require('node:assert/strict')
const mysql = require('mysql2/promise')
const jwt = require('jsonwebtoken')

const baseUrl = process.env.PAYROLL_ADJUSTMENT_TEST_URL || 'http://127.0.0.1:3100'

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options)
  let body = {}
  try { body = await response.json() } catch {}
  return { response, body }
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'pbsystem',
  })
  let sourceBatchId = null
  const adjustmentIds = []
  try {
    const [[user]] = await connection.query("SELECT UserID, Email, UserType FROM `user` WHERE Status = 'Active' AND UserType IN ('Admin', 'Supervisor') ORDER BY UserType = 'Admin' DESC, UserID LIMIT 1")
    const [[candidate]] = await connection.query(`SELECT target.BatchID AS TargetBatchID, target.AgencyID, target.ClientID, target.SiteID,
      roster.EmployeeID, roster.DeploymentID
      FROM attendance_dtr target
      INNER JOIN attendance_dtr_employee roster ON roster.BatchID = target.BatchID
      INNER JOIN employee_deployment deployment ON deployment.DeploymentID = roster.DeploymentID
      INNER JOIN site_rate rate ON rate.SiteRateID = deployment.SiteRateID
      INNER JOIN payroll_rate payroll ON payroll.PayrollRateID = rate.PayrollRateID
      WHERE target.Status <> 'Locked' AND target.PeriodStart > '2000-01-15'
      ORDER BY target.BatchID DESC LIMIT 1`)
    assert.ok(user && candidate, 'An active reviewer and a target DTR employee with payroll rates are required.')

    const [source] = await connection.query(`INSERT INTO attendance_dtr
      (AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status, CreatedBy)
      VALUES (?, ?, ?, '2000-01-01', '2000-01-15', 'Approved', ?)`,
    [candidate.AgencyID, candidate.ClientID, candidate.SiteID, user.UserID])
    sourceBatchId = source.insertId
    await connection.query(`INSERT INTO attendance_dtr_employee
      (BatchID, EmployeeID, DeploymentID, CreatedBy) VALUES (?, ?, ?, ?)`,
    [sourceBatchId, candidate.EmployeeID, candidate.DeploymentID, user.UserID])

    const token = jwt.sign({ sub: user.UserID, email: user.Email, userType: user.UserType }, process.env.JWT_SECRET,
      { expiresIn: '10m', issuer: 'pbsystem', audience: 'pbsystem-web' })
    const headers = { cookie: `pbs_session=${token}`, 'content-type': 'application/json' }
    const list = await request(`/api/payroll/adjustments?targetBatchId=${candidate.TargetBatchID}&sourceBatchId=${sourceBatchId}&employeeId=${candidate.EmployeeID}`, { headers })
    assert.equal(list.response.status, 200, JSON.stringify(list.body))
    const missedDate = list.body.missedDates.find(day => !day.PayableHours && !day.ExistingAdjustmentID && !day.UnavailableReason)
    assert.ok(missedDate, 'The finalized source DTR should contain an eligible missed work date.')

    const payload = {
      EmployeeID: candidate.EmployeeID, SourceBatchID: sourceBatchId, TargetBatchID: candidate.TargetBatchID,
      ManualDays: [{ SourceDate: missedDate.SourceDate, ShiftCodeID: '',
        RegularHours: 8, OTHours: 4, OTExtHours: 1, NightDiffHours: 2 }],
      Reason: 'Verified missed day for automated workflow test.', Submit: true,
    }
    const created = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify(payload) })
    assert.equal(created.response.status, 200, JSON.stringify(created.body))
    adjustmentIds.push(Number(created.body.id))
    assert.equal(created.body.status, 'Ready for Payroll')
    assert.equal(Number(created.body.lineCount), 4)
    const [[savedAdjustment]] = await connection.query('SELECT VerificationReference FROM payroll_adjustment WHERE AdjustmentID = ?', [adjustmentIds[0]])
    assert.equal(savedAdjustment.VerificationReference, null)
    const [[savedDay]] = await connection.query(`SELECT ShiftCodeID, RegularHours, OTHours, OTExtHours, NightDiffHours
      FROM payroll_adjustment_manual_day WHERE AdjustmentID = ?`, [adjustmentIds[0]])
    assert.equal(savedDay.ShiftCodeID, null)
    assert.deepEqual([savedDay.RegularHours, savedDay.OTHours, savedDay.OTExtHours, savedDay.NightDiffHours].map(Number), [8, 4, 1, 2])

    const approval = await request('/api/payroll/adjustments', { method: 'PUT', headers,
      body: JSON.stringify({ AdjustmentID: adjustmentIds[0], Action: 'approve' }) })
    assert.equal(approval.response.status, 409, JSON.stringify(approval.body))
    const duplicate = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify(payload) })
    assert.equal(duplicate.response.status, 409, JSON.stringify(duplicate.body))
    const cancelled = await request('/api/payroll/adjustments', { method: 'PUT', headers,
      body: JSON.stringify({ AdjustmentID: adjustmentIds[0], Action: 'cancel' }) })
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body))
    assert.equal(cancelled.body.status, 'Cancelled')
    const recreated = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify(payload) })
    assert.equal(recreated.response.status, 200, JSON.stringify(recreated.body))
    adjustmentIds.push(Number(recreated.body.id))
    assert.equal(recreated.body.status, 'Ready for Payroll')
    console.log('Verified missed day workflow passed: direct hours, optional shift, no separate approval, duplicate claim, and cancellation release.')
  } finally {
    for (const id of adjustmentIds) {
      await connection.query('DELETE FROM payroll_adjustment_line WHERE AdjustmentID = ?', [id])
      await connection.query('DELETE FROM payroll_adjustment WHERE AdjustmentID = ?', [id])
    }
    if (sourceBatchId) await connection.query('DELETE FROM attendance_dtr WHERE BatchID = ?', [sourceBatchId])
    await connection.end()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
