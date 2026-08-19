import { createError, getQuery, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type DtrBody = Record<string, unknown>

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return id
}

function date(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return value
}

function batchId(event: any) { return positiveId(getRouterParam(event, 'id'), 'DTR ID') }

async function validateAssignment(connection: any, agencyId: number, clientId: number, siteId: number) {
  const [[clientRate]] = await connection.execute<any[]>(
    `SELECT cr.ClientRateID
     FROM client_rate cr
     INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
     INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
     WHERE ap.AgencyID = ? AND cr.ClientID = ? AND cr.Status = 'Active' AND pr.Status = 'Active'
     LIMIT 1`,
    [agencyId, clientId]
  )
  if (!clientRate) throw createError({ statusCode: 400, statusMessage: 'This client has no active rate under the selected agency.' })
  const [[site]] = await connection.execute<any[]>('SELECT SiteID FROM site WHERE SiteID = ? AND ClientID = ? AND Status = \'Active\' LIMIT 1', [siteId, clientId])
  if (!site) throw createError({ statusCode: 400, statusMessage: 'Select an active site belonging to the selected client.' })
}

async function ensureUniqueBatch(connection: any, agencyId: number, siteId: number, periodStart: string, periodEnd: string, exceptId?: number) {
  const sql = `SELECT BatchID FROM attendance_dtr WHERE AgencyID = ? AND SiteID = ? AND PeriodStart = ? AND PeriodEnd = ?${exceptId ? ' AND BatchID <> ?' : ''} LIMIT 1`
  const [rows] = await connection.execute<any[]>(sql, exceptId ? [agencyId, siteId, periodStart, periodEnd, exceptId] : [agencyId, siteId, periodStart, periodEnd])
  if (rows[0]) throw createError({ statusCode: 409, statusMessage: 'A DTR already exists for this agency, site, and cutoff.' })
}

async function lookups() {
  const [agencies, clients, sites] = await Promise.all([
    pool.execute<any[]>("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName").then(([rows]) => rows),
    pool.execute<any[]>(`SELECT DISTINCT ap.AgencyID, cr.ClientID, c.ClientName
      FROM client_rate cr INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
      INNER JOIN client c ON c.ClientID = cr.ClientID
      WHERE cr.Status = 'Active' AND pr.Status = 'Active' AND c.Status = 'Active'
      ORDER BY c.ClientName`).then(([rows]) => rows),
    pool.execute<any[]>(`SELECT s.SiteID, s.ClientID, s.SiteName, c.ClientName
      FROM site s INNER JOIN client c ON c.ClientID = s.ClientID
      WHERE s.Status = 'Active' AND c.Status = 'Active' ORDER BY c.ClientName, s.SiteName`).then(([rows]) => rows)
  ])
  return { agencies, clients, sites }
}

export async function listDtrs(event: any) {
  const session = requireSession(event); void session.sub
  const query = getQuery(event) as Record<string, string | undefined>
  const filters: string[] = []
  const values: any[] = []
  if (query.agencyId) { filters.push('d.AgencyID = ?'); values.push(positiveId(query.agencyId, 'Agency')) }
  if (query.clientId) { filters.push('d.ClientID = ?'); values.push(positiveId(query.clientId, 'Client')) }
  if (query.siteId) { filters.push('d.SiteID = ?'); values.push(positiveId(query.siteId, 'Site')) }
  if (query.periodStart) { filters.push('d.PeriodStart = ?'); values.push(date(query.periodStart, 'Period start')) }
  if (query.periodEnd) { filters.push('d.PeriodEnd = ?'); values.push(date(query.periodEnd, 'Period end')) }
  if (query.search?.trim()) { filters.push('(CAST(d.BatchID AS CHAR) LIKE ? OR c.ClientName LIKE ? OR s.SiteName LIKE ?)'); values.push(...Array(3).fill(`%${query.search.trim()}%`)) }
  const sql = `SELECT d.BatchID, d.AgencyID, a.AgencyName, d.ClientID, c.ClientName, d.SiteID, s.SiteName, d.PeriodStart, d.PeriodEnd, d.Status, d.CreatedAt,
    COUNT(DISTINCT at.EmployeeID) AS PeopleCount, COALESCE(SUM(at.RegularHours), 0) AS RegularHours, COALESCE(SUM(at.OTHours), 0) AS OTHours, COALESCE(SUM(at.NightDiffHours), 0) AS NightDiffHours
    FROM attendance_dtr d INNER JOIN agency a ON a.AgencyID = d.AgencyID INNER JOIN client c ON c.ClientID = d.ClientID INNER JOIN site s ON s.SiteID = d.SiteID
    LEFT JOIN attendance at ON at.BatchID = d.BatchID ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    GROUP BY d.BatchID ORDER BY d.PeriodStart DESC, d.BatchID DESC`
  const [[items], lookupData] = await Promise.all([pool.execute<any[]>(sql, values), lookups()])
  return { items, ...lookupData }
}

