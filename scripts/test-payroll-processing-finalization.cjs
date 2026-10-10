const { test } = require('node:test')
const assert = require('node:assert/strict')

test('post BTR earnings, cancel and restore deductions/adjustments, then finalize again', {
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
  let sourceBatchId = null
  let deductionId = null
  let recurringId = null
  let adjustmentId = null
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
        AND NOT EXISTS (SELECT 1 FROM employee_recurring_deduction r WHERE r.EmployeeID = ed.EmployeeID AND r.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM payroll p WHERE p.EmployeeID = ed.EmployeeID AND p.DeploymentID = ed.DeploymentID AND p.StartDate = ? AND p.EndDate = ?)
      LIMIT 1`, [start, start, start, start, end])
    assert.ok(owner && worker, 'An active admin and account-free fixed employee are needed')
    const [sourceInsert] = await connection.execute(`INSERT INTO attendance_dtr
      (AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status, CreatedBy)
      VALUES (?, ?, ?, '2098-10-16', '2098-10-31', 'Draft', ?)`,
    [worker.AgencyID, worker.ClientID, worker.SiteID, owner.UserID])
    sourceBatchId = Number(sourceInsert.insertId)
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
    const [[deductionType]] = await connection.execute('SELECT DeductionTypeID FROM deduction_type LIMIT 1')
    assert.ok(deductionType, 'A deduction type is needed to verify balance restoration')
    const [deductionInsert] = await connection.execute(`INSERT INTO employee_deduction
      (EmployeeID, DeductionTypeID, AccountReference, Amount, RemainingBalance, InstallmentAmount,
       RepaymentStartDate, RepaymentCutoff, Status)
      VALUES (?, ?, ?, 30, 30, 20, ?, 'First', 'Active')`,
    [worker.EmployeeID, deductionType.DeductionTypeID, `DEDTEST${batchId}`, start])
    deductionId = Number(deductionInsert.insertId)
    const [adjustmentInsert] = await connection.execute(`INSERT INTO payroll_adjustment
      (EmployeeID, SourceBatchID, TargetBatchID, Reason, Status, TotalAmount, CreatedBy)
      VALUES (?, ?, ?, 'Verified prior period pay', 'Ready for Payroll', 10, ?)`,
    [worker.EmployeeID, sourceBatchId, batchId, owner.UserID])
    adjustmentId = Number(adjustmentInsert.insertId)
    await connection.execute(`INSERT INTO payroll_adjustment_line
      (AdjustmentID, SourceDate, ComponentCode, Description, EntrySource, Direction, Quantity, Rate, Amount)
      VALUES (?, '2098-10-31', 'RegularHours', 'Verified correction', 'Manual Verification', 'Earning', 1, 10, 10)`,
    [adjustmentId])
    const cookie = 'pbs_session=' + jwt.sign({ sub: owner.UserID, email: owner.Email, userType: owner.UserType },
      process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'pbsystem', audience: 'pbsystem-web' })
    const base = process.env.PAYROLL_WORKFLOW_TEST_URL || 'http://localhost:3100'
    const createRecurring = await fetch(`${base}/api/deductions-loans/recurring`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ EmployeeID: worker.EmployeeID, DeductionTypeID: deductionType.DeductionTypeID,
        AmountPerCutoff: 25, DeductOn: 'First', EffectiveStartDate: start, Status: 'Active' }),
    })
    const recurringResult = await createRecurring.json()
    assert.equal(createRecurring.status, 200, recurringResult.statusMessage || JSON.stringify(recurringResult))
    recurringId = Number(recurringResult.id)
    const duplicateRecurring = await fetch(`${base}/api/deductions-loans/recurring`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ EmployeeID: worker.EmployeeID, DeductionTypeID: deductionType.DeductionTypeID,
        AmountPerCutoff: 25, DeductOn: 'First', EffectiveStartDate: start, Status: 'Active' }),
    })
    assert.equal(duplicateRecurring.status, 409)
    const recurringList = await (await fetch(`${base}/api/deductions-loans/recurring?employeeId=${worker.EmployeeID}`, { headers: { cookie } })).json()
    assert.ok(recurringList.items.some(item => Number(item.RecurringDeductionID) === recurringId))
    const pauseRecurring = (action) => fetch(`${base}/api/deductions-loans/recurring`, {
      method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ RecurringDeductionID: recurringId, action, PauseStartDate: start }),
    })
    assert.equal((await pauseRecurring('pause')).status, 200)
    const pausedPreview = await (await fetch(`${base}/api/payroll/processing?periodStart=${start}&periodEnd=${end}`, { headers: { cookie } })).json()
    assert.equal(pausedPreview.sites.find(item => Number(item.BatchID) === batchId).employees[0].accountDeductions, 20)
    assert.equal((await pauseRecurring('resume')).status, 200)
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
    assert.equal(site.employees[0].accountDeductions, 45)
    const overrideUrl = `${base}/api/payroll/processing/${batchId}/deductions`
    const override = (action, entryType, recordId, reason = '') => fetch(overrideUrl, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action, employeeId: worker.EmployeeID, entryType, recordId, reason }),
    })
    assert.equal((await override('skip', 'Recurring', recurringId, 'Low duty days this cutoff')).status, 200)
    const skipped = await (await fetch(`${base}/api/payroll/processing?periodStart=${start}&periodEnd=${end}`, { headers: { cookie } })).json()
    const skippedPerson = skipped.sites.find(item => Number(item.BatchID) === batchId).employees[0]
    assert.equal(skippedPerson.accountDeductions, 20)
    assert.equal(skippedPerson.dueDeductions.find(item => item.entryType === 'Recurring').override.Reason, 'Low duty days this cutoff')
    assert.equal((await override('restore', 'Recurring', recurringId)).status, 200)
    assert.equal((await override('skip', 'Deduction', deductionId, 'Pause installment for this cutoff')).status, 200)
    assert.equal((await override('restore', 'Deduction', deductionId)).status, 200)
    assert.equal(site.employees[0].adjustments[0].amount, 10)
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
    const [[charged]] = await connection.execute('SELECT RemainingBalance FROM employee_deduction WHERE EmployeeDeductionID = ?', [deductionId])
    assert.equal(Number(charged.RemainingBalance), 10)
    const [[recurringPosted]] = await connection.execute("SELECT Amount FROM payroll_deduction WHERE PayrollID = ? AND ReferenceType = 'Recurring Deduction' AND ReferenceID = ?", [payroll.PayrollID, recurringId])
    assert.equal(Number(recurringPosted.Amount), 25)
    const cancelResponse = await fetch(`${base}/api/payroll/processing/${batchId}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: 'Incorrect approval, please recompute.' }),
    })
    const cancelResult = await cancelResponse.json()
    assert.equal(cancelResponse.status, 200, cancelResult.statusMessage || JSON.stringify(cancelResult))
    assert.equal(cancelResult.reviewStatus, 'Cancelled')
    assert.equal(cancelResult.dtrStatus, 'Draft')
    const [[restored]] = await connection.execute('SELECT RemainingBalance, Status FROM employee_deduction WHERE EmployeeDeductionID = ?', [deductionId])
    assert.equal(Number(restored.RemainingBalance), 30)
    assert.equal(restored.Status, 'Active')
    const [[oldPayroll]] = await connection.execute('SELECT Status FROM payroll WHERE PayrollID = ?', [payroll.PayrollID])
    assert.equal(oldPayroll.Status, 'Cancelled')
    const [[oldReceipt]] = await connection.execute('SELECT Status FROM employee_account_transaction WHERE PayrollID = ?', [payroll.PayrollID])
    assert.equal(oldReceipt.Status, 'Voided')
    const [[reopened]] = await connection.execute('SELECT Status, TargetPayrollID FROM payroll_adjustment WHERE AdjustmentID = ?', [adjustmentId])
    assert.equal(reopened.Status, 'Ready for Payroll')
    assert.equal(reopened.TargetPayrollID, null)
    assert.equal((await post()).status, 409)
    const cancelAgain = await fetch(`${base}/api/payroll/processing/${batchId}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: 'Duplicate cancellation check.' }),
    })
    assert.equal(cancelAgain.status, 409)
    const recomputeResponse = await fetch(`${base}/api/attendance/dtr/${batchId}/compute`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ target: 'payroll' }),
    })
    assert.equal(recomputeResponse.status, 200)
    assert.equal((await override('skip', 'Recurring', recurringId, 'Skip contribution on revised cutoff')).status, 200)
    const second = await post()
    assert.equal(second.status, 200, JSON.stringify(await second.json()))
    const [[active]] = await connection.execute("SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID = ? AND Status = 'Active'", [batchId])
    assert.equal(active.n, 1)
    const [[reapplied]] = await connection.execute('SELECT Status, PreAppliedStatus FROM payroll_adjustment WHERE AdjustmentID = ?', [adjustmentId])
    assert.equal(reapplied.Status, 'Applied')
    assert.equal(reapplied.PreAppliedStatus, 'Ready for Payroll')
    const [[currentPayroll]] = await connection.execute("SELECT PayrollID FROM payroll_processing_posting WHERE BatchID = ? AND Status = 'Active'", [batchId])
    const [[skippedPosting]] = await connection.execute("SELECT COUNT(*) AS n FROM payroll_deduction WHERE PayrollID = ? AND ReferenceType = 'Recurring Deduction'", [currentPayroll.PayrollID])
    assert.equal(skippedPosting.n, 0)
    await connection.execute("UPDATE payroll SET Status = 'Released' WHERE PayrollID = ?", [currentPayroll.PayrollID])
    const cancel = () => fetch(`${base}/api/payroll/processing/${batchId}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: 'Guard test for cancellation.' }),
    })
    assert.equal((await cancel()).status, 409)
    await connection.execute("UPDATE payroll SET Status = 'Approved' WHERE PayrollID = ?", [currentPayroll.PayrollID])
    await connection.execute('UPDATE employee_deduction SET RemainingBalance = 9 WHERE EmployeeDeductionID = ?', [deductionId])
    assert.equal((await cancel()).status, 409)
    await connection.execute('UPDATE employee_deduction SET RemainingBalance = 10 WHERE EmployeeDeductionID = ?', [deductionId])
  } finally {
    if (batchId) {
      await connection.execute('DELETE FROM attendance_dtr_btr WHERE BatchID = ?', [batchId])
      if (adjustmentId) {
        await connection.execute('DELETE FROM payroll_adjustment_line WHERE AdjustmentID = ?', [adjustmentId])
        await connection.execute('DELETE FROM payroll_adjustment WHERE AdjustmentID = ?', [adjustmentId])
      }
      const [posted] = await connection.execute('SELECT PayrollID FROM payroll_processing_posting WHERE BatchID = ?', [batchId])
      for (const row of posted) {
        await connection.execute('DELETE FROM employee_account_transaction WHERE PayrollID = ?', [row.PayrollID])
        await connection.execute('DELETE FROM payroll_detail WHERE PayrollID = ?', [row.PayrollID])
        await connection.execute('DELETE FROM payroll_deduction WHERE PayrollID = ?', [row.PayrollID])
      }
      await connection.execute('DELETE FROM payroll_processing_posting WHERE BatchID = ?', [batchId])
      for (const row of posted) await connection.execute('DELETE FROM payroll WHERE PayrollID = ?', [row.PayrollID])
      if (deductionId) await connection.execute('DELETE FROM employee_deduction WHERE EmployeeDeductionID = ?', [deductionId])
      if (recurringId) await connection.execute('DELETE FROM employee_recurring_deduction WHERE RecurringDeductionID = ?', [recurringId])
      await connection.execute('DELETE FROM payroll_deduction_override WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM dtr_workflow_event WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM payroll_processing_review WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr_employee WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr WHERE BatchID = ?', [batchId])
    }
    if (sourceBatchId) await connection.execute('DELETE FROM attendance_dtr WHERE BatchID = ?', [sourceBatchId])
    await connection.end()
  }
})
