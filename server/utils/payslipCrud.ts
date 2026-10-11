import { getQuery, createError } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

const cents = (value: unknown) => Math.round(Number(value || 0) * 100)
const pesos = (value: number) => value / 100
const governmentProvider = (name: string) => /pag[ -]?ibig|social security system|^sss$|philhealth/i.test(name)

function displayName(name: string, classification: string | null) {
  const provider = classification === 'Social Security System' ? 'SSS'
    : /^pag[ -]?ibig$/i.test(classification || '') ? 'Pag-ibig' : classification || ''
  return provider && provider.toLowerCase() !== name.toLowerCase() ? `${provider} · ${name}` : provider || name
}

function addLine(lines: Map<string, any>, section: string, label: string, amount: unknown, hours = 0) {
  const key = `${section}:${label}`
  const line = lines.get(key) || { section, label, hours: 0, amountCents: 0 }
  line.hours += Number(hours || 0)
  line.amountCents += Math.abs(cents(amount))
  lines.set(key, line)
}

export function payslipGroups(payrolls: any[], details: any[], deductions: any[], transactions: any[]) {
  const grouped = new Map<string, any>()
  const payrollById = new Map(payrolls.map(item => [Number(item.PayrollID), item]))
  const loanTransactions = new Set(transactions.filter(item => item.EntryType === 'Loan').map(item => Number(item.PayrollID)))
  for (const payroll of payrolls) {
    const key = `${payroll.PeriodStart}:${payroll.PeriodEnd}`
    const group = grouped.get(key) || {
      periodStart: payroll.PeriodStart, periodEnd: payroll.PeriodEnd, status: 'Released',
      payrollIds: [], sources: [], grossCents: 0, deductionCents: 0, netCents: 0,
      lines: new Map<string, any>(),
    }
    group.payrollIds.push(Number(payroll.PayrollID))
    group.sources.push({ payrollId: Number(payroll.PayrollID), batchId: payroll.BatchID,
      siteName: payroll.SiteName || 'Unassigned site', clientName: payroll.ClientName || '',
      gross: Number(payroll.GrossPay), deductions: Number(payroll.TotalDeduction), net: Number(payroll.NetPay) })
    group.grossCents += cents(payroll.GrossPay)
    group.deductionCents += cents(payroll.TotalDeduction)
    group.netCents += cents(payroll.NetPay)
    if (payroll.Status !== 'Released') group.status = 'Approved'
    grouped.set(key, group)
  }
  const groupFor = (payrollId: number) => {
    const payroll = payrollById.get(Number(payrollId))
    return payroll ? grouped.get(`${payroll.PeriodStart}:${payroll.PeriodEnd}`) : null
  }
  for (const detail of details) {
    const group = groupFor(detail.PayrollID)
    if (!group) continue
    const description = String(detail.Description || '').trim()
    const amount = Number(detail.Amount || 0)
    if (description.startsWith('Loan:')) {
      if (!loanTransactions.has(Number(detail.PayrollID))) addLine(group.lines, 'other', description.slice(5).trim(), amount)
    } else if (description.startsWith('Adjustment #')) {
      const match = /^Adjustment #\d+:\s*(.*?)(?:\s+-\s+\d{4}-\d{2}-\d{2})?$/.exec(description)
      addLine(group.lines, amount >= 0 ? 'adjustment' : 'other',
        `Adjustment · ${match?.[1] || description}`, amount, Number(detail.Quantity || 0))
    } else {
      const isLateUndertime = description === 'Late' || description === 'Undertime'
      addLine(group.lines, amount >= 0 ? 'earnings' : 'other',
        isLateUndertime ? 'Late / Undertime' : description, amount,
        amount >= 0 || isLateUndertime ? Number(detail.Quantity || 0) : 0)
    }
  }
  for (const deduction of deductions) {
    const group = groupFor(deduction.PayrollID)
    if (!group) continue
    const name = String(deduction.DeductionName || 'Deduction')
    const classification = deduction.ClassificationName ? String(deduction.ClassificationName) : null
    addLine(group.lines, governmentProvider(classification || '') ? 'government' : 'other',
      displayName(name, classification), deduction.Amount)
  }
  for (const transaction of transactions) {
    if (transaction.EntryType !== 'Loan') continue
    const group = groupFor(transaction.PayrollID)
    if (!group) continue
    const classification = transaction.ClassificationName ? String(transaction.ClassificationName) : null
    addLine(group.lines, governmentProvider(classification || '') ? 'government' : 'other',
      displayName(String(transaction.ItemName || 'Loan'), classification), transaction.Amount)
  }
  for (const group of grouped.values()) {
    const earningLines = [...group.lines.values()].filter((line: any) => ['earnings', 'adjustment'].includes(line.section))
    const deductionLines = [...group.lines.values()].filter((line: any) => ['government', 'other'].includes(line.section))
    const unitemizedEarnings = group.grossCents - earningLines.reduce((sum: number, line: any) => sum + line.amountCents, 0)
    const unitemizedDeductions = group.deductionCents - deductionLines.reduce((sum: number, line: any) => sum + line.amountCents, 0)
    if (unitemizedEarnings > 0) addLine(group.lines, 'earnings', 'Other posted earnings', pesos(unitemizedEarnings))
    if (unitemizedDeductions > 0) addLine(group.lines, 'other', 'Other posted deductions', pesos(unitemizedDeductions))
  }
  return [...grouped.values()].map(group => ({
    periodStart: group.periodStart, periodEnd: group.periodEnd, status: group.status,
    payrollIds: group.payrollIds, sources: group.sources,
    gross: pesos(group.grossCents), deductions: pesos(group.deductionCents), net: pesos(group.netCents),
    lines: [...group.lines.values()].map(line => ({ section: line.section, label: line.label,
      hours: Math.round(line.hours * 100) / 100, amount: pesos(line.amountCents) })),
  })).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.periodStart.localeCompare(a.periodStart))
}