export async function createDtr(event: any) {
  const session = requireSession(event)
  const body = await readBody<DtrBody>(event) || {}
  const agencyId = positiveId(body.AgencyID, 'Agency'), clientId = positiveId(body.ClientID, 'Client'), siteId = positiveId(body.SiteID, 'Site')
  const periodStart = date(body.PeriodStart, 'Period start'), periodEnd = date(body.PeriodEnd, 'Period end')
  if (periodStart > periodEnd) throw createError({ statusCode: 400, statusMessage: 'Period end must not be before period start.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await validateAssignment(connection, agencyId, clientId, siteId)
    await ensureUniqueBatch(connection, agencyId, siteId, periodStart, periodEnd)
    const [result] = await connection.execute<any>('INSERT INTO attendance_dtr (AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status, CreatedBy) VALUES (?, ?, ?, ?, ?, \'Draft\', ?)', [agencyId, clientId, siteId, periodStart, periodEnd, session.sub])
    await connection.commit()
    return { id: result.insertId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateDtr(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event); const body = await readBody<DtrBody>(event) || {}
  const agencyId = positiveId(body.AgencyID, 'Agency'), clientId = positiveId(body.ClientID, 'Client'), siteId = positiveId(body.SiteID, 'Site')
  const periodStart = date(body.PeriodStart, 'Period start'), periodEnd = date(body.PeriodEnd, 'Period end')
  if (periodStart > periodEnd) throw createError({ statusCode: 400, statusMessage: 'Period end must not be before period start.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.execute<any[]>('SELECT Status FROM attendance_dtr WHERE BatchID = ? FOR UPDATE', [id])
    if (!current) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
    if (String(current.Status).startsWith('Computed') || current.Status === 'Locked' || current.Status === 'Approved') throw createError({ statusCode: 409, statusMessage: 'This DTR is already computed or locked and cannot be edited.' })
    await validateAssignment(connection, agencyId, clientId, siteId)
    await ensureUniqueBatch(connection, agencyId, siteId, periodStart, periodEnd, id)
    await connection.execute('UPDATE attendance_dtr SET AgencyID = ?, ClientID = ?, SiteID = ?, PeriodStart = ?, PeriodEnd = ?, Status = \'Draft\' WHERE BatchID = ?', [agencyId, clientId, siteId, periodStart, periodEnd, id])
    await connection.commit(); return { success: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function deleteDtr(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event); const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[usage]] = await connection.execute<any[]>('SELECT COUNT(*) AS Count FROM attendance WHERE BatchID = ?', [id])
    if (Number(usage.Count) > 0) throw createError({ statusCode: 409, statusMessage: 'This DTR has attendance records and cannot be deleted.' })
    const [result] = await connection.execute<any>('DELETE FROM attendance_dtr WHERE BatchID = ?', [id])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
    await connection.commit(); return { success: true, deleted: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function computeDtr(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event); const body = await readBody<{ target?: unknown }>(event)
  const target = body?.target === 'payroll' || body?.target === 'billing' ? body.target : null
  if (!target) throw createError({ statusCode: 400, statusMessage: 'Compute target must be payroll or billing.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.execute<any[]>('SELECT Status FROM attendance_dtr WHERE BatchID = ? FOR UPDATE', [id])
    if (!current) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
    if (current.Status === 'Locked' || current.Status === 'Approved') throw createError({ statusCode: 409, statusMessage: 'This DTR is locked and cannot be computed.' })
    const nextStatus = current.Status === 'Computed to Both'
      ? 'Computed to Both'
      : current.Status === 'Computed to Payroll' && target === 'billing' || current.Status === 'Computed to Billing' && target === 'payroll'
        ? 'Computed to Both'
        : target === 'payroll' ? 'Computed to Payroll' : 'Computed to Billing'
    await connection.execute('UPDATE attendance_dtr SET Status = ? WHERE BatchID = ?', [nextStatus, id])
    await connection.commit(); return { success: true, status: nextStatus }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function dtrSummary(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event)
  const [[summary]] = await pool.execute<any[]>(`SELECT d.BatchID, d.Status, COUNT(DISTINCT at.EmployeeID) AS PeopleCount, COUNT(at.AttendanceID) AS AttendanceCount,
    COALESCE(SUM(at.RegularHours), 0) AS RegularHours, COALESCE(SUM(at.OTHours), 0) AS OTHours, COALESCE(SUM(at.NightDiffHours), 0) AS NightDiffHours
    FROM attendance_dtr d LEFT JOIN attendance at ON at.BatchID = d.BatchID WHERE d.BatchID = ? GROUP BY d.BatchID`, [id])
  if (!summary) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
  return { summary }
}

const hourColumns = ['RegularHours', 'OTHours', 'OTExtHours', 'NightDiffHours', 'RestDayHours', 'RestDayOTHours', 'LegalHolidayHours', 'LegalHolidayOTHours', 'RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'SpecialHolidayHours', 'SpecialHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours', 'LateHours', 'UndertimeHours', 'BreakHours'] as const
type HourColumn = typeof hourColumns[number]

function hours(value: unknown, label: string) {
  if (value === '' || value === undefined || value === null) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) throw createError({ statusCode: 400, statusMessage: `${label} must be between 0 and 24.` })
  return parsed
}
function mysqlDateTime(value: unknown, label: string) {
  if (value === '' || value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) throw createError({ statusCode: 400, statusMessage: `${label} is invalid.` })
  return `${value.slice(0, 16).replace('T', ' ')}:00`
}
async function batchDetail(connection: any, id: number) {
  const [[batch]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status FROM attendance_dtr WHERE BatchID = ?', [id])
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
  return batch
}
function assertEditableBatch(batch: any) {
  if (String(batch.Status).startsWith('Computed') || batch.Status === 'Locked' || batch.Status === 'Approved') throw createError({ statusCode: 409, statusMessage: 'This DTR is already computed or locked and cannot be changed.' })
}

export async function listDtrRecords(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event)
  const connection = await pool.getConnection()
  try {
    const batch = await batchDetail(connection, id)
    const [[records], [shifts]] = await Promise.all([connection.execute<any[]>(`SELECT de.EmployeeID, e.EmployeeNumber,
      CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName, ed.DeploymentID, ed.DeploymentType,
      COUNT(at.AttendanceID) AS Days, ${hourColumns.map(column => `COALESCE(SUM(at.${column}), 0) AS ${column}`).join(', ')}
      FROM attendance_dtr_employee de INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
      INNER JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
      LEFT JOIN attendance at ON at.BatchID = de.BatchID AND at.EmployeeID = de.EmployeeID
      WHERE de.BatchID = ? GROUP BY de.EmployeeID, ed.DeploymentID, ed.DeploymentType, e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName
      ORDER BY e.LastName, e.FirstName`, [id]), connection.execute<any[]>(`SELECT ShiftCodeID, ShiftCode, ShiftName, TimeIn, TimeOut, RegularHours, RegularOTCap
        FROM shift_code WHERE AgencyID = ? AND Status = 'Active' ORDER BY ShiftCode, ShiftName`, [batch.AgencyID])])
    return { batch, records, shifts }
  } finally { connection.release() }
}

export async function listDtrEmployees(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event), query = getQuery(event) as Record<string, string | undefined>
  const connection = await pool.getConnection()
  try {
    const batch = await batchDetail(connection, id)
    const values: any[] = [batch.AgencyID]
    let searchSql = ''
    if (query.search?.trim()) {
      const value = `%${query.search.trim()}%`; values.push(value, value, value, value)
      searchSql = ' AND (CAST(e.EmployeeID AS CHAR) LIKE ? OR e.EmployeeNumber LIKE ? OR e.FirstName LIKE ? OR e.LastName LIKE ?)' 
    }
    const [employees] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber, CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName, p.PositionName
      FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      WHERE e.Status = 'Active' AND ap.AgencyID = ?${searchSql} ORDER BY e.LastName, e.FirstName`, values)
    return { employees }
  } finally { connection.release() }
}

export async function addDtrEmployee(event: any) {
  const session = requireSession(event)
  const id = batchId(event), body = await readBody<{ EmployeeID?: unknown, DeploymentType?: unknown }>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const deploymentType = body.DeploymentType === 'Reliever' ? 'Reliever' : body.DeploymentType === 'Regular' ? 'Regular' : null
  if (!deploymentType) throw createError({ statusCode: 400, statusMessage: 'Deployment type must be Regular or Reliever.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const [[rate]] = await connection.execute<any[]>(`SELECT cr.ClientRateID
      FROM employee e INNER JOIN payroll_rate employeeRate ON employeeRate.AgencyPositionID = e.AgencyPositionID
      INNER JOIN client_rate cr ON cr.PayrollRateID = employeeRate.PayrollRateID
      WHERE e.EmployeeID = ? AND cr.ClientID = ? AND cr.Status = 'Active' AND employeeRate.Status = 'Active' LIMIT 1`, [employeeId, batch.ClientID])
    if (!rate) throw createError({ statusCode: 400, statusMessage: 'This employee has no active matching client rate for the DTR site.' })
    const [[existing]] = await connection.execute<any[]>(`SELECT DeploymentID FROM employee_deployment
      WHERE EmployeeID = ? AND ClientRateID = ? AND SiteID = ? AND StartDate <= ? AND (EndDate IS NULL OR EndDate >= ?)
      ORDER BY StartDate DESC LIMIT 1`, [employeeId, rate.ClientRateID, batch.SiteID, batch.PeriodEnd, batch.PeriodStart])
    let deploymentId = existing?.DeploymentID
    if (!deploymentId) {
      const [result] = await connection.execute<any>(`INSERT INTO employee_deployment
        (EmployeeID, ClientRateID, SiteID, DeploymentType, StartDate, EndDate, Remarks, CreatedBy)
        VALUES (?, ?, ?, ?, ?, ?, 'Created from DTR attendance assignment', ?)`, [employeeId, rate.ClientRateID, batch.SiteID, deploymentType, batch.PeriodStart, batch.PeriodEnd, session.sub])
      deploymentId = result.insertId
    }
    await connection.execute('INSERT INTO attendance_dtr_employee (BatchID, EmployeeID, DeploymentID, CreatedBy) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE DeploymentID = VALUES(DeploymentID)', [id, employeeId, deploymentId, session.sub])
    await connection.commit(); return { success: true, deploymentId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateDtrEmployeeType(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event), body = await readBody<{ EmployeeID?: unknown, DeploymentType?: unknown }>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const deploymentType = body.DeploymentType === 'Reliever' ? 'Reliever' : body.DeploymentType === 'Regular' ? 'Regular' : null
  if (!deploymentType) throw createError({ statusCode: 400, statusMessage: 'Deployment type must be Regular or Reliever.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const [[enrollment]] = await connection.execute<any[]>('SELECT DeploymentID FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ? FOR UPDATE', [id, employeeId])
    if (!enrollment) throw createError({ statusCode: 404, statusMessage: 'Employee is not added to this DTR.' })
    await connection.execute('UPDATE employee_deployment SET DeploymentType = ? WHERE DeploymentID = ?', [deploymentType, enrollment.DeploymentID])
    await connection.commit(); return { success: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function createDtrAttendance(event: any) {
  const session = requireSession(event)
  const id = batchId(event), body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee'), attendanceDate = date(body.AttendanceDate, 'Attendance date')
  const shiftCodeId = body.ShiftCodeID === '' || body.ShiftCodeID === null || body.ShiftCodeID === undefined ? null : positiveId(body.ShiftCodeID, 'Shift code')
  const attendanceStatus = ['Present', 'Absent', 'Late', 'Half-Day', 'On-Leave', 'Holiday', 'Rest Day'].includes(String(body.AttendanceStatus)) ? String(body.AttendanceStatus) : 'Present'
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    if (attendanceDate < batch.PeriodStart || attendanceDate > batch.PeriodEnd) throw createError({ statusCode: 400, statusMessage: 'Attendance date must be inside the DTR cutoff.' })
    const [[deployment]] = await connection.execute<any[]>('SELECT DeploymentID FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ?', [id, employeeId])
    if (!deployment) throw createError({ statusCode: 400, statusMessage: 'Add the employee to this DTR before entering attendance.' })
    if (shiftCodeId) {
      const [[shift]] = await connection.execute<any[]>('SELECT ShiftCodeID FROM shift_code WHERE ShiftCodeID = ? AND AgencyID = ? AND Status = \'Active\'', [shiftCodeId, batch.AgencyID])
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Shift code must be active under this DTR agency.' })
    }
    const values = hourColumns.map(column => hours(body[column], column))
    const columns = hourColumns.join(', '), placeholders = hourColumns.map(() => '?').join(', ')
    const [result] = await connection.execute<any>(`INSERT INTO attendance
      (EmployeeID, DeploymentID, ShiftCodeID, BatchID, AttendanceDate, TimeIn, TimeOut, ${columns}, AttendanceStatus, IsManualEdit, Remarks, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${placeholders}, ?, 1, ?, ?)`, [employeeId, deployment.DeploymentID, shiftCodeId, id, attendanceDate, mysqlDateTime(body.TimeIn, 'Time in'), mysqlDateTime(body.TimeOut, 'Time out'), ...values, attendanceStatus, typeof body.Remarks === 'string' ? body.Remarks.trim() || null : null, session.sub])
    await connection.commit(); return { id: result.insertId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
