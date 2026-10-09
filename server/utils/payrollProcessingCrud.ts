import { getQuery, getRouterParam, readBody, createError } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { loadVersionMap, snapshotAtDate } from './rateVersions'
import { componentAmountCents, fixedDeductionBatchByEmployee, payrollHourComponents, payrollTimeDeductions, previewInstallment } from '../../shared/utils/payrollPreview'
import { recordDtrWorkflowEvent } from './dtrWorkflowAudit'
import { postEmployeeAccountTransaction } from './employeeAccountTransactionCrud'

const hours = [...payrollHourComponents, ...payrollTimeDeductions].map(([column]) => column)
const pesos = (cents: number) => cents / 100

export async function payrollProcessingData(requestedStart = '', requestedEnd = '', connection: any = pool) {
  if ((requestedStart || requestedEnd) && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedEnd) || requestedStart > requestedEnd)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid payroll cutoff.' })
  }
  const [batches] = await connection.execute<any[]>(`SELECT d.BatchID, d.AgencyID, a.AgencyName, d.ClientID, c.ClientName,
      d.SiteID, s.SiteName, DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') AS PeriodStart,
      DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') AS PeriodEnd, d.Status,
      EXISTS (SELECT 1 FROM payroll_processing_posting pp WHERE pp.BatchID = d.BatchID) AS IsFinalized,
      review.ReviewStatus, review.SnapshotJson, review.RejectionReason,
      DATE_FORMAT(review.ApprovedAt, '%Y-%m-%d %H:%i:%s') AS ApprovedAt,
      DATE_FORMAT(review.RejectedAt, '%Y-%m-%d %H:%i:%s') AS RejectedAt,
      CONCAT_WS(' ', approver.FirstName, approver.LastName) AS ApprovedByName,
      CONCAT_WS(' ', rejector.FirstName, rejector.LastName) AS RejectedByName
    FROM attendance_dtr d
    INNER JOIN agency a ON a.AgencyID = d.AgencyID
    INNER JOIN client c ON c.ClientID = d.ClientID
    INNER JOIN site s ON s.SiteID = d.SiteID
    LEFT JOIN payroll_processing_review review ON review.BatchID = d.BatchID
    LEFT JOIN user approver ON approver.UserID = review.ApprovedBy
    LEFT JOIN user rejector ON rejector.UserID = review.RejectedBy
    WHERE d.Status IN ('Computed to Payroll', 'Computed to Both') OR review.ReviewStatus IN ('Approved', 'Rejected')
    ORDER BY d.PeriodStart DESC, d.BatchID DESC`)
  const cutoffs = [...new Map(batches.map(batch => [`${batch.PeriodStart}:${batch.PeriodEnd}`, { start: batch.PeriodStart, end: batch.PeriodEnd }])).values()]
  const selected = requestedStart ? batches.filter(batch => batch.PeriodStart === requestedStart && batch.PeriodEnd === requestedEnd)
    : batches.filter(batch => batch.PeriodStart === cutoffs[0]?.start && batch.PeriodEnd === cutoffs[0]?.end)
  if (!selected.length) return { cutoffs, selectedCutoff: requestedStart ? { start: requestedStart, end: requestedEnd } : cutoffs[0] || null, sites: [] }

  const ids = selected.map(batch => Number(batch.BatchID))
  const [roster] = await connection.execute<any[]>(`SELECT de.BatchID, de.EmployeeID, de.DeploymentID, de.IsPermanentSite, de.AttendanceType, e.EmployeeNumber,
      CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
      p.PositionName
    FROM attendance_dtr_employee de
    INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    WHERE de.BatchID IN (${ids.map(() => '?').join(', ')})
    ORDER BY e.LastName, e.FirstName, e.EmployeeID`, ids)
  const [attendance] = await connection.execute<any[]>(`SELECT at.BatchID, at.EmployeeID, at.AttendanceID,
      DATE_FORMAT(at.AttendanceDate, '%Y-%m-%d') AS WorkDate, at.AttendanceStatus,
      ${hours.map(column => `at.${column}`).join(', ')},
      pr.PayrollRateID, DATE_FORMAT(pr.EffectiveDate, '%Y-%m-%d') AS BaseEffectiveDate,
      ${[...new Set([...payrollHourComponents, ...payrollTimeDeductions].map(([, field]) => field)), 'Allowance'].map(field => `pr.${field}`).join(', ')}
    FROM attendance at
    INNER JOIN attendance_dtr_employee de ON de.BatchID = at.BatchID AND de.EmployeeID = at.EmployeeID
    LEFT JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
    LEFT JOIN site_rate sr ON sr.SiteRateID = COALESCE(at.WorkSiteRateID, ed.SiteRateID)
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    WHERE at.BatchID IN (${ids.map(() => '?').join(', ')})
    ORDER BY at.BatchID, at.EmployeeID, at.AttendanceDate`, ids)
  const [btrRows] = await connection.execute<any[]>(`SELECT b.BatchID, b.RelieverEmployeeID AS EmployeeID,
      DATE_FORMAT(b.AttendanceDate, '%Y-%m-%d') AS WorkDate, b.Hours,
      pr.PayrollRateID, DATE_FORMAT(pr.EffectiveDate, '%Y-%m-%d') AS BaseEffectiveDate, pr.RegularRate
    FROM attendance_dtr_btr b
    LEFT JOIN attendance_dtr_employee de ON de.BatchID = b.BatchID AND de.EmployeeID = b.RelieverEmployeeID
    LEFT JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
    LEFT JOIN site_rate sr ON sr.SiteRateID = COALESCE(
      (SELECT at.WorkSiteRateID FROM attendance at
        WHERE at.BatchID = b.BatchID AND at.EmployeeID = b.RelieverEmployeeID AND at.AttendanceDate = b.AttendanceDate
        ORDER BY at.AttendanceID DESC LIMIT 1), ed.SiteRateID)
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    WHERE b.BatchID IN (${ids.map(() => '?').join(', ')}) AND b.Status = 'Active'
    ORDER BY b.BatchID, b.RelieverEmployeeID, b.AttendanceDate, b.BTRID`, ids)
  const rateIds = [...new Set([...attendance, ...btrRows].map(row => Number(row.PayrollRateID)).filter(Boolean))]
  const versions = await loadVersionMap(connection, 'payroll-rate', rateIds)
  const employeeIds = [...new Set(roster.map(row => Number(row.EmployeeID)))]
  const [accounts] = employeeIds.length ? await connection.execute<any[]>(`SELECT 'Loan' AS EntryType, el.EmployeeID,
      el.LoanID AS RecordID, lt.LoanName AS ItemName, el.RemainingBalance,
      NULL AS AccountTypeID,
      el.MonthlyDeduction AS InstallmentAmount, DATE_FORMAT(el.RepaymentStartDate, '%Y-%m-%d') AS RepaymentStartDate,
      DATE_FORMAT(el.EndDate, '%Y-%m-%d') AS EndDate, el.RepaymentCutoff, el.IsPaused,
      DATE_FORMAT(el.PauseStartDate, '%Y-%m-%d') AS PauseStartDate,
      DATE_FORMAT(el.ResumeDate, '%Y-%m-%d') AS ResumeDate, el.Status
    FROM employee_loan el INNER JOIN loan_type lt ON lt.LoanTypeID = el.LoanTypeID
    WHERE el.EmployeeID IN (${employeeIds.map(() => '?').join(', ')})
    UNION ALL
    SELECT 'Deduction', ed.EmployeeID, ed.EmployeeDeductionID, dt.DeductionName,
      ed.RemainingBalance, ed.DeductionTypeID, ed.InstallmentAmount, DATE_FORMAT(ed.RepaymentStartDate, '%Y-%m-%d'),
      DATE_FORMAT(ed.EndDate, '%Y-%m-%d'), ed.RepaymentCutoff, ed.IsPaused,
      DATE_FORMAT(ed.PauseStartDate, '%Y-%m-%d'),
      DATE_FORMAT(ed.ResumeDate, '%Y-%m-%d'), ed.Status
    FROM employee_deduction ed INNER JOIN deduction_type dt ON dt.DeductionTypeID = ed.DeductionTypeID
    WHERE ed.EmployeeID IN (${employeeIds.map(() => '?').join(', ')})`, [...employeeIds, ...employeeIds]) : [[]]

  const rowsByEmployee = new Map<string, any[]>()
  for (const row of attendance) {
    const key = `${row.BatchID}:${row.EmployeeID}`
    if (!rowsByEmployee.has(key)) rowsByEmployee.set(key, [])
    rowsByEmployee.get(key)!.push(row)
  }
  const btrByEmployee = new Map<string, any[]>()
  for (const row of btrRows) {
    const key = `${row.BatchID}:${row.EmployeeID}`
    if (!btrByEmployee.has(key)) btrByEmployee.set(key, [])
    btrByEmployee.get(key)!.push(row)
  }
  const accountsByEmployee = new Map<number, any[]>()
  for (const account of accounts) {
    const id = Number(account.EmployeeID)
    if (!accountsByEmployee.has(id)) accountsByEmployee.set(id, [])
    accountsByEmployee.get(id)!.push(account)
  }
  // Charge an installment only on the employee's fixed-site DTR. Reliever
  // assignments at another site never carry their loan/deduction plan.
  const deductionBatchByEmployee = fixedDeductionBatchByEmployee(roster, attendance)
  const [adjustmentRows] = await connection.execute<any[]>(`SELECT pa.AdjustmentID, pa.TargetBatchID, pa.EmployeeID,
      pa.Status, pal.AdjustmentLineID, pal.Description, pal.Direction, pal.Quantity, pal.Amount
    FROM payroll_adjustment pa
    LEFT JOIN payroll_adjustment_line pal ON pal.AdjustmentID = pa.AdjustmentID
    WHERE pa.TargetBatchID IN (${ids.map(() => '?').join(', ')})
      AND pa.Status IN ('Draft', 'For Approval', 'Approved', 'Ready for Payroll')
    ORDER BY pa.AdjustmentID, pal.AdjustmentLineID`, ids)
  const adjustmentsByPerson = new Map<string, any[]>()
  for (const row of adjustmentRows) {
    const key = `${row.TargetBatchID}:${row.EmployeeID}`
    if (!adjustmentsByPerson.has(key)) adjustmentsByPerson.set(key, [])
    adjustmentsByPerson.get(key)!.push(row)
  }
  const [btrTotals] = await connection.execute<any[]>(`SELECT BatchID, COUNT(*) AS EntryCount, COALESCE(SUM(Hours), 0) AS CoverageHours
    FROM attendance_dtr_btr WHERE BatchID IN (${ids.map(() => '?').join(', ')}) AND Status = 'Active' GROUP BY BatchID`, ids)
  const btrByBatch = new Map(btrTotals.map(row => [Number(row.BatchID), row]))
  const sites = selected.map(batch => {
    const employees = roster.filter(person => Number(person.BatchID) === Number(batch.BatchID)).map(person => {
      const components = new Map<string, any>()
      const warnings: string[] = []
      let grossCents = 0; let timeDeductionCents = 0
      for (const day of rowsByEmployee.get(`${batch.BatchID}:${person.EmployeeID}`) || []) {
        const hasHours = hours.some(column => Number(day[column] || 0) > 0)
        if (!day.PayrollRateID || (hasHours && day.BaseEffectiveDate > day.WorkDate)) {
          if (hasHours) warnings.push(`${day.WorkDate}: no linked payroll rate effective on this date.`)
          continue
        }
        const rate = snapshotAtDate(day, versions.get(Number(day.PayrollRateID)) || [], day.WorkDate)
        if (['RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours'].some(column => Number(day[column] || 0) > 0)) {
          warnings.push('Rest-day holiday hours use the configured holiday rate; review the combined premium before approval.')
        }
        for (const [hourField, rateField, label] of payrollHourComponents) {
          const quantity = Number(day[hourField] || 0)
          if (!quantity) continue
          const amountCents = componentAmountCents(quantity, rate[rateField])
          const previous = components.get(hourField) || { code: hourField, label, hours: 0, amountCents: 0, direction: 'Earning' }
          previous.hours += quantity; previous.amountCents += amountCents
          components.set(hourField, previous); grossCents += amountCents
        }
        for (const [hourField, rateField, label] of payrollTimeDeductions) {
          const quantity = Number(day[hourField] || 0)
          if (!quantity) continue
          const amountCents = componentAmountCents(quantity, rate[rateField])
          const previous = components.get(hourField) || { code: hourField, label, hours: 0, amountCents: 0, direction: 'Deduction' }
          previous.hours += quantity; previous.amountCents += amountCents
          components.set(hourField, previous); timeDeductionCents += amountCents
        }
        if (Number(rate.Allowance || 0)) warnings.push('Configured allowance is excluded until its payout rule is defined.')
      }
      for (const coverage of btrByEmployee.get(`${batch.BatchID}:${person.EmployeeID}`) || []) {
        if (!coverage.PayrollRateID || coverage.BaseEffectiveDate > coverage.WorkDate) {
          warnings.push(`${coverage.WorkDate}: BTR has no linked payroll regular rate effective on this date.`)
          continue
        }
        const rate = snapshotAtDate(coverage, versions.get(Number(coverage.PayrollRateID)) || [], coverage.WorkDate)
        if (Number(rate.RegularRate || 0) <= 0) {
          warnings.push(`${coverage.WorkDate}: BTR regular rate must be greater than zero.`)
          continue
        }
        const quantity = Number(coverage.Hours || 0)
        const amountCents = componentAmountCents(quantity, rate.RegularRate)
        const previous = components.get('BTRHours') || { code: 'BTRHours', label: 'BTR (regular rate)', hours: 0, amountCents: 0, direction: 'Earning' }
        previous.hours += quantity; previous.amountCents += amountCents
        components.set('BTRHours', previous); grossCents += amountCents
      }
      const adjustmentRowsForPerson = adjustmentsByPerson.get(`${batch.BatchID}:${person.EmployeeID}`) || []
      if (adjustmentRowsForPerson.some(row => row.Status === 'Draft' || row.Status === 'For Approval')) {
        warnings.push('A prior-period adjustment is still awaiting approval or submission.')
      }
      const adjustments = adjustmentRowsForPerson.filter(row =>
        ['Approved', 'Ready for Payroll'].includes(row.Status) && row.AdjustmentLineID,
      ).map(row => ({ adjustmentId: row.AdjustmentID, lineId: row.AdjustmentLineID,
        description: row.Description, direction: row.Direction, hours: Number(row.Quantity || 0), amount: Number(row.Amount || 0) }))
      for (const item of adjustments) {
        if (item.direction === 'Earning') grossCents += Math.round(item.amount * 100)
        else timeDeductionCents += Math.round(item.amount * 100)
      }
      const deductions = (deductionBatchByEmployee.get(Number(person.EmployeeID)) === Number(batch.BatchID) ? accountsByEmployee.get(Number(person.EmployeeID)) || [] : []).map(account => ({
        entryType: account.EntryType, recordId: account.RecordID, name: account.ItemName,
        accountTypeId: account.AccountTypeID,
        remainingBalance: Number(account.RemainingBalance || 0),
        amount: pesos(previewInstallment(account, batch.PeriodStart, batch.PeriodEnd)),
      })).filter(account => account.amount > 0)
      const accountDeductionCents = deductions.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)
      if (grossCents - timeDeductionCents - accountDeductionCents < 0) warnings.push('Deductions exceed computed earnings for this cutoff.')
      return { ...person, components: [...components.values()].map(item => ({ ...item, amount: pesos(item.amountCents), amountCents: undefined })),
        adjustments, deductions, warnings: [...new Set(warnings)], gross: pesos(grossCents),
        timeDeductions: pesos(timeDeductionCents), accountDeductions: pesos(accountDeductionCents),
        netPreview: pesos(grossCents - timeDeductionCents - accountDeductionCents) }
    })
    const rosterIds = new Set(employees.map(person => Number(person.EmployeeID)))
    const siteWarnings = [
      ...(adjustmentRows.some(row => Number(row.TargetBatchID) === Number(batch.BatchID) && !rosterIds.has(Number(row.EmployeeID)))
        ? ['A prior-period adjustment belongs to an employee no longer enrolled in this DTR.'] : []),
      ...(btrRows.some(row => Number(row.BatchID) === Number(batch.BatchID) && !rosterIds.has(Number(row.EmployeeID)))
        ? ['A BTR reliever is not enrolled in this DTR. Add the reliever before finalizing payroll.'] : []),
    ]
    return { ...batch, employees, siteWarnings, peopleCount: employees.length,
      btrEntryCount: Number(btrByBatch.get(Number(batch.BatchID))?.EntryCount || 0),
      btrCoverageHours: Number(btrByBatch.get(Number(batch.BatchID))?.CoverageHours || 0),
      gross: pesos(employees.reduce((sum, person) => sum + Math.round(person.gross * 100), 0)),
      deductions: pesos(employees.reduce((sum, person) => sum + Math.round((person.timeDeductions + person.accountDeductions) * 100), 0)),
      netPreview: pesos(employees.reduce((sum, person) => sum + Math.round(person.netPreview * 100), 0)),
      warningCount: siteWarnings.length + employees.reduce((sum, person) => sum + person.warnings.length, 0) }
  })
  const [events] = await connection.execute<any[]>(`SELECT EventID, BatchID, Action, PreviousDtrStatus, NextDtrStatus,
    ActorName, ActorRole, ActorDepartment, Reason, DATE_FORMAT(CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt
    FROM dtr_workflow_event WHERE BatchID IN (${ids.map(() => '?').join(', ')})
    ORDER BY EventID DESC`, ids)
  const historyByBatch = new Map<number, any[]>()
  for (const event of events) {
    const id = Number(event.BatchID)
    if (!historyByBatch.has(id)) historyByBatch.set(id, [])
    historyByBatch.get(id)!.push(event)
  }
  return { cutoffs, selectedCutoff: requestedStart ? { start: requestedStart, end: requestedEnd } : cutoffs[0], sites: sites.map(site => {
    const batch = selected.find(item => Number(item.BatchID) === Number(site.BatchID))
    const stored = batch?.IsFinalized || batch?.ReviewStatus === 'Rejected'
      ? parseSnapshot(batch.SnapshotJson) : null
    const { SnapshotJson, ...metadata } = batch || {}
    return { ...site, ...(stored || {}), ...metadata,
      ReviewStatus: batch?.ReviewStatus === 'Approved' && !batch.IsFinalized ? 'Pending' : batch?.ReviewStatus || 'Pending',
      history: historyByBatch.get(Number(site.BatchID)) || [] }
  }) }
}

