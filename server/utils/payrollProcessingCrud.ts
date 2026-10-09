import { getQuery, getRouterParam, readBody, createError } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { loadVersionMap, snapshotAtDate } from './rateVersions'
import { componentAmountCents, payrollHourComponents, payrollTimeDeductions, previewInstallment } from '../../shared/utils/payrollPreview'
import { recordDtrWorkflowEvent } from './dtrWorkflowAudit'

const hours = [...payrollHourComponents, ...payrollTimeDeductions].map(([column]) => column)
const pesos = (cents: number) => cents / 100

export async function payrollProcessingData(requestedStart = '', requestedEnd = '', connection: any = pool) {
  if ((requestedStart || requestedEnd) && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedEnd) || requestedStart > requestedEnd)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid payroll cutoff.' })
  }
  const [batches] = await connection.execute<any[]>(`SELECT d.BatchID, d.AgencyID, a.AgencyName, d.ClientID, c.ClientName,
      d.SiteID, s.SiteName, DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') AS PeriodStart,
      DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') AS PeriodEnd, d.Status,
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
  const [roster] = await connection.execute<any[]>(`SELECT de.BatchID, de.EmployeeID, e.EmployeeNumber,
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
  const rateIds = [...new Set(attendance.map(row => Number(row.PayrollRateID)).filter(Boolean))]
  const versions = await loadVersionMap(connection, 'payroll-rate', rateIds)
  const employeeIds = [...new Set(roster.map(row => Number(row.EmployeeID)))]
  const [accounts] = employeeIds.length ? await connection.execute<any[]>(`SELECT 'Loan' AS EntryType, el.EmployeeID,
      el.LoanID AS RecordID, lt.LoanName AS ItemName, el.RemainingBalance,
      el.MonthlyDeduction AS InstallmentAmount, DATE_FORMAT(el.RepaymentStartDate, '%Y-%m-%d') AS RepaymentStartDate,
      DATE_FORMAT(el.EndDate, '%Y-%m-%d') AS EndDate, el.RepaymentCutoff, el.IsPaused,
      DATE_FORMAT(el.ResumeDate, '%Y-%m-%d') AS ResumeDate, el.Status
    FROM employee_loan el INNER JOIN loan_type lt ON lt.LoanTypeID = el.LoanTypeID
    WHERE el.EmployeeID IN (${employeeIds.map(() => '?').join(', ')})
    UNION ALL
    SELECT 'Deduction', ed.EmployeeID, ed.EmployeeDeductionID, dt.DeductionName,
      ed.RemainingBalance, ed.InstallmentAmount, DATE_FORMAT(ed.RepaymentStartDate, '%Y-%m-%d'),
      DATE_FORMAT(ed.EndDate, '%Y-%m-%d'), ed.RepaymentCutoff, ed.IsPaused,
      DATE_FORMAT(ed.ResumeDate, '%Y-%m-%d'), ed.Status
    FROM employee_deduction ed INNER JOIN deduction_type dt ON dt.DeductionTypeID = ed.DeductionTypeID
    WHERE ed.EmployeeID IN (${employeeIds.map(() => '?').join(', ')})`, [...employeeIds, ...employeeIds]) : [[]]

  const rowsByEmployee = new Map<string, any[]>()
  for (const row of attendance) {
    const key = `${row.BatchID}:${row.EmployeeID}`
    if (!rowsByEmployee.has(key)) rowsByEmployee.set(key, [])
    rowsByEmployee.get(key)!.push(row)
  }
  const accountsByEmployee = new Map<number, any[]>()
  for (const account of accounts) {
    const id = Number(account.EmployeeID)
    if (!accountsByEmployee.has(id)) accountsByEmployee.set(id, [])
    accountsByEmployee.get(id)!.push(account)
  }
  // One employee can work at several sites in a cutoff. Assign an installment
  // to the site with the most saved attendance, so it is never counted twice.
  const deductionBatchByEmployee = new Map<number, number>()
  const attendanceCountByEmployeeBatch = new Map<string, number>()
  for (const row of attendance) {
    const key = `${row.EmployeeID}:${row.BatchID}`
    attendanceCountByEmployeeBatch.set(key, (attendanceCountByEmployeeBatch.get(key) || 0) + 1)
  }
  for (const person of roster) {
    const employeeId = Number(person.EmployeeID)
    const existing = deductionBatchByEmployee.get(employeeId)
    if (!existing || (attendanceCountByEmployeeBatch.get(`${employeeId}:${person.BatchID}`) || 0) > (attendanceCountByEmployeeBatch.get(`${employeeId}:${existing}`) || 0)) {
      deductionBatchByEmployee.set(employeeId, Number(person.BatchID))
    }
  }
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
      const deductions = (deductionBatchByEmployee.get(Number(person.EmployeeID)) === Number(batch.BatchID) ? accountsByEmployee.get(Number(person.EmployeeID)) || [] : []).map(account => ({
        entryType: account.EntryType, recordId: account.RecordID, name: account.ItemName,
        remainingBalance: Number(account.RemainingBalance || 0),
        amount: pesos(previewInstallment(account, batch.PeriodStart, batch.PeriodEnd)),
      })).filter(account => account.amount > 0)
      const accountDeductionCents = deductions.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)
      if (grossCents - timeDeductionCents - accountDeductionCents < 0) warnings.push('Deductions exceed computed earnings for this cutoff.')
      return { ...person, components: [...components.values()].map(item => ({ ...item, amount: pesos(item.amountCents), amountCents: undefined })),
        deductions, warnings: [...new Set(warnings)], gross: pesos(grossCents),
        timeDeductions: pesos(timeDeductionCents), accountDeductions: pesos(accountDeductionCents),
        netPreview: pesos(grossCents - timeDeductionCents - accountDeductionCents) }
    })
    return { ...batch, employees, peopleCount: employees.length,
      gross: pesos(employees.reduce((sum, person) => sum + Math.round(person.gross * 100), 0)),
      deductions: pesos(employees.reduce((sum, person) => sum + Math.round((person.timeDeductions + person.accountDeductions) * 100), 0)),
      netPreview: pesos(employees.reduce((sum, person) => sum + Math.round(person.netPreview * 100), 0)),
      warningCount: employees.reduce((sum, person) => sum + person.warnings.length, 0) }
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
    const stored = batch?.ReviewStatus === 'Approved' || batch?.ReviewStatus === 'Rejected'
      ? parseSnapshot(batch.SnapshotJson) : null
    const { SnapshotJson, ...metadata } = batch || {}
    return { ...site, ...(stored || {}), ...metadata, ReviewStatus: batch?.ReviewStatus || 'Pending',
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
  const action = body.action === 'approve' || body.action === 'reject' ? body.action : null
  if (!action) throw createError({ statusCode: 400, statusMessage: 'Choose approve or reject.' })
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
    if (action === 'approve' && review?.ReviewStatus === 'Approved') {
      throw createError({ statusCode: 409, statusMessage: 'This DTR was already approved for payroll.' })
    }
    if (review?.ReviewStatus === 'Rejected') {
      throw createError({ statusCode: 409, statusMessage: 'Recompute the corrected DTR before reviewing it again.' })
    }
    const data = await payrollProcessingData(batch.PeriodStart, batch.PeriodEnd, connection)
    const currentSite = data.sites.find(site => Number(site.BatchID) === batchId)
    if (!currentSite) throw createError({ statusCode: 409, statusMessage: 'Payroll breakdown is unavailable for this DTR.' })
    const { history, SnapshotJson, ...snapshot } = currentSite as any
    if (action === 'approve') {
      if (Number(snapshot.warningCount) > 0) {
        throw createError({ statusCode: 409, statusMessage: 'Resolve the pricing notes before approving this payroll cutoff.' })
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
      return { success: true, reviewStatus: 'Approved', dtrStatus: batch.Status }
    }
    const [[posted]] = await connection.execute<any[]>(`SELECT py.PayrollID FROM payroll py
      INNER JOIN attendance_dtr_employee de ON de.EmployeeID = py.EmployeeID AND de.BatchID = ?
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
