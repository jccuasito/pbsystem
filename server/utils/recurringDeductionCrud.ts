import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

const date = (value: unknown, label: string, optional = false) => {
  const text = String(value || '').trim()
  if (optional && !text) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw createError({ statusCode: 400, statusMessage: `Enter a valid ${label}.` })
  }
  return text
}

export async function listRecurringDeductions(event: any) {
  requireSession(event)
  const employeeId = Number(getQuery(event).employeeId)
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw createError({ statusCode: 400, statusMessage: 'Select an employee.' })
  const [items] = await pool.execute<any[]>(`SELECT r.RecurringDeductionID, r.EmployeeID, r.DeductionTypeID, d.DeductionName,
    d.DeductionCategory, c.AppliesTo AS CatalogKind, r.AmountPerCutoff, r.DeductOn,
    DATE_FORMAT(r.EffectiveStartDate, '%Y-%m-%d') AS EffectiveStartDate,
    DATE_FORMAT(r.EffectiveEndDate, '%Y-%m-%d') AS EffectiveEndDate,
    r.IsPaused, DATE_FORMAT(r.PauseStartDate, '%Y-%m-%d') AS PauseStartDate,
    DATE_FORMAT(r.ResumeDate, '%Y-%m-%d') AS ResumeDate, r.PauseReason, r.Status
    FROM employee_recurring_deduction r
    INNER JOIN deduction_type d ON d.DeductionTypeID = r.DeductionTypeID
    LEFT JOIN deduction_loan_classification c ON c.ClassificationID = d.ClassificationID
    WHERE r.EmployeeID = ? ORDER BY r.Status, d.DeductionName, r.RecurringDeductionID`, [employeeId])
  return { items }
}

export async function saveRecurringDeduction(event: any) {
  const session = requireSession(event)
  if (!['Admin', 'Supervisor'].includes(String(session.userType))) throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can change recurring deductions.' })
  const body = await readBody<Record<string, unknown>>(event) || {}
  const id = body.RecurringDeductionID ? Number(body.RecurringDeductionID) : null
  const employeeId = Number(body.EmployeeID)
  const typeId = Number(body.DeductionTypeID)
  const amount = Number(body.AmountPerCutoff)
  const cutoff = String(body.DeductOn || '')
  const start = date(body.EffectiveStartDate, 'start date')
  const end = date(body.EffectiveEndDate, 'end date', true)
  const status = String(body.Status || 'Active')
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !Number.isInteger(typeId) || typeId <= 0 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 99999999.99 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001 ||
      !['First', 'Second', 'Both'].includes(cutoff) || !['Active', 'Inactive'].includes(status) || (end && end < start!) ||
      (id !== null && (!Number.isInteger(id) || id <= 0))) {
    throw createError({ statusCode: 400, statusMessage: 'Check the employee, deduction, amount, cutoff, and effective dates.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[employee]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID = ? FOR UPDATE', [employeeId])
    const [[catalog]] = await connection.execute<any[]>(
      `SELECT d.DeductionTypeID FROM deduction_type d
       INNER JOIN deduction_loan_classification c ON c.ClassificationID = d.ClassificationID
       WHERE d.DeductionTypeID = ? AND d.Status = 'Active' AND c.Status = 'Active'
         AND c.AppliesTo IN ('Deduction', 'Contribution')`, [typeId],
    )
    if (!employee || !catalog) throw createError({ statusCode: 400, statusMessage: 'Select an existing employee and active deduction type.' })
    if (id) {
      const [[existing]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee_recurring_deduction WHERE RecurringDeductionID = ? FOR UPDATE', [id])
      if (!existing || Number(existing.EmployeeID) !== employeeId) throw createError({ statusCode: 404, statusMessage: 'Recurring deduction not found for this employee.' })
    }
    if (status === 'Active') {
      const [[duplicate]] = await connection.execute<any[]>(`SELECT RecurringDeductionID FROM employee_recurring_deduction
        WHERE EmployeeID = ? AND DeductionTypeID = ? AND Status = 'Active' AND RecurringDeductionID <> ?
          AND (EffectiveEndDate IS NULL OR EffectiveEndDate >= ?) AND (? IS NULL OR EffectiveStartDate <= ?)
          AND (DeductOn = 'Both' OR ? = 'Both' OR DeductOn = ?) LIMIT 1`,
      [employeeId, typeId, id || 0, start, end, end, cutoff, cutoff])
      if (duplicate) throw createError({ statusCode: 409, statusMessage: 'An active plan for this deduction already covers the same cutoff and dates.' })
    }
    if (id) {
      await connection.execute(`UPDATE employee_recurring_deduction SET DeductionTypeID = ?, AmountPerCutoff = ?, DeductOn = ?,
        EffectiveStartDate = ?, EffectiveEndDate = ?, Status = ? WHERE RecurringDeductionID = ?`,
      [typeId, amount, cutoff, start, end, status, id])
      await connection.commit()
      return { success: true, id }
    }
    const [result] = await connection.execute<any>(`INSERT INTO employee_recurring_deduction
      (EmployeeID, DeductionTypeID, AmountPerCutoff, DeductOn, EffectiveStartDate, EffectiveEndDate, Status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [employeeId, typeId, amount, cutoff, start, end, status])
    await connection.commit()
    return { success: true, id: result.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function setRecurringDeductionPause(event: any) {
  const session = requireSession(event)
  if (!['Admin', 'Supervisor'].includes(String(session.userType))) throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can pause recurring deductions.' })
  const body = await readBody<Record<string, unknown>>(event) || {}
  const id = Number(body.RecurringDeductionID)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Select a recurring deduction.' })
  const action = String(body.action || '')
  if (action === 'resume') {
    const [result] = await pool.execute<any>(`UPDATE employee_recurring_deduction SET IsPaused = 0,
      PauseStartDate = NULL, ResumeDate = NULL, PauseReason = NULL WHERE RecurringDeductionID = ? AND Status = 'Active'`, [id])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Active recurring deduction not found.' })
    return { success: true }
  }
  if (action !== 'pause') throw createError({ statusCode: 400, statusMessage: 'Select pause or resume.' })
  const start = date(body.PauseStartDate, 'pause date')
  const resume = date(body.ResumeDate, 'resume date', true)
  const reason = String(body.PauseReason || '').trim()
  if (resume && resume <= start!) throw createError({ statusCode: 400, statusMessage: 'Resume date must be after pause date.' })
  if (reason.length > 255) throw createError({ statusCode: 400, statusMessage: 'Reason is too long.' })
  const [result] = await pool.execute<any>(`UPDATE employee_recurring_deduction SET IsPaused = 1,
    PauseStartDate = ?, ResumeDate = ?, PauseReason = ? WHERE RecurringDeductionID = ? AND Status = 'Active'`,
  [start, resume, reason || null, id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Active recurring deduction not found.' })
  return { success: true }
}
