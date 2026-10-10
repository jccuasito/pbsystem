import { createError, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { payrollProcessingData } from './payrollProcessingCrud'

export async function changePayrollDeductionOverride(event: any) {
  const session = requireSession(event)
  if (!['Admin', 'Supervisor'].includes(String(session.userType))) throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can change payroll deductions.' })
  const batchId = Number(getRouterParam(event, 'id'))
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = Number(body.employeeId)
  const recordId = Number(body.recordId)
  const entryType = String(body.entryType || '')
  const action = String(body.action || '')
  const reason = String(body.reason || '').trim()
  if (![batchId, employeeId, recordId].every(value => Number.isInteger(value) && value > 0) ||
      !['Loan', 'Deduction', 'Recurring'].includes(entryType) || !['skip', 'restore'].includes(action) ||
      (action === 'skip' && (reason.length < 5 || reason.length > 500))) {
    throw createError({ statusCode: 400, statusMessage: 'Select a deduction and enter a reason of 5–500 characters to skip it.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[batch]] = await connection.execute<any[]>(`SELECT BatchID, Status,
      DATE_FORMAT(PeriodStart, '%Y-%m-%d') AS PeriodStart, DATE_FORMAT(PeriodEnd, '%Y-%m-%d') AS PeriodEnd
      FROM attendance_dtr WHERE BatchID = ? FOR UPDATE`, [batchId])
    if (!batch || !['Computed to Payroll', 'Computed to Both'].includes(batch.Status)) throw createError({ statusCode: 409, statusMessage: 'Compute the DTR to payroll before changing this cutoff.' })
    const [[posting]] = await connection.execute<any[]>("SELECT PostingID FROM payroll_processing_posting WHERE BatchID = ? AND Status = 'Active' LIMIT 1", [batchId])
    if (posting) throw createError({ statusCode: 409, statusMessage: 'Finalized payroll deductions cannot be changed.' })
    const [[active]] = await connection.execute<any[]>(`SELECT OverrideID FROM payroll_deduction_override
      WHERE BatchID = ? AND EmployeeID = ? AND EntryType = ? AND SourceRecordID = ? AND RemovedAt IS NULL
      ORDER BY OverrideID DESC LIMIT 1 FOR UPDATE`, [batchId, employeeId, entryType, recordId])
    if (action === 'restore') {
      if (!active) throw createError({ statusCode: 409, statusMessage: 'This deduction is not skipped.' })
      await connection.execute('UPDATE payroll_deduction_override SET RemovedBy = ?, RemovedAt = NOW() WHERE OverrideID = ?', [session.sub, active.OverrideID])
    } else {
      if (active) throw createError({ statusCode: 409, statusMessage: 'This deduction is already skipped.' })
      const data = await payrollProcessingData(batch.PeriodStart, batch.PeriodEnd, connection)
      const site = data.sites.find(item => Number(item.BatchID) === batchId)
      const person = site?.employees.find((item: any) => Number(item.EmployeeID) === employeeId)
      const due = person?.dueDeductions.find((item: any) => item.entryType === entryType && Number(item.recordId) === recordId && !item.override)
      if (!person || !due || !Number(person.IsPermanentSite) || person.AttendanceType === 'Reliever') {
        throw createError({ statusCode: 409, statusMessage: 'This item is not due on the employee’s fixed-site payroll for this cutoff.' })
      }
      await connection.execute(`INSERT INTO payroll_deduction_override
        (BatchID, EmployeeID, EntryType, SourceRecordID, Reason, CreatedBy) VALUES (?, ?, ?, ?, ?, ?)`,
      [batchId, employeeId, entryType, recordId, reason, session.sub])
    }
    await connection.commit()
    return { success: true, action }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