export async function listPayslips(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  const employeeId = Number(query.employeeId || 0)
  if (query.employeeId !== undefined && (!Number.isInteger(employeeId) || employeeId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid employee.' })
  }
  if (employeeId) {
    const [[employee]] = await pool.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber,
        CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
        e.Status, a.AgencyName, p.PositionName
      FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
      LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
      WHERE e.EmployeeID = ? LIMIT 1`, [employeeId])
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
    const [payrolls] = await pool.execute<any[]>(`SELECT py.PayrollID, py.Status,
        DATE_FORMAT(py.StartDate, '%Y-%m-%d') AS PeriodStart,
        DATE_FORMAT(py.EndDate, '%Y-%m-%d') AS PeriodEnd,
        py.GrossPay, py.TotalDeduction, py.NetPay, pp.BatchID,
        COALESCE(dsite.SiteName, deploymentSite.SiteName) AS SiteName, client.ClientName
      FROM payroll py
      LEFT JOIN payroll_processing_posting pp ON pp.PayrollID = py.PayrollID AND pp.Status = 'Active'
      LEFT JOIN attendance_dtr d ON d.BatchID = pp.BatchID
      LEFT JOIN site dsite ON dsite.SiteID = d.SiteID
      LEFT JOIN client ON client.ClientID = d.ClientID
      LEFT JOIN employee_deployment ed ON ed.DeploymentID = py.DeploymentID
      LEFT JOIN site deploymentSite ON deploymentSite.SiteID = ed.SiteID
      WHERE py.EmployeeID = ? AND py.Status IN ('Approved', 'Released')
      ORDER BY py.EndDate DESC, py.StartDate DESC, py.PayrollID DESC`, [employeeId])
    if (!payrolls.length) return { employee, cutoffs: [] }
    const ids = payrolls.map(row => Number(row.PayrollID))
    const placeholders = ids.map(() => '?').join(', ')
    const [[details], [deductions], [transactions]] = await Promise.all([
      pool.execute<any[]>(`SELECT PayrollID, Description, Quantity, Amount FROM payroll_detail
        WHERE PayrollID IN (${placeholders}) ORDER BY PayrollID, PayrollDetailID`, ids),
      pool.execute<any[]>(`SELECT pd.PayrollID, pd.ReferenceType, pd.Amount,
          dt.DeductionName, c.ClassificationName
        FROM payroll_deduction pd
        LEFT JOIN deduction_type dt ON dt.DeductionTypeID = pd.DeductionTypeID
        LEFT JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
        WHERE pd.PayrollID IN (${placeholders}) ORDER BY pd.PayrollID, pd.PayrollDeductionID`, ids),
      pool.execute<any[]>(`SELECT PayrollID, EntryType, ItemName, ClassificationName, Amount
        FROM employee_account_transaction WHERE PayrollID IN (${placeholders}) AND Status = 'Posted'
        ORDER BY PayrollID, TransactionRecordID`, ids),
    ])
    return { employee, cutoffs: payslipGroups(payrolls, details, deductions, transactions) }
  }

  const search = String(query.search || '').trim().slice(0, 100)
  const agencyId = Number(query.agencyId || 0)
  if (query.agencyId && (!Number.isInteger(agencyId) || agencyId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid agency.' })
  }
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)))
  const pageSize = 25
  const where = `WHERE (? = 0 OR ap.AgencyID = ?) AND (? = '' OR
    CONCAT_WS(' ', e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName) LIKE ?)`
  const params = [agencyId, agencyId, search, `%${search}%`]
  const [[count]] = await pool.execute<any[]>(`SELECT COUNT(*) AS Total FROM employee e
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID ${where}`, params)
  const [items] = await pool.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber,
      CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
      e.Status, a.AgencyName, p.PositionName,
      DATE_FORMAT(summary.LastCutoffEnd, '%Y-%m-%d') AS LastCutoffEnd,
      COALESCE(summary.CutoffCount, 0) AS CutoffCount
    FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    LEFT JOIN (SELECT EmployeeID, MAX(EndDate) AS LastCutoffEnd,
      COUNT(DISTINCT StartDate, EndDate) AS CutoffCount FROM payroll
      WHERE Status IN ('Approved', 'Released') GROUP BY EmployeeID) summary ON summary.EmployeeID = e.EmployeeID
    ${where} ORDER BY summary.LastCutoffEnd DESC, e.LastName, e.FirstName, e.EmployeeID
    LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
  const [agencies] = await pool.execute<any[]>(`SELECT AgencyID, AgencyName FROM agency
    WHERE Status = 'Active' ORDER BY AgencyName`)
  return { items, agencies, pagination: { page, pageSize, total: Number(count.Total),
    pages: Math.max(1, Math.ceil(Number(count.Total) / pageSize)) } }
}
