import { createError, getQuery, getRouterParam } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

const totals = `SELECT pp.BatchID,
    SUM(CASE WHEN pp.Status = 'Active' AND py.Status IN ('Approved', 'Released') THEN 1 ELSE 0 END) AS ActiveCount,
    SUM(CASE WHEN pp.Status = 'Cancelled' OR py.Status = 'Cancelled' THEN 1 ELSE 0 END) AS CancelledCount,
    COALESCE(SUM(CASE WHEN pp.Status = 'Active' AND py.Status IN ('Approved', 'Released') THEN py.GrossPay ELSE 0 END), 0) AS Gross,
    COALESCE(SUM(CASE WHEN pp.Status = 'Active' AND py.Status IN ('Approved', 'Released') THEN py.TotalDeduction ELSE 0 END), 0) AS Deductions,
    COALESCE(SUM(CASE WHEN pp.Status = 'Active' AND py.Status IN ('Approved', 'Released') THEN py.NetPay ELSE 0 END), 0) AS Net,
    COALESCE(SUM(CASE WHEN pp.Status = 'Cancelled' OR py.Status = 'Cancelled' THEN py.GrossPay ELSE 0 END), 0) AS CancelledGross,
    COALESCE(SUM(CASE WHEN pp.Status = 'Cancelled' OR py.Status = 'Cancelled' THEN py.TotalDeduction ELSE 0 END), 0) AS CancelledDeductions,
    COALESCE(SUM(CASE WHEN pp.Status = 'Cancelled' OR py.Status = 'Cancelled' THEN py.NetPay ELSE 0 END), 0) AS CancelledNet
  FROM payroll_processing_posting pp INNER JOIN payroll py ON py.PayrollID = pp.PayrollID
  GROUP BY pp.BatchID`

const base = `FROM attendance_dtr d
  INNER JOIN agency a ON a.AgencyID = d.AgencyID
  INNER JOIN client c ON c.ClientID = d.ClientID
  INNER JOIN site s ON s.SiteID = d.SiteID
  INNER JOIN (${totals}) t ON t.BatchID = d.BatchID`

export async function listPayrollHistory(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  const search = String(query.search || '').trim().slice(0, 100)
  const agencyId = Number(query.agencyId || 0)
  if (query.agencyId && (!Number.isInteger(agencyId) || agencyId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid agency.' })
  }
  const status = String(query.status || 'all')
  if (!['all', 'Finalized', 'Cancelled'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid payroll history status.' })
  }
  const periodStart = String(query.periodStart || '')
  const periodEnd = String(query.periodEnd || '')
  if ((periodStart || periodEnd) && (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid payroll cutoff.' })
  }
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)))
  const pageSize = 20
  const like = `%${search}%`
  const where = `WHERE (? = 0 OR d.AgencyID = ?)
    AND (? = '' OR (DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') = ? AND DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') = ?))
    AND (? = 'all' OR (? = 'Finalized' AND t.ActiveCount > 0) OR (? = 'Cancelled' AND t.ActiveCount = 0))
    AND (? = '' OR s.SiteName LIKE ? OR c.ClientName LIKE ? OR a.AgencyName LIKE ?
      OR CAST(d.BatchID AS CHAR) LIKE ? OR EXISTS (
        SELECT 1 FROM payroll_processing_posting searchPosting
        INNER JOIN employee searchEmployee ON searchEmployee.EmployeeID = searchPosting.EmployeeID
        WHERE searchPosting.BatchID = d.BatchID AND CONCAT_WS(' ', searchEmployee.EmployeeNumber,
          searchEmployee.FirstName, searchEmployee.MiddleName, searchEmployee.LastName) LIKE ?))`
  const params = [agencyId, agencyId, periodStart, periodStart, periodEnd,
    status, status, status, search, like, like, like, like, like]
  const [[summary]] = await pool.execute<any[]>(`SELECT COUNT(*) AS Total,
      COALESCE(SUM(t.ActiveCount), 0) AS EmployeeCount,
      COALESCE(SUM(t.Gross), 0) AS Gross,
      COALESCE(SUM(t.Deductions), 0) AS Deductions,
      COALESCE(SUM(t.Net), 0) AS Net
    ${base} ${where}`, params)
  const [items] = await pool.execute<any[]>(`SELECT d.BatchID, d.AgencyID, a.AgencyName,
      c.ClientName, s.SiteName, DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') AS PeriodStart,
      DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') AS PeriodEnd,
      t.ActiveCount, t.CancelledCount, t.Gross, t.Deductions, t.Net,
      t.CancelledGross, t.CancelledDeductions, t.CancelledNet,
      (SELECT DATE_FORMAT(MAX(evt.CreatedAt), '%Y-%m-%d %H:%i:%s') FROM dtr_workflow_event evt
        WHERE evt.BatchID = d.BatchID AND evt.Action IN ('Approve Payroll', 'Cancel Payroll')) AS LastActionAt
    ${base} ${where}
    ORDER BY d.PeriodEnd DESC, d.PeriodStart DESC, d.BatchID DESC LIMIT ? OFFSET ?`,
  [...params, pageSize, (page - 1) * pageSize])
  const [[cutoffs], [agencies]] = await Promise.all([
    pool.execute<any[]>(`SELECT DISTINCT DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') AS PeriodStart,
        DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') AS PeriodEnd
      FROM attendance_dtr d INNER JOIN payroll_processing_posting pp ON pp.BatchID = d.BatchID
      ORDER BY d.PeriodEnd DESC, d.PeriodStart DESC`),
    pool.execute<any[]>(`SELECT a.AgencyID, a.AgencyName FROM agency a
      WHERE EXISTS (SELECT 1 FROM attendance_dtr d INNER JOIN payroll_processing_posting pp ON pp.BatchID = d.BatchID
        WHERE d.AgencyID = a.AgencyID) ORDER BY a.AgencyName`),
  ])
  return { items: items.map(row => ({ ...row, status: Number(row.ActiveCount) > 0 ? 'Finalized' : 'Cancelled' })),
    cutoffs, agencies, summary,
    pagination: { page, pageSize, total: Number(summary.Total), pages: Math.max(1, Math.ceil(Number(summary.Total) / pageSize)) } }
}

