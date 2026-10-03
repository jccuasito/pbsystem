import { createError, getQuery } from 'h3'
import type { PoolConnection } from 'mysql2/promise'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type EntryType = 'Loan' | 'Deduction'

type PostTransactionInput = {
  employeeId: number
  entryType: EntryType
  sourceRecordId: number
  payrollId: number
  transactionDate: string
  cutoffStartDate?: string | null
  cutoffEndDate?: string | null
  amount: number
  remarks?: string | null
}

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return id
}

function isoDate(value: unknown, label: string) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return text
}

function optionalIsoDate(value: unknown, label: string) {
  return value ? isoDate(value, label) : null
}

function postedAmount(value: unknown) {
  const amount = Math.round(Number(value) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) throw createError({ statusCode: 400, statusMessage: 'Transaction amount must be greater than zero.' })
  return amount
}

export async function postEmployeeAccountTransaction(connection: PoolConnection, input: PostTransactionInput) {
  const employeeId = positiveId(input.employeeId, 'Employee')
  const sourceRecordId = positiveId(input.sourceRecordId, 'Issuance')
  const transactionDate = isoDate(input.transactionDate, 'Transaction date')
  const cutoffStartDate = optionalIsoDate(input.cutoffStartDate, 'Cutoff start date')
  const cutoffEndDate = optionalIsoDate(input.cutoffEndDate, 'Cutoff end date')
  if (cutoffStartDate && cutoffEndDate && cutoffStartDate > cutoffEndDate) {
    throw createError({ statusCode: 400, statusMessage: 'Cutoff start date cannot be later than the cutoff end date.' })
  }
  const amount = postedAmount(input.amount)
  const payrollId = positiveId(input.payrollId, 'Payroll')
  const remarks = String(input.remarks || '').trim().slice(0, 255) || null
  const isLoan = input.entryType === 'Loan'
  const sourceSql = isLoan
    ? `SELECT el.EmployeeID, el.AccountReference, el.IssuanceCode, el.RemainingBalance AS BalanceBefore, el.Status,
              lt.LoanName AS ItemName, c.ClassificationName,
              CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
              e.EmployeeNumber, a.AgencyID, a.AgencyName, p.PositionName
         FROM employee_loan el
         INNER JOIN employee e ON e.EmployeeID = el.EmployeeID
         INNER JOIN loan_type lt ON lt.LoanTypeID = el.LoanTypeID
         LEFT JOIN deduction_loan_classification c ON c.ClassificationID = lt.ClassificationID
         LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
         LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
         LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
        WHERE el.LoanID = ? AND el.EmployeeID = ? LIMIT 1 FOR UPDATE`
    : `SELECT ed.EmployeeID, ed.AccountReference, ed.IssuanceCode, ed.RemainingBalance AS BalanceBefore, ed.Status,
              dt.DeductionName AS ItemName, c.ClassificationName,
              CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
              e.EmployeeNumber, a.AgencyID, a.AgencyName, p.PositionName
         FROM employee_deduction ed
         INNER JOIN employee e ON e.EmployeeID = ed.EmployeeID
         INNER JOIN deduction_type dt ON dt.DeductionTypeID = ed.DeductionTypeID
         LEFT JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
         LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
         LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
         LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
        WHERE ed.EmployeeDeductionID = ? AND ed.EmployeeID = ? LIMIT 1 FOR UPDATE`
  const [sourceRows] = await connection.execute<any[]>(sourceSql, [sourceRecordId, employeeId])
  const source = sourceRows[0]
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Employee issuance was not found.' })
  if (!source.AccountReference) throw createError({ statusCode: 409, statusMessage: 'The employee account reference is missing.' })
  if (source.Status !== 'Active') throw createError({ statusCode: 409, statusMessage: 'Only an active issuance can receive a deduction transaction.' })
  const [payrollRows] = await connection.execute<any[]>(
    `SELECT PayrollID, EmployeeID, Status,
            DATE_FORMAT(StartDate, '%Y-%m-%d') AS StartDate,
            DATE_FORMAT(EndDate, '%Y-%m-%d') AS EndDate,
            DATE_FORMAT(COALESCE(PayrollDate, EndDate), '%Y-%m-%d') AS PayrollDate
       FROM payroll
      WHERE PayrollID = ? AND EmployeeID = ? AND Status IN ('Approved', 'Released')
      LIMIT 1 FOR UPDATE`,
    [payrollId, employeeId],
  )
  const payroll = payrollRows[0]
  if (!payroll) {
    throw createError({ statusCode: 409, statusMessage: 'A deduction receipt can only be posted from an approved or released payroll.' })
  }
  if (transactionDate !== payroll.PayrollDate) {
    throw createError({ statusCode: 409, statusMessage: 'Transaction date must match the approved payroll date.' })
  }
  if ((cutoffStartDate && cutoffStartDate !== payroll.StartDate) || (cutoffEndDate && cutoffEndDate !== payroll.EndDate)) {
    throw createError({ statusCode: 409, statusMessage: 'Transaction cutoff must match the approved payroll cutoff.' })
  }
  const balanceBefore = Math.round(Number(source.BalanceBefore || 0) * 100) / 100
  if (amount > balanceBefore) throw createError({ statusCode: 409, statusMessage: 'Transaction amount cannot exceed the remaining balance.' })
  const balanceAfter = Math.round((balanceBefore - amount) * 100) / 100

  const [result] = await connection.execute<any>(
    `INSERT INTO employee_account_transaction
      (TransactionID, EmployeeID, EmployeeName, EmployeeNumber, AgencyID, AgencyName, PositionName,
       EntryType, SourceRecordID, AccountReference, IssuanceCode, ClassificationName, ItemName, PayrollID,
       TransactionDate, CutoffStartDate, CutoffEndDate, Amount, BalanceBefore, BalanceAfter, Status, Remarks)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Posted', ?)`,
    [employeeId, source.EmployeeName, source.EmployeeNumber, source.AgencyID, source.AgencyName, source.PositionName,
      input.entryType, sourceRecordId, source.AccountReference, source.IssuanceCode, source.ClassificationName, source.ItemName, payrollId,
      transactionDate, payroll.StartDate, payroll.EndDate, amount, balanceBefore, balanceAfter, remarks],
  )
  const transactionId = `TXN${transactionDate.replaceAll('-', '')}-${String(result.insertId).padStart(6, '0')}`
  await connection.execute(
    'UPDATE employee_account_transaction SET TransactionID = ? WHERE TransactionRecordID = ?',
    [transactionId, result.insertId],
  )
  if (isLoan) {
    await connection.execute(
      "UPDATE employee_loan SET RemainingBalance = ?, Status = CASE WHEN ? = 0 THEN 'Paid' ELSE Status END WHERE LoanID = ?",
      [balanceAfter, balanceAfter, sourceRecordId],
    )
  } else {
    await connection.execute(
      "UPDATE employee_deduction SET RemainingBalance = ?, Status = CASE WHEN ? = 0 THEN 'Completed' ELSE Status END WHERE EmployeeDeductionID = ?",
      [balanceAfter, balanceAfter, sourceRecordId],
    )
  }
  return { id: Number(result.insertId), transactionId, accountReference: source.AccountReference, balanceBefore, balanceAfter }
}