function parseSnapshot(value: unknown) {
  try { return typeof value === 'string' ? JSON.parse(value) : value && typeof value === 'object' ? value : null }
  catch { return null }
}

export async function listPayrollProcessing(event: any) {
  const session = requireSession(event)
  const query = getQuery(event)
  const result = await payrollProcessingData(String(query.periodStart || ''), String(query.periodEnd || ''))
  return { ...result, permissions: { canReview: ['Admin', 'Supervisor'].includes(String(session.userType)) } }
}

export async function reviewPayrollProcessing(event: any) {
  const session = requireSession(event)
  if (!['Admin', 'Supervisor'].includes(String(session.userType))) {
    throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can approve or reject payroll processing.' })
  }
  const batchId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(batchId) || batchId <= 0) throw createError({ statusCode: 400, statusMessage: 'Select a valid DTR.' })
  const body = await readBody<{ action?: unknown; reason?: unknown }>(event) || {}
  const action = body.action === 'finalize' || body.action === 'reject' ? body.action : null
  if (!action) throw createError({ statusCode: 400, statusMessage: 'Choose finalize or reject.' })
  const reason = String(body.reason || '').trim()
  if (action === 'reject' && (reason.length < 5 || reason.length > 500)) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a rejection reason of 5–500 characters.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[batch]] = await connection.execute<any[]>(`SELECT BatchID, Status,
      DATE_FORMAT(PeriodStart, '%Y-%m-%d') AS PeriodStart,
      DATE_FORMAT(PeriodEnd, '%Y-%m-%d') AS PeriodEnd
      FROM attendance_dtr WHERE BatchID = ? FOR UPDATE`, [batchId])
    if (!batch) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
    if (!['Computed to Payroll', 'Computed to Both'].includes(batch.Status)) {
      throw createError({ statusCode: 409, statusMessage: 'Only a DTR computed to payroll can be reviewed.' })
    }
    const [[review]] = await connection.execute<any[]>(
      'SELECT ReviewStatus, SnapshotJson FROM payroll_processing_review WHERE BatchID = ? FOR UPDATE', [batchId],
    )
    const [existingPostings] = await connection.execute<any[]>(
      'SELECT PayrollID FROM payroll_processing_posting WHERE BatchID = ? LIMIT 1 FOR UPDATE', [batchId],
    )
    if (existingPostings.length) {
      throw createError({ statusCode: 409, statusMessage: 'This DTR is already finalized. Posted payroll must be reversed through payroll history.' })
    }
    if (review?.ReviewStatus === 'Rejected') {
      throw createError({ statusCode: 409, statusMessage: 'Recompute the corrected DTR before reviewing it again.' })
    }
    const data = await payrollProcessingData(batch.PeriodStart, batch.PeriodEnd, connection)
    const currentSite = data.sites.find(site => Number(site.BatchID) === batchId)
    if (!currentSite) throw createError({ statusCode: 409, statusMessage: 'Payroll breakdown is unavailable for this DTR.' })
    const { history, SnapshotJson, ...snapshot } = currentSite as any
    if (action === 'finalize') {
      if (Number(snapshot.warningCount) > 0) {
        throw createError({ statusCode: 409, statusMessage: 'Resolve the payroll notes before finalizing this cutoff.' })
      }
      if (!snapshot.employees.length) throw createError({ statusCode: 409, statusMessage: 'Add employees before finalizing this DTR.' })
      const [[priorPayroll]] = await connection.execute<any[]>(`SELECT py.PayrollID FROM payroll py
        INNER JOIN attendance_dtr_employee de ON de.DeploymentID = py.DeploymentID AND de.EmployeeID = py.EmployeeID
        WHERE de.BatchID = ? AND py.PayrollType = 'Regular' AND py.StartDate = ? AND py.EndDate = ? LIMIT 1 FOR UPDATE`,
      [batchId, batch.PeriodStart, batch.PeriodEnd])
      if (priorPayroll) throw createError({ statusCode: 409, statusMessage: 'A payroll record already exists for this DTR deployment and cutoff.' })
      for (const person of snapshot.employees) {
        if (!Number(person.DeploymentID)) throw createError({ statusCode: 409, statusMessage: 'An employee has no deployment for payroll.' })
        const [insert] = await connection.execute<any>(`INSERT INTO payroll
          (EmployeeID, DeploymentID, PayrollType, StartDate, EndDate, PayrollDate,
            GrossPay, Allowance, TotalDeduction, NetPay, Status)
          VALUES (?, ?, 'Regular', ?, ?, ?, ?, 0, ?, ?, 'Approved')`,
        [person.EmployeeID, person.DeploymentID, batch.PeriodStart, batch.PeriodEnd, batch.PeriodEnd,
          person.gross, Number(person.timeDeductions) + Number(person.accountDeductions), person.netPreview])
        const payrollId = Number(insert.insertId)
        await connection.execute(`INSERT INTO payroll_processing_posting (BatchID, EmployeeID, PayrollID) VALUES (?, ?, ?)`,
          [batchId, person.EmployeeID, payrollId])
        for (const line of person.components) {
          await connection.execute(`INSERT INTO payroll_detail (PayrollID, Description, Quantity, Rate, Amount)
            VALUES (?, ?, ?, ?, ?)`, [payrollId, line.label, line.hours,
            line.hours ? Math.round(Number(line.amount) / Number(line.hours) * 100) / 100 : 0,
            line.direction === 'Deduction' ? -Number(line.amount) : Number(line.amount)])
        }
        for (const line of person.adjustments) {
          await connection.execute(`INSERT INTO payroll_detail (PayrollID, Description, Quantity, Rate, Amount)
            VALUES (?, ?, ?, ?, ?)`, [payrollId, `Adjustment #${line.adjustmentId}: ${line.description}`.slice(0, 150),
            line.hours, line.hours ? Math.round(Number(line.amount) / Number(line.hours) * 100) / 100 : 0,
            line.direction === 'Deduction' ? -Number(line.amount) : Number(line.amount)])
        }
        for (const deduction of person.deductions) {
          if (deduction.entryType === 'Deduction') {
            await connection.execute(`INSERT INTO payroll_deduction
              (PayrollID, DeductionTypeID, ReferenceID, ReferenceType, Amount) VALUES (?, ?, ?, 'Employee Deduction', ?)`,
            [payrollId, deduction.accountTypeId, deduction.recordId, deduction.amount])
          } else {
            await connection.execute(`INSERT INTO payroll_detail (PayrollID, Description, Quantity, Rate, Amount)
              VALUES (?, ?, 1, ?, ?)`, [payrollId, `Loan: ${deduction.name}`.slice(0, 150),
              deduction.amount, -Number(deduction.amount)])
          }
          await postEmployeeAccountTransaction(connection, { employeeId: Number(person.EmployeeID),
            entryType: deduction.entryType, sourceRecordId: Number(deduction.recordId), payrollId,
            transactionDate: batch.PeriodEnd, cutoffStartDate: batch.PeriodStart,
            cutoffEndDate: batch.PeriodEnd, amount: Number(deduction.amount) })
        }
        const adjustmentIds = [...new Set(person.adjustments.map((line: any) => Number(line.adjustmentId)))]
        for (const adjustmentId of adjustmentIds) {
          const [result] = await connection.execute<any>(`UPDATE payroll_adjustment
            SET Status = 'Applied', TargetPayrollID = ?, AppliedBy = ?, AppliedAt = NOW()
            WHERE AdjustmentID = ? AND TargetBatchID = ? AND EmployeeID = ?
              AND Status IN ('Approved', 'Ready for Payroll') AND TargetPayrollID IS NULL`,
          [payrollId, session.sub, adjustmentId, batchId, person.EmployeeID])
          if (!result.affectedRows) throw createError({ statusCode: 409, statusMessage: 'An adjustment changed. Refresh payroll processing.' })
        }
      }
      await connection.execute(`INSERT INTO payroll_processing_review
        (BatchID, ReviewStatus, SnapshotJson, ApprovedBy, ApprovedAt, RejectedBy, RejectedAt, RejectionReason)
        VALUES (?, 'Approved', ?, ?, NOW(), NULL, NULL, NULL)
        ON DUPLICATE KEY UPDATE ReviewStatus = 'Approved', SnapshotJson = VALUES(SnapshotJson),
          ApprovedBy = VALUES(ApprovedBy), ApprovedAt = VALUES(ApprovedAt),
          RejectedBy = NULL, RejectedAt = NULL, RejectionReason = NULL`,
      [batchId, JSON.stringify(snapshot), session.sub])
      await recordDtrWorkflowEvent(connection, { batchId, action: 'Approve Payroll',
        previousStatus: batch.Status, nextStatus: batch.Status, actorUserId: session.sub, snapshot })
      await connection.commit()
      return { success: true, reviewStatus: 'Approved', dtrStatus: batch.Status, payrollCount: snapshot.employees.length }
    }
    const [[posted]] = await connection.execute<any[]>(`SELECT py.PayrollID FROM payroll py
      INNER JOIN attendance_dtr_employee de ON de.EmployeeID = py.EmployeeID AND de.DeploymentID = py.DeploymentID AND de.BatchID = ?
      WHERE py.PayrollType = 'Regular' AND py.StartDate = ? AND py.EndDate = ? LIMIT 1`,
    [batchId, batch.PeriodStart, batch.PeriodEnd])
    if (posted) throw createError({ statusCode: 409, statusMessage: 'A payroll record already exists for this cutoff. It must be reversed through payroll history.' })
    const savedSnapshot = review?.ReviewStatus === 'Approved' ? parseSnapshot(review.SnapshotJson) || snapshot : snapshot
    await connection.execute(`INSERT INTO payroll_processing_review
      (BatchID, ReviewStatus, SnapshotJson, ApprovedBy, ApprovedAt, RejectedBy, RejectedAt, RejectionReason)
      VALUES (?, 'Rejected', ?, NULL, NULL, ?, NOW(), ?)
      ON DUPLICATE KEY UPDATE ReviewStatus = 'Rejected', SnapshotJson = VALUES(SnapshotJson),
        RejectedBy = VALUES(RejectedBy), RejectedAt = VALUES(RejectedAt),
        RejectionReason = VALUES(RejectionReason)`,
    [batchId, JSON.stringify(savedSnapshot), session.sub, reason])
    await connection.execute("UPDATE attendance_dtr SET Status = 'Draft' WHERE BatchID = ?", [batchId])
    await recordDtrWorkflowEvent(connection, { batchId, action: 'Reject Payroll',
      previousStatus: batch.Status, nextStatus: 'Draft', actorUserId: session.sub, reason,
      snapshot: savedSnapshot })
    await connection.commit()
    return { success: true, reviewStatus: 'Rejected', dtrStatus: 'Draft' }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
