import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type EntryType = 'Loan' | 'Deduction'
type RepaymentCutoff = 'First' | 'Second' | 'Both'

const validEntryTypes = new Set<EntryType>(['Loan', 'Deduction'])
const validLoanStatuses = new Set(['Active', 'Paid', 'Cancelled'])
const validDeductionStatuses = new Set(['Active', 'Completed', 'Inactive'])
const validRepaymentCutoffs = new Set<RepaymentCutoff>(['First', 'Second', 'Both'])

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return id
}

function requiredText(value: unknown, label: string, max = 100) {
  const text = String(value ?? '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  if (text.length > max) throw createError({ statusCode: 400, statusMessage: `${label} must be ${max} characters or fewer.` })
  return text
}

function optionalText(value: unknown, label: string, max = 255) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > max) throw createError({ statusCode: 400, statusMessage: `${label} must be ${max} characters or fewer.` })
  return text
}

function entryType(value: unknown): EntryType {
  const normalized = String(value ?? '') as EntryType
  if (!validEntryTypes.has(normalized)) throw createError({ statusCode: 400, statusMessage: 'Select Loan or Deduction.' })
  return normalized
}

function requiredDate(value: unknown, label: string) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw createError({ statusCode: 400, statusMessage: `Enter a valid ${label.toLowerCase()}.` })
  }
  return text
}

function optionalDate(value: unknown, label: string) {
  const text = String(value ?? '').trim()
  return text ? requiredDate(text, label) : null
}

function repaymentPlan(body: Record<string, unknown>, amount: number, kind: EntryType, issuedOn: string) {
  const startDate = requiredDate(body.RepaymentStartDate, 'Repayment start date')
  if (startDate < issuedOn) {
    throw createError({ statusCode: 400, statusMessage: 'Repayment cannot start before the issuance date.' })
  }
  const periods = Number(body.RepaymentPeriods ?? body.RepaymentMonths)
  if (!Number.isInteger(periods) || periods < 1 || periods > 120) {
    throw createError({ statusCode: 400, statusMessage: 'Number of repayment periods must be between 1 and 120.' })
  }
  const amountInCents = Math.round(amount * 100)
  if (periods > amountInCents) {
    throw createError({ statusCode: 400, statusMessage: 'There are too many repayment periods for this amount.' })
  }
  const cutoff = String(body.RepaymentCutoff || (kind === 'Deduction' ? 'First' : 'Second')) as RepaymentCutoff
  if (!validRepaymentCutoffs.has(cutoff)) {
    throw createError({ statusCode: 400, statusMessage: 'Select the 1st cutoff, 2nd cutoff, or both payroll cutoffs.' })
  }
  const endDate = cutoffWindow(startDate, cutoff, periods - 1).end
  const installmentCents = Math.round(amountInCents / periods)
  const finalInstallmentCents = amountInCents - installmentCents * (periods - 1)
  return {
    startDate,
    periods,
    cutoff,
    endDate,
    installment: installmentCents / 100,
    finalInstallment: finalInstallmentCents / 100,
  }
}