export async function listEmployeeAccountTransactions(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event) as Record<string, string | undefined>
  const search = String(query.search || '').trim()
  const entryType = String(query.entryType || '').trim()
  const status = String(query.status || '').trim()
  const agencyId = query.agencyId ? positiveId(query.agencyId, 'Agency') : null
  const dateFrom = query.dateFrom ? isoDate(query.dateFrom, 'Date from') : null
  const dateTo = query.dateTo ? isoDate(query.dateTo, 'Date to') : null
  if (dateFrom && dateTo && dateFrom > dateTo) throw createError({ statusCode: 400, statusMessage: 'Date from cannot be later than date to.' })
  if (entryType && !['Loan', 'Deduction'].includes(entryType)) throw createError({ statusCode: 400, statusMessage: 'Select a valid transaction type.' })
  if (status && !['Posted', 'Voided'].includes(status)) throw createError({ statusCode: 400, statusMessage: 'Select a valid transaction status.' })
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(String(query.pageSize || '25'), 10) || 25))
  const offset = (page - 1) * pageSize
  const where: string[] = []
  const params: Array<string | number> = []
  if (search) {
    const term = `%${search}%`
    where.push('(t.TransactionID LIKE ? OR t.AccountReference LIKE ? OR COALESCE(t.IssuanceCode, \'\') LIKE ? OR t.EmployeeName LIKE ? OR COALESCE(t.EmployeeNumber, \'\') LIKE ? OR t.ItemName LIKE ?)')
    params.push(term, term, term, term, term, term)
  }
  if (entryType) { where.push('t.EntryType = ?'); params.push(entryType) }
  if (status) { where.push('t.Status = ?'); params.push(status) }
  if (agencyId) { where.push('t.AgencyID = ?'); params.push(agencyId) }
  if (dateFrom) { where.push('t.TransactionDate >= ?'); params.push(dateFrom) }
  if (dateTo) { where.push('t.TransactionDate <= ?'); params.push(dateTo) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [items] = await pool.execute<any[]>(
    `SELECT t.TransactionRecordID, t.TransactionID, t.EmployeeID, t.EmployeeName, t.EmployeeNumber,
            t.AgencyID, t.AgencyName, t.PositionName, t.EntryType, t.SourceRecordID, t.AccountReference, t.IssuanceCode,
            t.ClassificationName, t.ItemName, t.PayrollID, py.Status AS PayrollStatus,
            DATE_FORMAT(t.TransactionDate, '%Y-%m-%d') AS TransactionDate,
            DATE_FORMAT(t.CutoffStartDate, '%Y-%m-%d') AS CutoffStartDate,
            DATE_FORMAT(t.CutoffEndDate, '%Y-%m-%d') AS CutoffEndDate,
            t.Amount, t.BalanceBefore, t.BalanceAfter, t.Status, t.Remarks, t.CreatedAt, t.VoidedAt
       FROM employee_account_transaction t
       INNER JOIN payroll py ON py.PayrollID = t.PayrollID AND py.Status IN ('Approved', 'Released')
       ${whereSql}
      ORDER BY t.TransactionDate DESC, t.TransactionRecordID DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [summaryRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS Total,
            COALESCE(SUM(t.EntryType = 'Loan'), 0) AS Loans,
            COALESCE(SUM(t.EntryType = 'Deduction'), 0) AS Deductions,
            COALESCE(SUM(CASE WHEN t.Status = 'Posted' THEN t.Amount ELSE 0 END), 0) AS TotalAmount
       FROM employee_account_transaction t
       INNER JOIN payroll py ON py.PayrollID = t.PayrollID AND py.Status IN ('Approved', 'Released')
       ${whereSql}`,
    params,
  )
  const [agencies] = await pool.execute<any[]>("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName")
  const summary = summaryRows[0] || { Total: 0, Loans: 0, Deductions: 0, TotalAmount: 0 }
  return {
    items,
    agencies,
    summary,
    pagination: { page, pageSize, total: Number(summary.Total || 0), pages: Math.max(1, Math.ceil(Number(summary.Total || 0) / pageSize)) },
  }
}