export async function getPayrollHistory(event: any) {
  const session = requireSession(event)
  void session.sub
  const batchId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(batchId) || batchId < 1) throw createError({ statusCode: 400, statusMessage: 'Select a valid DTR.' })
  const [[batch]] = await pool.execute<any[]>(`SELECT d.BatchID, a.AgencyName, c.ClientName, s.SiteName,
      DATE_FORMAT(d.PeriodStart, '%Y-%m-%d') AS PeriodStart,
      DATE_FORMAT(d.PeriodEnd, '%Y-%m-%d') AS PeriodEnd
    FROM attendance_dtr d INNER JOIN agency a ON a.AgencyID = d.AgencyID
    INNER JOIN client c ON c.ClientID = d.ClientID INNER JOIN site s ON s.SiteID = d.SiteID
    WHERE d.BatchID = ? AND EXISTS (SELECT 1 FROM payroll_processing_posting pp WHERE pp.BatchID = d.BatchID)
    LIMIT 1`, [batchId])
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'Payroll history not found.' })
  const [[payrolls], [events]] = await Promise.all([
    pool.execute<any[]>(`SELECT pp.PostingID, pp.PayrollID, pp.Status AS PostingStatus,
        DATE_FORMAT(pp.CancelledAt, '%Y-%m-%d %H:%i:%s') AS CancelledAt,
        py.Status AS PayrollStatus, py.GrossPay, py.TotalDeduction, py.NetPay,
        e.EmployeeID, e.EmployeeNumber,
        CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
        COALESCE(de.AttendanceType, ed.DeploymentType, 'Regular') AS AssignmentType
      FROM payroll_processing_posting pp INNER JOIN payroll py ON py.PayrollID = pp.PayrollID
      INNER JOIN employee e ON e.EmployeeID = pp.EmployeeID
      LEFT JOIN attendance_dtr_employee de ON de.BatchID = pp.BatchID AND de.EmployeeID = pp.EmployeeID
      LEFT JOIN employee_deployment ed ON ed.DeploymentID = py.DeploymentID
      WHERE pp.BatchID = ? ORDER BY (pp.Status = 'Active') DESC, e.LastName, e.FirstName, pp.PostingID DESC`, [batchId]),
    pool.execute<any[]>(`SELECT evt.EventID, evt.Action, evt.ActorName, evt.ActorRole, evt.ActorDepartment,
        evt.Reason, DATE_FORMAT(evt.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt
      FROM dtr_workflow_event evt WHERE evt.BatchID = ?
        AND evt.Action IN ('Approve Payroll', 'Cancel Payroll') ORDER BY evt.EventID DESC`, [batchId]),
  ])
  return { batch, payrolls, events }
}