function isoDate(year: number, monthIndex: number, day: number) {
  const value = new Date(Date.UTC(year, monthIndex, day))
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function cutoffWindow(startDate: string, cutoff: RepaymentCutoff, periodIndex: number) {
  const [year, month, day] = startDate.split('-').map(Number)
  let selectedCutoff: 'First' | 'Second'
  let monthOffset: number

  if (cutoff === 'Both') {
    const startsOnFirst = day <= 15
    const sequenceIndex = periodIndex + (startsOnFirst ? 0 : 1)
    selectedCutoff = sequenceIndex % 2 === 0 ? 'First' : 'Second'
    monthOffset = Math.floor(sequenceIndex / 2)
  } else {
    selectedCutoff = cutoff
    monthOffset = periodIndex + (cutoff === 'First' && day > 15 ? 1 : 0)
  }

  const periodMonth = new Date(Date.UTC(year, month - 1 + monthOffset, 1))
  const periodYear = periodMonth.getUTCFullYear()
  const periodMonthIndex = periodMonth.getUTCMonth()
  const lastDay = new Date(Date.UTC(periodYear, periodMonthIndex + 1, 0)).getUTCDate()
  return {
    start: isoDate(periodYear, periodMonthIndex, selectedCutoff === 'First' ? 1 : 16),
    end: isoDate(periodYear, periodMonthIndex, selectedCutoff === 'First' ? 15 : lastDay),
  }
}

function repaymentSchedule(row: any) {
  const periodCount = Math.max(1, Number(row.RepaymentMonths || 1))
  const start = String(row.RepaymentStartDate || row.IssuanceDate || '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (!match) return []

  const cutoff: RepaymentCutoff = validRepaymentCutoffs.has(row.RepaymentCutoff) ? row.RepaymentCutoff : 'Second'
  const originalCents = Math.round(Number(row.OriginalAmount || 0) * 100)
  const outstandingCents = Math.max(0, Math.min(originalCents, Math.round(Number(row.OutstandingAmount || 0) * 100)))
  let unappliedPaidCents = Math.max(0, originalCents - outstandingCents)
  let projectedBalanceCents = originalCents

  return Array.from({ length: periodCount }, (_, index) => {
    const window = cutoffWindow(start, cutoff, index)
    const scheduledCents = Math.round(Number(index === periodCount - 1 ? row.FinalInstallmentAmount : row.InstallmentAmount) * 100)
    const recordedPaidCents = Math.min(scheduledCents, unappliedPaidCents)
    unappliedPaidCents -= recordedPaidCents
    projectedBalanceCents = Math.max(0, projectedBalanceCents - scheduledCents)
    return {
      Period: index + 1,
      CutoffStartDate: window.start,
      CutoffEndDate: window.end,
      ScheduledAmount: scheduledCents / 100,
      RecordedPaidAmount: recordedPaidCents / 100,
      ProjectedBalance: projectedBalanceCents / 100,
      RemainingPeriods: periodCount - index - 1,
      Status: recordedPaidCents >= scheduledCents ? 'Paid' : recordedPaidCents > 0 ? 'Partially paid' : 'Scheduled',
    }
  })
}

function money(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) {
    throw createError({ statusCode: 400, statusMessage: 'Original value must be greater than zero.' })
  }
  return Math.round(amount * 100) / 100
}

async function catalogLookups() {
  const [items] = await pool.execute<any[]>(
    `SELECT 'Loan' AS EntryType, lt.LoanTypeID AS CatalogItemID, lt.LoanName AS ItemName,
            c.ClassificationID, c.ClassificationName
       FROM loan_type lt
       INNER JOIN deduction_loan_classification c ON c.ClassificationID = lt.ClassificationID
      WHERE lt.Status = 'Active' AND c.Status = 'Active'
      UNION ALL
     SELECT 'Deduction' AS EntryType, dt.DeductionTypeID AS CatalogItemID, dt.DeductionName AS ItemName,
            c.ClassificationID, c.ClassificationName
       FROM deduction_type dt
       INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
      WHERE dt.Status = 'Active' AND c.Status = 'Active'
      ORDER BY EntryType, ClassificationName, ItemName`,
  )
  return items
}

async function employeeProfile(employeeId: number) {
  const [rows] = await pool.execute<any[]>(
    `SELECT e.EmployeeID, e.EmployeeNumber,
            CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
            e.Status, a.AgencyName, p.PositionName
       FROM employee e
       LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
       LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
       LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
      WHERE e.EmployeeID = ?
      LIMIT 1`,
    [employeeId],
  )
  if (!rows[0]) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return rows[0]
}

async function employeeRecords(employeeId: number) {
  const [rows] = await pool.execute<any[]>(
    `SELECT records.*
       FROM (
         SELECT 'Loan' AS EntryType, el.EmployeeID, el.LoanID AS RecordID, el.AccountReference, el.IssuanceCode,
                DATE_FORMAT(el.ReleaseDate, '%Y-%m-%d') AS IssuanceDate,
                el.LoanAmount AS OriginalAmount, el.RemainingBalance AS OutstandingAmount,
                DATE_FORMAT(el.RepaymentStartDate, '%Y-%m-%d') AS RepaymentStartDate,
                el.RepaymentMonths, el.RepaymentCutoff,
                DATE_FORMAT(el.EndDate, '%Y-%m-%d') AS RepaymentEndDate,
                el.MonthlyDeduction AS InstallmentAmount, el.FinalInstallmentAmount,
                el.IsPaused, DATE_FORMAT(el.PauseStartDate, '%Y-%m-%d') AS PauseStartDate,
                DATE_FORMAT(el.ResumeDate, '%Y-%m-%d') AS ResumeDate, el.PauseReason,
                el.Status, el.Remarks, el.LoanTypeID AS CatalogItemID,
                lt.LoanName AS ItemName, c.ClassificationName, el.CreatedAt, el.UpdatedAt
           FROM employee_loan el
           INNER JOIN loan_type lt ON lt.LoanTypeID = el.LoanTypeID
           LEFT JOIN deduction_loan_classification c ON c.ClassificationID = lt.ClassificationID
          WHERE el.EmployeeID = ?
         UNION ALL
         SELECT 'Deduction' AS EntryType, ed.EmployeeID, ed.EmployeeDeductionID AS RecordID, ed.AccountReference, ed.IssuanceCode,
                DATE_FORMAT(COALESCE(ed.IssuanceDate, ed.StartDate), '%Y-%m-%d') AS IssuanceDate,
                ed.Amount AS OriginalAmount, ed.RemainingBalance AS OutstandingAmount,
                DATE_FORMAT(ed.RepaymentStartDate, '%Y-%m-%d') AS RepaymentStartDate,
                ed.RepaymentMonths, ed.RepaymentCutoff,
                DATE_FORMAT(ed.EndDate, '%Y-%m-%d') AS RepaymentEndDate,
                ed.InstallmentAmount, ed.FinalInstallmentAmount,
                ed.IsPaused, DATE_FORMAT(ed.PauseStartDate, '%Y-%m-%d') AS PauseStartDate,
                DATE_FORMAT(ed.ResumeDate, '%Y-%m-%d') AS ResumeDate, ed.PauseReason,
                ed.Status, ed.Remarks, ed.DeductionTypeID AS CatalogItemID,
                dt.DeductionName AS ItemName, c.ClassificationName, ed.CreatedAt, ed.UpdatedAt
           FROM employee_deduction ed
           INNER JOIN deduction_type dt ON dt.DeductionTypeID = ed.DeductionTypeID
           LEFT JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
          WHERE ed.EmployeeID = ?
       ) records
      ORDER BY records.IssuanceDate DESC, records.CreatedAt DESC, records.RecordID DESC`,
    [employeeId, employeeId],
  )
  const [transactionRows] = await pool.execute<any[]>(
    `SELECT t.TransactionRecordID, t.TransactionID, t.EntryType, t.SourceRecordID,
            DATE_FORMAT(TransactionDate, '%Y-%m-%d') AS TransactionDate,
            t.Amount, t.BalanceAfter, t.Status
       FROM employee_account_transaction t
       INNER JOIN payroll py ON py.PayrollID = t.PayrollID AND py.Status IN ('Approved', 'Released')
      WHERE t.EmployeeID = ?
      ORDER BY t.TransactionDate DESC, t.TransactionRecordID DESC`,
    [employeeId],
  )
  const transactionsByIssuance = new Map<string, any[]>()
  for (const transaction of transactionRows) {
    const key = `${transaction.EntryType}-${transaction.SourceRecordID}`
    transactionsByIssuance.set(key, [...(transactionsByIssuance.get(key) || []), transaction])
  }
  const queue = rows
    .filter(row => row.Status === 'Active')
    .sort((a, b) => String(a.IssuanceDate || '').localeCompare(String(b.IssuanceDate || '')) || String(a.CreatedAt).localeCompare(String(b.CreatedAt)) || Number(a.RecordID) - Number(b.RecordID))
  const positions = new Map<string, { first: number | null; second: number | null }>()
  const counters = new Map<string, number>()
  for (const row of queue) {
    const cutoff: RepaymentCutoff = validRepaymentCutoffs.has(row.RepaymentCutoff) ? row.RepaymentCutoff : 'Second'
    const catalogQueue = `${row.EntryType}-${row.CatalogItemID}`
    const nextPosition = (eligibleCutoff: 'First' | 'Second') => {
      const key = `${catalogQueue}-${eligibleCutoff}`
      const position = (counters.get(key) || 0) + 1
      counters.set(key, position)
      return position
    }
    const first = cutoff === 'First' || cutoff === 'Both' ? nextPosition('First') : null
    const second = cutoff === 'Second' || cutoff === 'Both' ? nextPosition('Second') : null
    positions.set(`${row.EntryType}-${row.RecordID}`, { first, second })
  }
  return rows.map(row => {
    const position = positions.get(`${row.EntryType}-${row.RecordID}`) || { first: null, second: null }
    return {
      ...row,
      Transactions: transactionsByIssuance.get(`${row.EntryType}-${row.RecordID}`) || [],
      RepaymentPeriods: Number(row.RepaymentMonths || 1),
      RepaymentSchedule: repaymentSchedule(row),
      FifoPosition: position.first ?? position.second,
      FifoPositionFirst: position.first,
      FifoPositionSecond: position.second,
      PlanStatus: Number(row.IsPaused) ? (row.ResumeDate ? 'Paused until resume date' : 'Paused') : row.Status === 'Active' ? 'Scheduled' : row.Status,
    }
  })
}

export async function listEmployeeLoanDeductions(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event) as Record<string, string | undefined>
  const requestedEmployeeId = query.employeeId ? positiveId(query.employeeId, 'Employee') : null
  const lookups = await catalogLookups()

  if (requestedEmployeeId) {
    const [employee, records] = await Promise.all([
      employeeProfile(requestedEmployeeId),
      employeeRecords(requestedEmployeeId),
    ])
    return { employee, records, catalogItems: lookups }
  }

  const search = String(query.search ?? '').trim()
  const agencyId = query.agencyId ? positiveId(query.agencyId, 'Agency') : null
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(String(query.pageSize || '25'), 10) || 25))
  const where = ["e.Status = 'Active'"]
  const params: Array<string | number> = []
  if (search) {
    where.push("(CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) LIKE ? OR COALESCE(e.EmployeeNumber, '') LIKE ? OR CAST(e.EmployeeID AS CHAR) LIKE ?)")
    const term = `%${search}%`
    params.push(term, term, term)
  }
  if (agencyId) {
    where.push('ap.AgencyID = ?')
    params.push(agencyId)
  }
  const whereSql = where.join(' AND ')
  const offset = (page - 1) * pageSize
  const [items] = await pool.execute<any[]>(
    `SELECT e.EmployeeID, e.EmployeeNumber,
            CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
            a.AgencyID, a.AgencyName, p.PositionName,
            COALESCE(loans.ActiveCount, 0) AS ActiveLoanCount,
            COALESCE(deductions.ActiveCount, 0) AS ActiveDeductionCount,
            COALESCE(loans.TotalIssued, 0) + COALESCE(deductions.TotalIssued, 0) AS TotalIssued,
            COALESCE(loans.Outstanding, 0) AS OutstandingLoanBalance,
            COALESCE(deductions.Outstanding, 0) AS OutstandingDeductionBalance,
            COALESCE(loans.Outstanding, 0) + COALESCE(deductions.Outstanding, 0) AS OutstandingBalance
       FROM employee e
       LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
       LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
       LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
       LEFT JOIN (
         SELECT EmployeeID,
                SUM(CASE WHEN Status = 'Active' THEN 1 ELSE 0 END) AS ActiveCount,
                SUM(CASE WHEN Status <> 'Cancelled' THEN COALESCE(LoanAmount, 0) ELSE 0 END) AS TotalIssued,
                SUM(CASE WHEN Status = 'Active' THEN COALESCE(RemainingBalance, 0) ELSE 0 END) AS Outstanding
           FROM employee_loan GROUP BY EmployeeID
       ) loans ON loans.EmployeeID = e.EmployeeID
       LEFT JOIN (
         SELECT EmployeeID,
                SUM(CASE WHEN Status = 'Active' THEN 1 ELSE 0 END) AS ActiveCount,
                SUM(CASE WHEN Status <> 'Inactive' THEN COALESCE(Amount, 0) ELSE 0 END) AS TotalIssued,
                SUM(CASE WHEN Status = 'Active' THEN COALESCE(RemainingBalance, 0) ELSE 0 END) AS Outstanding
           FROM employee_deduction GROUP BY EmployeeID
       ) deductions ON deductions.EmployeeID = e.EmployeeID
      WHERE ${whereSql}
      ORDER BY e.LastName, e.FirstName, e.MiddleName, e.EmployeeID
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS total
       FROM employee e
       LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      WHERE ${whereSql}`,
    params,
  )
  const [agencies] = await pool.execute<any[]>(
    "SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName",
  )
  return {
    items,
    agencies,
    catalogItems: lookups,
    pagination: { page, pageSize, total: Number(countRows[0]?.total || 0), pages: Math.max(1, Math.ceil(Number(countRows[0]?.total || 0) / pageSize)) },
  }
}

