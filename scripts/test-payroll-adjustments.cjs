const assert = require('node:assert/strict')
const mysql = require('mysql2/promise')
const jwt = require('jsonwebtoken')

const baseUrl = process.env.PAYROLL_ADJUSTMENT_TEST_URL || 'http://127.0.0.1:3100'

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options)
  let body = null
  try { body = await response.json() } catch { body = {} }
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
  let createdId = null
  try {
    const [[user]] = await connection.query("SELECT UserID, Email, UserType FROM `user` WHERE Status = 'Active' AND UserType IN ('Admin', 'Supervisor') ORDER BY UserType = 'Admin' DESC, UserID LIMIT 1")
    assert.ok(user, 'An active Admin or Supervisor is required for the workflow test.')
    const [[candidate]] = await connection.query(`SELECT source.BatchID AS SourceBatchID, target.BatchID AS TargetBatchID,
      at.EmployeeID, DATE_FORMAT(at.AttendanceDate, '%Y-%m-%d') AS AttendanceDate
      FROM attendance at
      INNER JOIN attendance_dtr source ON source.BatchID = at.BatchID
      INNER JOIN employee_deployment ed ON ed.DeploymentID = at.DeploymentID
      INNER JOIN site_rate sr ON sr.SiteRateID = COALESCE(at.WorkSiteRateID, ed.SiteRateID)
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
      INNER JOIN attendance_dtr_employee targetRoster ON targetRoster.EmployeeID = at.EmployeeID
      INNER JOIN attendance_dtr target ON target.BatchID = targetRoster.BatchID
        AND target.AgencyID = source.AgencyID AND target.PeriodStart > source.PeriodEnd AND target.Status <> 'Locked'
      LEFT JOIN payroll_adjustment_line usedLine ON usedLine.SourceAttendanceID = at.AttendanceID
      WHERE usedLine.AdjustmentLineID IS NULL AND (
        COALESCE(at.RegularHours,0) + COALESCE(at.OTHours,0) + COALESCE(at.OTExtHours,0) +
        COALESCE(at.NightDiffHours,0) + COALESCE(at.RestDayHours,0) + COALESCE(at.RestDayOTHours,0) +
        COALESCE(at.LegalHolidayHours,0) + COALESCE(at.LegalHolidayOTHours,0) +
        COALESCE(at.SpecialHolidayHours,0) + COALESCE(at.SpecialHolidayOTHours,0)
      ) > 0
      ORDER BY source.PeriodStart, at.AttendanceDate, target.PeriodStart LIMIT 1`)
    assert.ok(candidate, 'A source attendance date and later target DTR are required for the workflow test.')
    const token = jwt.sign({ sub: user.UserID, email: user.Email, userType: user.UserType }, process.env.JWT_SECRET, { expiresIn: '10m', issuer: 'pbsystem', audience: 'pbsystem-web' })
    const headers = { cookie: `pbs_session=${token}`, 'content-type': 'application/json' }

    const list = await request(`/api/payroll/adjustments?targetBatchId=${candidate.TargetBatchID}&sourceBatchId=${candidate.SourceBatchID}&employeeId=${candidate.EmployeeID}`, { headers })
    assert.equal(list.response.status, 200, JSON.stringify(list.body))
    assert.ok(list.body.targetEmployees.some(item => Number(item.EmployeeID) === Number(candidate.EmployeeID)))
    assert.ok(list.body.sourceBatches.some(item => Number(item.BatchID) === Number(candidate.SourceBatchID)))
    assert.ok(Number(list.body.sourceBatches.find(item => Number(item.BatchID) === Number(candidate.SourceBatchID)).AttendanceCount) > 0)
    assert.ok(list.body.eligibleDates.some(item => item.AttendanceDate === candidate.AttendanceDate))
    assert.ok(Array.isArray(list.body.missedDates) && list.body.missedDates.some(item => item.SourceDate === candidate.AttendanceDate))
    assert.ok(Array.isArray(list.body.shiftCodes))
    const sourceOption = list.body.sourceBatches.find(item => Number(item.BatchID) === Number(candidate.SourceBatchID))
    const blankDay = list.body.missedDates.find(item => !Number(item.PayableHours) && !item.ExistingAdjustmentID)
    if (sourceOption.Status === 'Draft' && blankDay && list.body.shiftCodes.length) {
      const draftManual = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify({
        EmployeeID: candidate.EmployeeID, SourceBatchID: candidate.SourceBatchID, TargetBatchID: candidate.TargetBatchID,
        ManualDays: [{ SourceDate: blankDay.SourceDate, ShiftCodeID: list.body.shiftCodes[0].ShiftCodeID,
          RegularHours: 8, OTHours: 0, OTExtHours: 0, NightDiffHours: 0 }],
        VerificationReference: 'Automated test timesheet', Reason: 'Draft source must be corrected in its DTR.',
      }) })
      assert.equal(draftManual.response.status, 409, JSON.stringify(draftManual.body))
    }

    const create = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify({
      EmployeeID: candidate.EmployeeID,
      SourceBatchID: candidate.SourceBatchID,
      TargetBatchID: candidate.TargetBatchID,
      SourceDates: [candidate.AttendanceDate],
      Reason: 'Automated rollback-safe payroll adjustment workflow test.',
      Submit: true,
    }) })
    assert.equal(create.response.status, 200, JSON.stringify(create.body))
    createdId = Number(create.body.id)
    assert.ok(createdId > 0)
    assert.equal(create.body.status, 'For Approval')
    assert.ok(Number(create.body.lineCount) > 0)

    const approve = await request('/api/payroll/adjustments', { method: 'PUT', headers, body: JSON.stringify({ AdjustmentID: createdId, Action: 'approve' }) })
    assert.equal(approve.response.status, 200, JSON.stringify(approve.body))
    assert.equal(approve.body.status, 'Approved')

    const duplicate = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify({
      EmployeeID: candidate.EmployeeID,
      SourceBatchID: candidate.SourceBatchID,
      TargetBatchID: candidate.TargetBatchID,
      SourceDates: [candidate.AttendanceDate],
      Reason: 'Duplicate prevention test for the same source attendance.',
      Submit: false,
    }) })
    assert.equal(duplicate.response.status, 409, JSON.stringify(duplicate.body))

    const cancel = await request('/api/payroll/adjustments', { method: 'PUT', headers, body: JSON.stringify({ AdjustmentID: createdId, Action: 'cancel' }) })
    assert.equal(cancel.response.status, 200, JSON.stringify(cancel.body))
    assert.equal(cancel.body.status, 'Cancelled')
    await connection.query('DELETE FROM payroll_adjustment_line WHERE AdjustmentID = ?', [createdId])
    await connection.query('DELETE FROM payroll_adjustment WHERE AdjustmentID = ?', [createdId])
    createdId = null

    const emptyDates = await request('/api/payroll/adjustments', { method: 'POST', headers, body: JSON.stringify({
      EmployeeID: candidate.EmployeeID,
      SourceBatchID: candidate.SourceBatchID,
      TargetBatchID: candidate.TargetBatchID,
      SourceDates: [],
      Reason: 'Saved attendance is required test.',
      Submit: false,
    }) })
    assert.equal(emptyDates.response.status, 400, JSON.stringify(emptyDates.body))
    console.log(`Payroll adjustment workflow passed using DTR-${candidate.SourceBatchID} -> DTR-${candidate.TargetBatchID}; eligible-cutoff filtering, saved attendance, approval, and duplicate blocking passed.`)
  } finally {
    if (createdId) {
      await connection.beginTransaction()
      try {
        await connection.query('DELETE FROM payroll_adjustment_line WHERE AdjustmentID = ?', [createdId])
        await connection.query('DELETE FROM payroll_adjustment WHERE AdjustmentID = ?', [createdId])
        await connection.commit()
      } catch (error) { await connection.rollback(); throw error }
    }
    await connection.end()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