export async function createEmployeeLoanDeduction(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<Record<string, unknown>>(event)
  const employeeId = positiveId(body?.EmployeeID, 'Employee')
  const kind = entryType(body?.EntryType)
  const catalogItemId = positiveId(body?.CatalogItemID, `${kind} catalog item`)
  const code = requiredText(body?.IssuanceCode, 'Issuance code', 100)
  const date = requiredDate(body?.IssuanceDate, 'Issuance date')
  const amount = money(body?.OriginalAmount)
  const plan = repaymentPlan(body, amount, kind, date)
  const remarks = optionalText(body?.Remarks, 'Remarks')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [employeeRows] = await connection.execute<any[]>(
      "SELECT EmployeeID FROM employee WHERE EmployeeID = ? AND Status = 'Active' LIMIT 1 FOR UPDATE",
      [employeeId],
    )
    if (!employeeRows[0]) throw createError({ statusCode: 400, statusMessage: 'Select an active employee.' })
    if (kind === 'Loan') {
      const [catalogRows] = await connection.execute<any[]>(
        `SELECT lt.LoanTypeID, lt.LoanName AS ItemName, c.ClassificationName
           FROM loan_type lt
           INNER JOIN deduction_loan_classification c ON c.ClassificationID = lt.ClassificationID
          WHERE lt.LoanTypeID = ? AND lt.Status = 'Active' AND c.Status = 'Active'
          LIMIT 1`,
        [catalogItemId],
      )
      if (!catalogRows[0]) throw createError({ statusCode: 400, statusMessage: 'Select an active loan catalog entry.' })
      const [result] = await connection.execute<any>(
        `INSERT INTO employee_loan
          (EmployeeID, LoanTypeID, IssuanceCode, LoanAmount, RemainingBalance, MonthlyDeduction,
           FinalInstallmentAmount, ReleaseDate, RepaymentStartDate, RepaymentMonths, RepaymentCutoff, EndDate, Remarks, Status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
        [employeeId, catalogItemId, code, amount, amount, plan.installment, plan.finalInstallment,
          date, plan.startDate, plan.periods, plan.cutoff, plan.endDate, remarks],
      )
      const accountReference = `LN${String(result.insertId).padStart(6, '0')}`
      await connection.execute('UPDATE employee_loan SET AccountReference = ? WHERE LoanID = ?', [accountReference, result.insertId])
      await connection.commit()
      return { id: result.insertId, entryType: kind, accountReference }
    }

    const [catalogRows] = await connection.execute<any[]>(
      `SELECT dt.DeductionTypeID, dt.DeductionName AS ItemName, c.ClassificationName
         FROM deduction_type dt
         INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
        WHERE dt.DeductionTypeID = ? AND dt.Status = 'Active' AND c.Status = 'Active'
        LIMIT 1`,
      [catalogItemId],
    )
    if (!catalogRows[0]) throw createError({ statusCode: 400, statusMessage: 'Select an active deduction catalog entry.' })
    const [result] = await connection.execute<any>(
      `INSERT INTO employee_deduction
        (EmployeeID, DeductionTypeID, IssuanceCode, IssuanceDate, Amount, RemainingBalance,
         InstallmentAmount, FinalInstallmentAmount, StartDate, RepaymentStartDate, RepaymentMonths,
         RepaymentCutoff, EndDate, Remarks, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
      [employeeId, catalogItemId, code, date, amount, amount, plan.installment, plan.finalInstallment,
        plan.startDate, plan.startDate, plan.periods, plan.cutoff, plan.endDate, remarks],
    )
    const accountReference = `DED${String(result.insertId).padStart(6, '0')}`
    await connection.execute('UPDATE employee_deduction SET AccountReference = ? WHERE EmployeeDeductionID = ?', [accountReference, result.insertId])
    await connection.commit()
    return { id: result.insertId, entryType: kind, accountReference }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'This issuance code is already in use.' })
    throw error
  } finally {
    connection.release()
  }
}

export async function updateEmployeeLoanDeduction(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<Record<string, unknown>>(event)
  const kind = entryType(body?.EntryType)
  const recordId = positiveId(body?.RecordID, 'Record')
  const planAction = String(body?.PlanAction || '').trim()
  if (planAction === 'pause') {
    const pauseStartDate = requiredDate(body?.PauseStartDate, 'Pause start date')
    const resumeDate = optionalDate(body?.ResumeDate, 'Resume date')
    if (resumeDate && resumeDate <= pauseStartDate) {
      throw createError({ statusCode: 400, statusMessage: 'Resume date must be after the pause start date.' })
    }
    const pauseReason = optionalText(body?.PauseReason, 'Pause reason')
    const table = kind === 'Loan' ? 'employee_loan' : 'employee_deduction'
    const idColumn = kind === 'Loan' ? 'LoanID' : 'EmployeeDeductionID'
    const [result] = await pool.execute<any>(
      `UPDATE ${table} SET IsPaused = 1, PauseStartDate = ?, ResumeDate = ?, PauseReason = ? WHERE ${idColumn} = ? AND Status = 'Active'`,
      [pauseStartDate, resumeDate, pauseReason, recordId],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Active repayment plan not found.' })
    return { success: true }
  }
  if (planAction === 'resume') {
    const table = kind === 'Loan' ? 'employee_loan' : 'employee_deduction'
    const idColumn = kind === 'Loan' ? 'LoanID' : 'EmployeeDeductionID'
    const [result] = await pool.execute<any>(
      `UPDATE ${table} SET IsPaused = 0, PauseStartDate = NULL, ResumeDate = NULL, PauseReason = NULL WHERE ${idColumn} = ? AND Status = 'Active'`,
      [recordId],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Active repayment plan not found.' })
    return { success: true }
  }
  const status = requiredText(body?.Status, 'Status', 20)
  if (kind === 'Loan') {
    if (!validLoanStatuses.has(status)) throw createError({ statusCode: 400, statusMessage: 'Select a valid loan status.' })
    const [result] = await pool.execute<any>(
      'UPDATE employee_loan SET Status = ?, RemainingBalance = CASE WHEN ? IN (\'Paid\', \'Cancelled\') THEN 0 ELSE RemainingBalance END, IsPaused = 0, PauseStartDate = NULL, ResumeDate = NULL, PauseReason = NULL WHERE LoanID = ?',
      [status, status, recordId],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee loan record not found.' })
    return { success: true }
  }
  if (!validDeductionStatuses.has(status)) throw createError({ statusCode: 400, statusMessage: 'Select a valid deduction status.' })
  const [result] = await pool.execute<any>(
    "UPDATE employee_deduction SET Status = ?, RemainingBalance = CASE WHEN ? IN ('Completed', 'Inactive') THEN 0 ELSE RemainingBalance END, IsPaused = 0, PauseStartDate = NULL, ResumeDate = NULL, PauseReason = NULL WHERE EmployeeDeductionID = ?",
    [status, status, recordId],
  )
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee deduction record not found.' })
  return { success: true }
}
