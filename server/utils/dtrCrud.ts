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

// MySQL may return DATE/DATETIME values either as a Date instance or an ISO
// string.  Batch filling must always iterate the calendar dates, never the
// serialized timestamp text (which would otherwise produce an empty range).
function databaseDate(value: unknown) {
  if (value instanceof Date) return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0')
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  if (!match) throw createError({ statusCode: 500, statusMessage: 'Invalid DTR cutoff date.' })
  return match[0]
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
    const [[current]] = await connection.execute<any[]>('SELECT Status FROM attendance_dtr WHERE BatchID = ? FOR UPDATE', [id])
    if (!current) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
    if (current.Status !== 'Draft') throw createError({ statusCode: 409, statusMessage: 'Only Draft DTRs can be deleted.' })
    const [attendanceResult] = await connection.execute<any>('DELETE FROM attendance WHERE BatchID = ?', [id])
    await connection.execute<any>('DELETE FROM attendance_dtr WHERE BatchID = ?', [id])
    await connection.commit(); return { success: true, deleted: true, deletedAttendanceRows: attendanceResult.affectedRows }
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
const holidayHourColumns = ['LegalHolidayHours', 'LegalHolidayOTHours', 'RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'SpecialHolidayHours', 'SpecialHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours'] as const
const ordinaryWorkedHourColumns = hourColumns.filter(column => ![...holidayHourColumns, 'LateHours', 'UndertimeHours', 'BreakHours'].includes(column))

// Saved zero-hour placeholders (for example Absent, Rest Day, and Reliever)
// belong in the audit trail, but are not days actually worked.
const workedHourColumns = hourColumns.filter(column => !['LateHours', 'UndertimeHours', 'BreakHours'].includes(column))
const attendanceStatuses = ['Present', 'Absent', 'Late', 'Half-Day', 'On-Leave', 'Holiday', 'Rest Day', 'Reliever'] as const
const noWorkAttendanceStatuses = new Set(['Absent', 'Rest Day', 'On-Leave', 'Reliever'])

function normalizeAttendanceStatus(value: unknown) {
  const status = String(value ?? '').trim()
  return (attendanceStatuses as readonly string[]).includes(status) ? status : 'Present'
}

function workedAttendanceCondition(prefix = '') {
  const field = (column: string) => `${prefix}${column}`
  const paidTime = workedHourColumns.map(column => `COALESCE(${field(column)}, 0) > 0`).join(' OR ')
  return `COALESCE(${field('AttendanceStatus')}, 'Present') NOT IN ('Absent', 'Rest Day', 'On-Leave', 'Reliever')
    AND (${paidTime} OR ${field('TimeIn')} IS NOT NULL OR ${field('TimeOut')} IS NOT NULL)`
}

function hours(value: unknown, label: string) {
  if (value === '' || value === undefined || value === null) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) throw createError({ statusCode: 400, statusMessage: `${label} must be between 0 and 24.` })
  return parsed
}
function mysqlDateTime(value: unknown, label: string) {
  if (value === '' || value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) throw createError({ statusCode: 400, statusMessage: `${label} must use YYYY-MM-DD HH:mm.` })
  return `${value.slice(0, 16).replace('T', ' ')}:00`
}
function normalizedOvernightTimeOut(timeIn: string | null, timeOut: string | null, shift: any) {
  if (!timeIn || !timeOut || !shift || String(shift.TimeOut).slice(0, 5) > String(shift.TimeIn).slice(0, 5)) return timeOut
  const start = new Date(timeIn.replace(' ', 'T')), end = new Date(timeOut.replace(' ', 'T'))
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end > start) return timeOut
  if (timeIn.slice(0, 10) !== timeOut.slice(0, 10)) return timeOut
  end.setDate(end.getDate() + 1)
  return end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0') + ' ' + String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0') + ':00'
}
function nightDifferentialHours(timeIn: string | null, timeOut: string | null, enabled: unknown, startTime: unknown, endTime: unknown) {
  if (!enabled || !timeIn || !timeOut || !startTime || !endTime) return 0
  const workStart = new Date(timeIn.replace(' ', 'T')), workEnd = new Date(timeOut.replace(' ', 'T'))
  if (!Number.isFinite(workStart.getTime()) || !Number.isFinite(workEnd.getTime()) || workEnd <= workStart) return 0
  const startClock = String(startTime).slice(0, 5), endClock = String(endTime).slice(0, 5)
  const cursor = new Date(workStart); cursor.setHours(0, 0, 0, 0); cursor.setDate(cursor.getDate() - 1)
  let totalMilliseconds = 0
  while (cursor <= workEnd) {
    const dateValue = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0')
    const windowStart = new Date(dateValue + 'T' + startClock)
    const windowEnd = new Date(dateValue + 'T' + endClock)
    if (endClock <= startClock) windowEnd.setDate(windowEnd.getDate() + 1)
    const overlapStart = Math.max(workStart.getTime(), windowStart.getTime())
    const overlapEnd = Math.min(workEnd.getTime(), windowEnd.getTime())
    if (overlapEnd > overlapStart) totalMilliseconds += overlapEnd - overlapStart
    cursor.setDate(cursor.getDate() + 1)
  }
  return Math.round((totalMilliseconds / 3600000) * 100) / 100
}
function nightDifferentialWindowHours(startTime: unknown, endTime: unknown) {
  if (!startTime || !endTime) return 0
  const [startHour, startMinute] = String(startTime).slice(0, 5).split(':').map(Number)
  const [endHour, endMinute] = String(endTime).slice(0, 5).split(':').map(Number)
  const start = startHour * 60 + startMinute, end = endHour * 60 + endMinute
  if (![start, end].every(Number.isFinite)) return 0
  const minutes = (end - start + 1440) % 1440
  return (minutes || 1440) / 60
}
async function batchDetail(connection: any, id: number) {
  const [[batch]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status FROM attendance_dtr WHERE BatchID = ?', [id])
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
  return batch
}
function assertEditableBatch(batch: any) {
  if (String(batch.Status).startsWith('Computed') || batch.Status === 'Locked' || batch.Status === 'Approved') throw createError({ statusCode: 409, statusMessage: 'This DTR is already computed or locked and cannot be changed.' })
}

// WDO is a persisted payroll marker, not a display-only total. A semi-monthly
// cutoff gets one WDO once 14 days were worked and two once 15+ were worked.
// The latest qualifying worked day(s) are marked so a status correction moves
// the marker deterministically within the same transaction.
async function syncAutoWdo(connection: any, batch: any, employeeId: number) {
  const periodStart = databaseDate(batch.PeriodStart), periodEnd = databaseDate(batch.PeriodEnd)
  const [workedRows] = await connection.execute<any[]>(`SELECT at.AttendanceID, at.WorkdayCount
    FROM attendance at
    WHERE BatchID = ? AND EmployeeID = ? AND AttendanceDate BETWEEN ? AND ?
    AND ${workedAttendanceCondition('at.')}
    ORDER BY at.AttendanceDate DESC, at.AttendanceID DESC
    FOR UPDATE`, [batch.BatchID, employeeId, periodStart, periodEnd])
  const workedDays = workedRows.reduce((total, row) => total + Math.max(1, Number(row.WorkdayCount || 1)), 0)
  const wdoCount = workedDays >= 15 ? 2 : workedDays >= 14 ? 1 : 0
  await connection.execute('UPDATE attendance SET IsWDO = 0 WHERE BatchID = ? AND EmployeeID = ?', [batch.BatchID, employeeId])
  if (wdoCount) {
    const markerIds = workedRows.slice(0, wdoCount).map(row => Number(row.AttendanceID))
    await connection.execute(`UPDATE attendance SET IsWDO = 1 WHERE AttendanceID IN (${markerIds.map(() => '?').join(', ')})`, markerIds)
  }
  return wdoCount
}

export async function listDtrRecords(event: any) {
  const session = requireSession(event)
  const id = batchId(event)
  const connection = await pool.getConnection()
  try {
    const batch = await batchDetail(connection, id)
    await syncBatchHolidays(connection, batch, session.sub)
    const holidays = await activeHolidaysByDate(connection, cutoffDates(batch.PeriodStart, batch.PeriodEnd))
    const [[records], [shifts], [attendanceRows], [dutyRows]] = await Promise.all([connection.execute<any[]>(`SELECT de.EmployeeID, e.EmployeeNumber,
      CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName, p.PositionName, ed.DeploymentID, de.AttendanceType AS DeploymentType, de.DefaultShiftCodeID,
      COALESCE(SUM(CASE WHEN ${workedAttendanceCondition('at.')} THEN at.WorkdayCount ELSE 0 END), 0) AS Days, COALESCE(SUM(CASE WHEN ${workedAttendanceCondition('at.')} THEN at.IsWDO ELSE 0 END), 0) AS WDODays, ${hourColumns.map(column => `COALESCE(SUM(at.${column}), 0) AS ${column}`).join(', ')}
      FROM attendance_dtr_employee de INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      INNER JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
      LEFT JOIN attendance at ON at.BatchID = de.BatchID AND at.EmployeeID = de.EmployeeID
      WHERE de.BatchID = ? GROUP BY de.EmployeeID, p.PositionName, ed.DeploymentID, de.AttendanceType, e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName
      ORDER BY e.LastName, e.FirstName, e.MiddleName`, [id]), connection.execute<any[]>(`SELECT ShiftCodeID, ShiftCode, ShiftName, ShiftType, TimeIn, TimeOut, RegularHours, RegularOTCap, WorkdayCount, NDEnabled, NDStartTime, NDEndTime
        FROM shift_code WHERE AgencyID = ? AND Status = 'Active' ORDER BY ShiftCode, ShiftName`, [batch.AgencyID]), connection.execute<any[]>(`SELECT at.AttendanceID, at.EmployeeID, at.AttendanceDate, at.ShiftCodeID, at.AttendanceStatus, at.AttendanceType, at.IsWDO, at.HolidayID,
        at.TimeIn, at.TimeOut, at.Remarks, at.WorkdayCount, ${hourColumns.map(column => `at.${column}`).join(', ')}, sc.ShiftCode, sc.ShiftName, sc.ShiftType, h.HolidayName, h.HolidayType,
        CASE WHEN EXISTS (
          SELECT 1 FROM attendance_duty flexible_duty
          INNER JOIN shift_code flexible_shift ON flexible_shift.ShiftCodeID = flexible_duty.ShiftCodeID
          WHERE flexible_duty.AttendanceID = at.AttendanceID AND flexible_shift.ShiftType = 'Flexible'
        ) AND EXISTS (
          SELECT 1 FROM attendance_duty scheduled_duty
          INNER JOIN shift_code scheduled_shift ON scheduled_shift.ShiftCodeID = scheduled_duty.ShiftCodeID
          WHERE scheduled_duty.AttendanceID = at.AttendanceID AND scheduled_shift.ShiftType <> 'Flexible'
        ) THEN 1 ELSE 0 END AS IsStraightDuty
        FROM attendance at LEFT JOIN shift_code sc ON sc.ShiftCodeID = at.ShiftCodeID LEFT JOIN holiday h ON h.HolidayID = at.HolidayID
        WHERE at.BatchID = ? ORDER BY at.EmployeeID, at.AttendanceDate`, [id]), connection.execute<any[]>(`SELECT at.EmployeeID, e.EmployeeNumber,
          CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName, at.AttendanceDate, at.AttendanceStatus,
          COALESCE(duty_shift.ShiftCode, saved_shift.ShiftCode) AS ShiftCode,
          COALESCE(duty.TimeIn, at.TimeIn) AS TimeIn, COALESCE(duty.TimeOut, at.TimeOut) AS TimeOut,
          COALESCE(duty.SourceRowNumber, 0) AS SourceRowNumber
          FROM attendance at
          INNER JOIN employee e ON e.EmployeeID = at.EmployeeID
          LEFT JOIN attendance_duty duty ON duty.AttendanceID = at.AttendanceID
          LEFT JOIN shift_code duty_shift ON duty_shift.ShiftCodeID = duty.ShiftCodeID
          LEFT JOIN shift_code saved_shift ON saved_shift.ShiftCodeID = at.ShiftCodeID
          WHERE at.BatchID = ? AND (duty.AttendanceDutyID IS NOT NULL OR at.TimeIn IS NOT NULL OR at.TimeOut IS NOT NULL)
          ORDER BY e.LastName, e.FirstName, e.MiddleName, at.AttendanceDate, duty.SourceRowNumber, at.AttendanceID`, [id])])
    return { batch, records, shifts, attendanceRows, dutyRows, holidays: Array.from(holidays, ([AttendanceDate, holiday]) => ({ AttendanceDate, ...holiday })) }
  } finally { connection.release() }
}

export async function listDtrEmployees(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event), query = getQuery(event) as Record<string, string | undefined>
  const connection = await pool.getConnection()
  try {
    const batch = await batchDetail(connection, id)
    const values: any[] = [batch.AgencyID, batch.ClientID]
    let searchSql = ''
    if (query.search?.trim()) {
      const value = `%${query.search.trim()}%`; values.push(value, value, value, value)
      searchSql = ' AND (CAST(e.EmployeeID AS CHAR) LIKE ? OR e.EmployeeNumber LIKE ? OR e.FirstName LIKE ? OR e.LastName LIKE ?)' 
    }
    const [employees] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber, CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName, p.PositionName
      FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      INNER JOIN payroll_rate pr ON pr.AgencyPositionID = e.AgencyPositionID
      INNER JOIN client_rate cr ON cr.PayrollRateID = pr.PayrollRateID
      INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      WHERE e.Status = 'Active' AND ap.AgencyID = ? AND cr.ClientID = ? AND pr.Status = 'Active' AND cr.Status = 'Active'${searchSql}
      GROUP BY e.EmployeeID, e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName, p.PositionName ORDER BY e.LastName, e.FirstName, e.MiddleName`, values)
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
    await connection.execute('INSERT INTO attendance_dtr_employee (BatchID, EmployeeID, DeploymentID, AttendanceType, CreatedBy) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE DeploymentID = VALUES(DeploymentID)', [id, employeeId, deploymentId, deploymentType, session.sub])
    await connection.commit(); return { success: true, deploymentId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function removeDtrEmployee(event: any) {
  const session = requireSession(event); void session.sub
  const id = batchId(event), body = await readBody<{ EmployeeID?: unknown }>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const [[enrollment]] = await connection.execute<any[]>(
      'SELECT EmployeeID FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ? FOR UPDATE',
      [id, employeeId],
    )
    if (!enrollment) throw createError({ statusCode: 404, statusMessage: 'Employee is not added to this DTR.' })
    const [attendanceResult] = await connection.execute<any>(
      'DELETE FROM attendance WHERE BatchID = ? AND EmployeeID = ?',
      [id, employeeId],
    )
    await connection.execute('DELETE FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ?', [id, employeeId])
    await connection.commit()
    return { success: true, deletedAttendanceRows: attendanceResult.affectedRows }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateDtrEmployeeType(event: any) {
  const session = requireSession(event)
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
    await connection.execute('UPDATE attendance_dtr_employee SET AttendanceType = ? WHERE BatchID = ? AND EmployeeID = ?', [deploymentType, id, employeeId])
    const [attendanceResult] = await connection.execute<any>(
      'UPDATE attendance SET AttendanceType = ?, UpdatedBy = ? WHERE BatchID = ? AND EmployeeID = ?',
      [deploymentType, session.sub, id, employeeId],
    )
    await connection.commit(); return { success: true, syncedAttendanceRows: attendanceResult.affectedRows }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

function dateTimeForShift(value: string, time: unknown, nextDay = false) {
  const dateValue = new Date(value + 'T00:00:00')
  if (nextDay) dateValue.setDate(dateValue.getDate() + 1)
  const timeValue = String(time).slice(0, 5)
  return dateValue.getFullYear() + '-' + String(dateValue.getMonth() + 1).padStart(2, '0') + '-' + String(dateValue.getDate()).padStart(2, '0') + ' ' + timeValue + ':00'
}

function cutoffDates(start: unknown, end: unknown) {
  const dates: string[] = []
  const periodStart = databaseDate(start), periodEnd = databaseDate(end)
  for (const value = new Date(periodStart + 'T00:00:00'); value <= new Date(periodEnd + 'T00:00:00'); value.setDate(value.getDate() + 1)) {
    dates.push(value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0'))
  }
  return dates
}

type ActiveHoliday = { HolidayID: number; HolidayName: string; HolidayType: 'Legal' | 'Special' }

async function activeHolidaysByDate(connection: any, dates: string[]) {
  const [rows] = await connection.execute<any[]>(`SELECT HolidayID, HolidayName, HolidayDate, HolidayType, Recurring
    FROM holiday WHERE Status = 'Active'`)
  const result = new Map<string, ActiveHoliday>()
  for (const attendanceDate of dates) {
    const monthDay = attendanceDate.slice(5)
    const match = rows
      .filter(holiday => databaseDate(holiday.HolidayDate) === attendanceDate || (Number(holiday.Recurring) === 1 && databaseDate(holiday.HolidayDate).slice(5) === monthDay))
      .sort((left, right) => {
        const leftExact = databaseDate(left.HolidayDate) === attendanceDate ? 0 : 1
        const rightExact = databaseDate(right.HolidayDate) === attendanceDate ? 0 : 1
        if (leftExact !== rightExact) return leftExact - rightExact
        if (left.HolidayType !== right.HolidayType) return left.HolidayType === 'Legal' ? -1 : 1
        return Number(left.HolidayID) - Number(right.HolidayID)
      })[0]
    if (match) result.set(attendanceDate, { HolidayID: Number(match.HolidayID), HolidayName: String(match.HolidayName), HolidayType: match.HolidayType })
  }
  return result
}

function holidayHours(values: number[], attendanceStatus: string, timeIn: string | null, timeOut: string | null, holiday?: ActiveHoliday) {
  const result = [...values]
  for (const column of holidayHourColumns) result[hourColumns.indexOf(column)] = 0
  const hasWork = !noWorkAttendanceStatuses.has(attendanceStatus) && (
    ordinaryWorkedHourColumns.some(column => Number(result[hourColumns.indexOf(column)] || 0) > 0) || Boolean(timeIn || timeOut)
  )
  if (!holiday || !hasWork) return { values: result, holidayId: null }

  const regularHours = Number(result[hourColumns.indexOf('RegularHours')] || 0)
  const overtimeHours = Number(result[hourColumns.indexOf('OTHours')] || 0) + Number(result[hourColumns.indexOf('OTExtHours')] || 0)
  if (holiday.HolidayType === 'Legal') {
    result[hourColumns.indexOf('LegalHolidayHours')] = regularHours
    result[hourColumns.indexOf('LegalHolidayOTHours')] = overtimeHours
  } else {
    result[hourColumns.indexOf('SpecialHolidayHours')] = regularHours
    result[hourColumns.indexOf('SpecialHolidayOTHours')] = overtimeHours
  }
  return { values: result, holidayId: holiday.HolidayID }
}

async function syncBatchHolidays(connection: any, batch: any, updatedBy: number) {
  // Computed/locked DTRs are payroll snapshots and must stay immutable.
  if (batch.Status !== 'Draft') return 0
  const dates = cutoffDates(batch.PeriodStart, batch.PeriodEnd)
  const holidays = await activeHolidaysByDate(connection, dates)
  const [attendanceRows] = await connection.execute<any[]>(`SELECT AttendanceID, AttendanceDate, AttendanceStatus, TimeIn, TimeOut, HolidayID,
    ${hourColumns.join(', ')} FROM attendance WHERE BatchID = ? FOR UPDATE`, [batch.BatchID])
  let changed = 0
  for (const row of attendanceRows) {
    const values = hourColumns.map(column => Number(row[column] || 0))
    const next = holidayHours(values, normalizeAttendanceStatus(row.AttendanceStatus), row.TimeIn, row.TimeOut, holidays.get(databaseDate(row.AttendanceDate)))
    const differs = Number(row.HolidayID || 0) !== Number(next.holidayId || 0) || holidayHourColumns.some(column => Number(row[column] || 0) !== Number(next.values[hourColumns.indexOf(column)] || 0))
    if (!differs) continue
    await connection.execute(`UPDATE attendance SET HolidayID = ?, ${holidayHourColumns.map(column => `${column} = ?`).join(', ')}, UpdatedBy = ? WHERE AttendanceID = ?`, [next.holidayId, ...holidayHourColumns.map(column => next.values[hourColumns.indexOf(column)]), updatedBy, row.AttendanceID])
    changed++
  }
  return changed
}

async function applyDtrShiftBatchBody(event: any, body: { EmployeeID?: unknown, ShiftCodeID?: unknown, OnlyEmpty?: unknown }, session: any) {
  const id = batchId(event)
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const shiftCodeId = positiveId(body.ShiftCodeID, 'Shift code')
  const onlyEmpty = body.OnlyEmpty !== false
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const periodStart = databaseDate(batch.PeriodStart), periodEnd = databaseDate(batch.PeriodEnd)
    const [[enrollment]] = await connection.execute<any[]>('SELECT de.DeploymentID, de.AttendanceType FROM attendance_dtr_employee de WHERE de.BatchID = ? AND de.EmployeeID = ? FOR UPDATE', [id, employeeId])
    if (!enrollment) throw createError({ statusCode: 400, statusMessage: 'Add the employee to this DTR before applying a shift.' })
    const [[shift]] = await connection.execute<any[]>('SELECT ShiftCodeID, TimeIn, TimeOut, RegularHours, RegularOTCap, WorkdayCount, NDEnabled, NDStartTime, NDEndTime FROM shift_code WHERE ShiftCodeID = ? AND AgencyID = ? AND Status = \'Active\' FOR UPDATE', [shiftCodeId, batch.AgencyID])
    if (!shift) throw createError({ statusCode: 400, statusMessage: 'Shift code must be active under this DTR agency.' })
    if (!shift.TimeIn || !shift.TimeOut) throw createError({ statusCode: 400, statusMessage: 'A Flexible shift without default times cannot be applied to every cutoff day. Import or enter its biometric times per duty instead.' })
    const [currentRows] = await connection.execute<any[]>('SELECT AttendanceID, BatchID, AttendanceDate, AttendanceStatus FROM attendance WHERE EmployeeID = ? AND AttendanceDate BETWEEN ? AND ? FOR UPDATE', [employeeId, periodStart, periodEnd])
    const currentByDate = new Map(currentRows.map(row => [databaseDate(row.AttendanceDate), row]))
    const columns = hourColumns.join(', '), placeholders = hourColumns.map(() => '?').join(', ')
    const holidays = await activeHolidaysByDate(connection, cutoffDates(periodStart, periodEnd))
    let changed = 0
    for (const attendanceDate of cutoffDates(periodStart, periodEnd)) {
      const shiftTimeIn = dateTimeForShift(attendanceDate, shift.TimeIn)
      const shiftTimeOut = dateTimeForShift(attendanceDate, shift.TimeOut, String(shift.TimeOut).slice(0, 5) <= String(shift.TimeIn).slice(0, 5))
      const baseHourValues = hourColumns.map(column => column === 'RegularHours' ? Number(shift.RegularHours || 0) : column === 'OTHours' ? Number(shift.RegularOTCap || 0) : column === 'NightDiffHours' ? nightDifferentialHours(shiftTimeIn, shiftTimeOut, shift.NDEnabled, shift.NDStartTime, shift.NDEndTime) : 0)
      const holiday = holidayHours(baseHourValues, 'Present', shiftTimeIn, shiftTimeOut, holidays.get(attendanceDate))
      const hourValues = holiday.values
      const current = currentByDate.get(attendanceDate)
      if (current && current.BatchID !== null && Number(current.BatchID) !== id) throw createError({ statusCode: 409, statusMessage: 'This employee already has attendance under another DTR on ' + attendanceDate + '.' })
      if (current) {
        // Legacy/unbatched attendance belongs to no DTR yet, so adopt it into this cutoff.
        // Only entries already belonging to this DTR are preserved by the blank-days option.
        if (current.BatchID !== null && onlyEmpty) continue
        const updateColumns = hourColumns.map(column => column + ' = ?').join(', ')
        // A cutoff apply is an intentional reset: replace every per-day status, manual
        // time/hours, holiday marker, and remark with the selected shift's clean values.
        await connection.execute('UPDATE attendance SET DeploymentID = ?, BatchID = ?, ShiftCodeID = ?, WorkdayCount = ?, TimeIn = ?, TimeOut = ?, ' + updateColumns + ', AttendanceStatus = \'Present\', AttendanceType = ?, HolidayID = ?, Remarks = NULL, IsManualEdit = 1, UpdatedBy = ? WHERE AttendanceID = ?', [enrollment.DeploymentID, id, shiftCodeId, shift.WorkdayCount, shiftTimeIn, shiftTimeOut, ...hourValues, enrollment.AttendanceType, holiday.holidayId, session.sub, current.AttendanceID])
      } else {
        await connection.execute<any>('INSERT INTO attendance (EmployeeID, DeploymentID, ShiftCodeID, WorkdayCount, BatchID, AttendanceDate, TimeIn, TimeOut, ' + columns + ', HolidayID, AttendanceStatus, AttendanceType, IsManualEdit, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ' + placeholders + ', ?, \'Present\', ?, 1, ?)', [employeeId, enrollment.DeploymentID, shiftCodeId, shift.WorkdayCount, id, attendanceDate, shiftTimeIn, shiftTimeOut, ...hourValues, holiday.holidayId, enrollment.AttendanceType, session.sub])
      }
      changed++
    }
    await connection.execute('UPDATE attendance_dtr_employee SET DefaultShiftCodeID = ? WHERE BatchID = ? AND EmployeeID = ?', [shiftCodeId, id, employeeId])
    const wdoCount = await syncAutoWdo(connection, batch, employeeId)
    await connection.commit()
    return { success: true, changed, onlyEmpty, wdoCount }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

async function resetDtrAttendanceBatchBody(event: any, body: { EmployeeID?: unknown }, session: any) {
  const id = batchId(event)
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  void session.sub
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const [[enrollment]] = await connection.execute<any[]>(
      'SELECT EmployeeID FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ? FOR UPDATE',
      [id, employeeId],
    )
    if (!enrollment) throw createError({ statusCode: 404, statusMessage: 'Employee is not added to this DTR.' })
    const [attendanceResult] = await connection.execute<any>(
      'DELETE FROM attendance WHERE BatchID = ? AND EmployeeID = ?',
      [id, employeeId],
    )
    await connection.execute('UPDATE attendance_dtr_employee SET DefaultShiftCodeID = NULL WHERE BatchID = ? AND EmployeeID = ?', [id, employeeId])
    await connection.commit()
    return { success: true, deletedAttendanceRows: attendanceResult.affectedRows }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

type ImportedDtrRow = {
  RowNumber?: unknown
  EmployeeID?: unknown
  EmployeeNumber?: unknown
  AttendanceDate?: unknown
  ShiftCode?: unknown
  DateIn?: unknown
  TimeIn?: unknown
  DateOut?: unknown
  TimeOut?: unknown
  AttendanceStatus?: unknown
}

function importText(value: unknown) { return String(value ?? '').trim() }
function importKey(value: unknown) { return importText(value).toUpperCase() }
function importedEmployeeId(value: unknown) {
  const match = importText(value).match(/^(?:EMP[- ]?)?0*(\d+)$/i)
  return match ? Number(match[1]) : null
}

async function importDtrAttendanceRows(event: any, body: { Rows?: unknown }, session: any) {
  const id = batchId(event)
  if (!Array.isArray(body.Rows) || !body.Rows.length) throw createError({ statusCode: 400, statusMessage: 'Choose an Excel file with at least one attendance row.' })
  if (body.Rows.length > 1000) throw createError({ statusCode: 400, statusMessage: 'Import a maximum of 1,000 rows at a time.' })
  const sourceRows = body.Rows as ImportedDtrRow[]
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const periodStart = databaseDate(batch.PeriodStart), periodEnd = databaseDate(batch.PeriodEnd)
    const [[enrollments], [shiftRows]] = await Promise.all([
      connection.execute<any[]>(`SELECT de.EmployeeID, de.DeploymentID, de.AttendanceType, e.EmployeeNumber
        FROM attendance_dtr_employee de INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
        WHERE de.BatchID = ? FOR UPDATE`, [id]),
      connection.execute<any[]>(`SELECT ShiftCodeID, ShiftCode, TimeIn, TimeOut, RegularHours, RegularOTCap, WorkdayCount,
          NDEnabled, NDStartTime, NDEndTime FROM shift_code
        WHERE AgencyID = ? AND Status = 'Active' FOR UPDATE`, [batch.AgencyID]),
    ])
    const enrollmentById = new Map(enrollments.map((row: any) => [Number(row.EmployeeID), row]))
    const enrollmentByNumber = new Map(enrollments.filter((row: any) => importKey(row.EmployeeNumber)).map((row: any) => [importKey(row.EmployeeNumber), row]))
    const shiftByCode = new Map(shiftRows.map((row: any) => [importKey(row.ShiftCode), row]))
    const holidays = await activeHolidaysByDate(connection, cutoffDates(periodStart, periodEnd))
    const columns = hourColumns.join(', '), placeholders = hourColumns.map(() => '?').join(', ')
    const affectedEmployeeIds = new Set<number>()
    const issues: { row: number; reason: string }[] = []
    let imported = 0, updated = 0, skipped = 0
    for (let index = 0; index < sourceRows.length; index++) {
      const source = sourceRows[index] || {}
      const rowNumber = Number(source.RowNumber) || index + 2
      const employeeValue = importText(source.EmployeeID)
      const employeeNumber = importText(source.EmployeeNumber)
      const attendanceDate = importText(source.AttendanceDate)
      const shiftCode = importText(source.ShiftCode)
      const skip = (reason: string) => { skipped++; if (issues.length < 12) issues.push({ row: rowNumber, reason }) }
      let enrollment = null as any
      const employeeId = importedEmployeeId(employeeValue)
      if (employeeId) enrollment = enrollmentById.get(employeeId) || null
      // Employee No. is the preferred value when that column is used.  An
      // exported EMP-0004 fallback in that same column still resolves by ID.
      if (!enrollment && employeeNumber) enrollment = enrollmentByNumber.get(importKey(employeeNumber)) || null
      if (!enrollment) { const fallbackEmployeeId = importedEmployeeId(employeeNumber); if (fallbackEmployeeId) enrollment = enrollmentById.get(fallbackEmployeeId) || null }
      // Some source files put the external employee number in the "Employee ID"
      // column (for example DJA-5157). Keep that supported as the final fallback.
      if (!enrollment) enrollment = enrollmentByNumber.get(importKey(employeeValue)) || null
      if (!enrollment) { skip('Employee ID / Employee No. is not in this DTR.'); continue }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) { skip('Date is missing or invalid.'); continue }
      if (attendanceDate < periodStart || attendanceDate > periodEnd) { skip('Date is outside this DTR cutoff.'); continue }
      const attendanceStatus = normalizeAttendanceStatus(source.AttendanceStatus)
      const noWorkStatus = noWorkAttendanceStatuses.has(attendanceStatus)
      const shift = noWorkStatus ? null : shiftByCode.get(importKey(shiftCode))
      if (!noWorkStatus && !shift) {
        skip(shiftCode ? `Shift code "${shiftCode}" does not exist or is inactive for this DTR agency.` : 'Shift code is blank.')
        continue
      }
      let timeIn: string | null = null, timeOut: string | null = null
      try {
        const importedTimeIn = importText(source.TimeIn), importedTimeOut = importText(source.TimeOut)
        timeIn = noWorkStatus || !importedTimeIn ? null : mysqlDateTime(importText(source.DateIn || attendanceDate) + ' ' + importedTimeIn, 'Time in')
        timeOut = noWorkStatus || !importedTimeOut ? null : mysqlDateTime(importText(source.DateOut || attendanceDate) + ' ' + importedTimeOut, 'Time out')
        if (!noWorkStatus && !timeIn) timeIn = dateTimeForShift(attendanceDate, shift.TimeIn)
        if (!noWorkStatus && !timeOut) timeOut = dateTimeForShift(attendanceDate, shift.TimeOut, String(shift.TimeOut).slice(0, 5) <= String(shift.TimeIn).slice(0, 5))
        timeOut = normalizedOvernightTimeOut(timeIn, timeOut, shift)
      } catch { skip('Date in/time in or date out/time out is invalid.'); continue }
      if (timeIn && timeOut && new Date(timeOut.replace(' ', 'T')) <= new Date(timeIn.replace(' ', 'T'))) { skip('Time out must be after time in.'); continue }
      const baseValues = noWorkStatus ? hourColumns.map(() => 0) : hourColumns.map(column =>
        column === 'RegularHours' ? Number(shift.RegularHours || 0) :
        column === 'OTHours' ? Number(shift.RegularOTCap || 0) :
        column === 'NightDiffHours' ? nightDifferentialHours(timeIn, timeOut, shift.NDEnabled, shift.NDStartTime, shift.NDEndTime) : 0,
      )
      const holiday = holidayHours(baseValues, attendanceStatus, timeIn, timeOut, holidays.get(attendanceDate))
      const [[existing]] = await connection.execute<any[]>('SELECT AttendanceID, BatchID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ? FOR UPDATE', [enrollment.EmployeeID, attendanceDate])
      if (existing && Number(existing.BatchID) !== id) { skip('Employee already has attendance under another DTR on this date.'); continue }
      if (existing) {
        await connection.execute(`UPDATE attendance SET DeploymentID = ?, ShiftCodeID = ?, WorkdayCount = ?, TimeIn = ?, TimeOut = ?, ${hourColumns.map(column => `${column} = ?`).join(', ')}, HolidayID = ?, AttendanceStatus = ?, AttendanceType = ?, IsManualEdit = 1, Remarks = NULL, UpdatedBy = ? WHERE AttendanceID = ?`, [enrollment.DeploymentID, shift?.ShiftCodeID || null, Number(shift?.WorkdayCount || 1), timeIn, timeOut, ...holiday.values, holiday.holidayId, attendanceStatus, enrollment.AttendanceType, session.sub, existing.AttendanceID])
        updated++
      } else {
        await connection.execute(`INSERT INTO attendance (EmployeeID, DeploymentID, ShiftCodeID, WorkdayCount, BatchID, AttendanceDate, TimeIn, TimeOut, ${columns}, HolidayID, AttendanceStatus, AttendanceType, IsManualEdit, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${placeholders}, ?, ?, ?, 1, ?)`, [enrollment.EmployeeID, enrollment.DeploymentID, shift?.ShiftCodeID || null, Number(shift?.WorkdayCount || 1), id, attendanceDate, timeIn, timeOut, ...holiday.values, holiday.holidayId, attendanceStatus, enrollment.AttendanceType, session.sub])
        imported++
      }
      affectedEmployeeIds.add(Number(enrollment.EmployeeID))
    }
    for (const employeeId of affectedEmployeeIds) await syncAutoWdo(connection, batch, employeeId)
    await connection.commit()
    return { success: true, imported, updated, skipped, issues }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

function importedDutyDuration(timeIn: string | null, timeOut: string | null) {
  if (!timeIn || !timeOut) return 0
  const start = new Date(timeIn.replace(' ', 'T')).getTime(), end = new Date(timeOut.replace(' ', 'T')).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round(((end - start) / 3600000) * 100) / 100
}

function importedDutyHours(shift: any, attendanceDate: string, timeIn: string, timeOut: string, referenceShift?: any) {
  const values = hourColumns.map(() => 0)
  if (String(shift.ShiftType) === 'Flexible') {
    const duration = importedDutyDuration(timeIn, timeOut)
    const regularLimit = Number(shift.RegularHours || 0), otLimit = Number(shift.RegularOTCap || 0)
    // An augmentation shorter than the regular block is extra work only. Once
    // it reaches that block, the first block is regular and the remainder is OT.
    const regularHours = duration >= regularLimit && regularLimit > 0 ? regularLimit : 0
    const overtime = Math.max(0, duration - regularHours)
    values[hourColumns.indexOf('RegularHours')] = regularHours
    values[hourColumns.indexOf('OTHours')] = Math.min(overtime, otLimit)
    values[hourColumns.indexOf('OTExtHours')] = Math.max(0, overtime - otLimit)
    // A Flexible augmentation has no default time of its own. If it follows a
    // scheduled duty on the same DTR date, use that duty's scheduled end as its
    // import-only reference start to calculate late and undertime minutes.
    if (referenceShift?.TimeIn && referenceShift?.TimeOut) {
      const referenceStart = dateTimeForShift(attendanceDate, referenceShift.TimeOut, String(referenceShift.TimeOut).slice(0, 5) <= String(referenceShift.TimeIn).slice(0, 5))
      const referenceStartDate = new Date(referenceStart.replace(' ', 'T'))
      const referenceRegularEndDate = new Date(referenceStartDate.getTime() + regularLimit * 3600000)
      const referenceEndDate = new Date(referenceStartDate.getTime() + (regularLimit + otLimit) * 3600000)
      const actualIn = new Date(timeIn.replace(' ', 'T')), actualOut = new Date(timeOut.replace(' ', 'T'))
      const rounded = (value: number) => Math.round(Math.max(0, value) * 100) / 100
      // Late does not consume the employee's earned extension. The actual
      // time out is compared directly with the reference shift end.
      values[hourColumns.indexOf('RegularHours')] = Math.min(regularLimit, rounded((actualOut.getTime() - referenceStartDate.getTime()) / 3600000))
      values[hourColumns.indexOf('OTHours')] = Math.min(otLimit, rounded((actualOut.getTime() - referenceRegularEndDate.getTime()) / 3600000))
      values[hourColumns.indexOf('OTExtHours')] = rounded((actualOut.getTime() - referenceEndDate.getTime()) / 3600000)
      values[hourColumns.indexOf('LateHours')] = rounded((actualIn.getTime() - referenceStartDate.getTime()) / 3600000)
      values[hourColumns.indexOf('UndertimeHours')] = rounded((referenceEndDate.getTime() - actualOut.getTime()) / 3600000)
    }
  } else {
    const regularLimit = Number(shift.RegularHours || 0), otLimit = Number(shift.RegularOTCap || 0)
    const scheduledIn = dateTimeForShift(attendanceDate, shift.TimeIn)
    const scheduledOut = dateTimeForShift(attendanceDate, shift.TimeOut, String(shift.TimeOut).slice(0, 5) <= String(shift.TimeIn).slice(0, 5))
    const actualIn = new Date(timeIn.replace(' ', 'T')), actualOut = new Date(timeOut.replace(' ', 'T'))
    const scheduledStart = new Date(scheduledIn.replace(' ', 'T')), scheduledEnd = new Date(scheduledOut.replace(' ', 'T'))
    const regularEnd = new Date(scheduledStart.getTime() + regularLimit * 3600000)
    const rounded = (value: number) => Math.round(Math.max(0, value) * 100) / 100
    const workedThroughRegular = rounded((actualOut.getTime() - scheduledStart.getTime()) / 3600000)
    const overtimeAfterRegular = rounded((actualOut.getTime() - regularEnd.getTime()) / 3600000)
    values[hourColumns.indexOf('RegularHours')] = Math.min(regularLimit, workedThroughRegular)
    values[hourColumns.indexOf('OTHours')] = Math.min(otLimit, overtimeAfterRegular)
    // Time after the schedule's configured time out is extension, including minutes.
    values[hourColumns.indexOf('OTExtHours')] = rounded((actualOut.getTime() - scheduledEnd.getTime()) / 3600000)
    values[hourColumns.indexOf('LateHours')] = rounded((actualIn.getTime() - scheduledStart.getTime()) / 3600000)
    values[hourColumns.indexOf('UndertimeHours')] = rounded((regularEnd.getTime() - actualOut.getTime()) / 3600000)
  }
  const nightHours = nightDifferentialHours(timeIn, timeOut, shift.NDEnabled, shift.NDStartTime, shift.NDEndTime)
  // One flexible augmentation represents one extra duty, even when the raw
  // biometric range crosses more than one calendar night.
  values[hourColumns.indexOf('NightDiffHours')] = String(shift.ShiftType) === 'Flexible'
    ? Math.min(nightHours, nightDifferentialWindowHours(shift.NDStartTime, shift.NDEndTime))
    : nightHours
  return values
}

async function importDtrAttendanceDutyRows(event: any, body: { Rows?: unknown }, session: any) {
  const id = batchId(event)
  if (!Array.isArray(body.Rows) || !body.Rows.length) throw createError({ statusCode: 400, statusMessage: 'Choose an Excel file with at least one attendance row.' })
  if (body.Rows.length > 1000) throw createError({ statusCode: 400, statusMessage: 'Import a maximum of 1,000 rows at a time.' })
  const sourceRows = body.Rows as ImportedDtrRow[]
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    const periodStart = databaseDate(batch.PeriodStart), periodEnd = databaseDate(batch.PeriodEnd)
    const [[enrollments], [shiftRows]] = await Promise.all([
      connection.execute<any[]>(`SELECT de.EmployeeID, de.DeploymentID, de.AttendanceType, e.EmployeeNumber
        FROM attendance_dtr_employee de INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
        WHERE de.BatchID = ? FOR UPDATE`, [id]),
      connection.execute<any[]>(`SELECT ShiftCodeID, ShiftCode, ShiftType, TimeIn, TimeOut, RegularHours, RegularOTCap, WorkdayCount,
          NDEnabled, NDStartTime, NDEndTime FROM shift_code WHERE AgencyID = ? AND Status = 'Active' FOR UPDATE`, [batch.AgencyID]),
    ])
    const enrollmentById = new Map(enrollments.map((row: any) => [Number(row.EmployeeID), row]))
    const enrollmentByNumber = new Map(enrollments.filter((row: any) => importKey(row.EmployeeNumber)).map((row: any) => [importKey(row.EmployeeNumber), row]))
    const shiftByCode = new Map(shiftRows.map((row: any) => [importKey(row.ShiftCode), row]))
    const holidays = await activeHolidaysByDate(connection, cutoffDates(periodStart, periodEnd))
    const clearedDutyAttendanceIds = new Set<number>(), affectedEmployeeIds = new Set<number>()
    const issues: { row: number; reason: string }[] = []
    let imported = 0, updated = 0, skipped = 0, blank = 0, cleared = 0
    for (let index = 0; index < sourceRows.length; index++) {
      const source = sourceRows[index] || {}, rowNumber = Number(source.RowNumber) || index + 2
      const employeeValue = importText(source.EmployeeID), employeeNumber = importText(source.EmployeeNumber)
      const attendanceDate = importText(source.AttendanceDate), shiftCode = importText(source.ShiftCode)
      const skip = (reason: string) => { skipped++; if (issues.length < 12) issues.push({ row: rowNumber, reason }) }
      let enrollment = null as any
      const employeeId = importedEmployeeId(employeeValue)
      if (employeeId) enrollment = enrollmentById.get(employeeId) || null
      if (!enrollment && employeeNumber) enrollment = enrollmentByNumber.get(importKey(employeeNumber)) || null
      if (!enrollment) { const fallbackEmployeeId = importedEmployeeId(employeeNumber); if (fallbackEmployeeId) enrollment = enrollmentById.get(fallbackEmployeeId) || null }
      if (!enrollment) enrollment = enrollmentByNumber.get(importKey(employeeValue)) || null
      if (!enrollment) { skip('Employee ID / Employee No. is not in this DTR.'); continue }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) { skip('Date is missing or invalid.'); continue }
      if (attendanceDate < periodStart || attendanceDate > periodEnd) { skip('Date is outside this DTR cutoff.'); continue }
      const attendanceStatus = normalizeAttendanceStatus(source.AttendanceStatus), noWorkStatus = noWorkAttendanceStatuses.has(attendanceStatus)
      const importedTimeIn = importText(source.TimeIn), importedTimeOut = importText(source.TimeOut)
      // A shift code in the source is only a label.  Without both biometric
      // timestamps, this employee did not work that row and the DTR stays blank.
      if (!importedTimeIn || !importedTimeOut) {
        blank++
        const [[existingBlank]] = await connection.execute<any[]>('SELECT AttendanceID, BatchID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ? FOR UPDATE', [enrollment.EmployeeID, attendanceDate])
        if (existingBlank && existingBlank.BatchID !== null && Number(existingBlank.BatchID) !== id) { skip('Employee already has attendance under another DTR on this date.'); continue }
        const existingAttendanceId = Number(existingBlank?.AttendanceID || 0)
        // Do not remove a valid earlier duty for the same employee/date when a
        // second spreadsheet row is merely blank (for example, empty augmentation).
        if (existingAttendanceId && Number(existingBlank.BatchID) === id && !clearedDutyAttendanceIds.has(existingAttendanceId)) {
          await connection.execute('DELETE FROM attendance WHERE AttendanceID = ?', [existingAttendanceId])
          affectedEmployeeIds.add(Number(enrollment.EmployeeID)); cleared++
        }
        continue
      }
      const shift = noWorkStatus ? null : shiftByCode.get(importKey(shiftCode))
      if (!noWorkStatus && !shift) { skip(shiftCode ? `Shift code "${shiftCode}" does not exist or is inactive for this DTR agency.` : 'Shift code is blank.'); continue }
      let timeIn: string | null = null, timeOut: string | null = null
      try {
        timeIn = noWorkStatus ? null : mysqlDateTime(importText(source.DateIn || attendanceDate) + ' ' + importedTimeIn, 'Time in')
        timeOut = noWorkStatus ? null : mysqlDateTime(importText(source.DateOut || attendanceDate) + ' ' + importedTimeOut, 'Time out')
        timeOut = normalizedOvernightTimeOut(timeIn, timeOut, shift)
      } catch { skip('Date in/time in or date out/time out is invalid.'); continue }
      if (!noWorkStatus && (!timeIn || !timeOut)) { skip('Time in and time out are required for this shift.'); continue }
      if (timeIn && timeOut && new Date(timeOut.replace(' ', 'T')) <= new Date(timeIn.replace(' ', 'T'))) { skip('Time out must be after time in.'); continue }
      const [[existing]] = await connection.execute<any[]>('SELECT AttendanceID, BatchID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ? FOR UPDATE', [enrollment.EmployeeID, attendanceDate])
      if (existing && existing.BatchID !== null && Number(existing.BatchID) !== id) { skip('Employee already has attendance under another DTR on this date.'); continue }
      let attendanceId = Number(existing?.AttendanceID || 0)
      if (!attendanceId) {
        const [result] = await connection.execute<any>(`INSERT INTO attendance (EmployeeID, DeploymentID, ShiftCodeID, WorkdayCount, BatchID, AttendanceDate, TimeIn, TimeOut, ${hourColumns.join(', ')}, HolidayID, AttendanceStatus, AttendanceType, IsManualEdit, CreatedBy) VALUES (?, ?, ?, 1, ?, ?, NULL, NULL, ${hourColumns.map(() => '?').join(', ')}, NULL, ?, ?, 1, ?)`, [enrollment.EmployeeID, enrollment.DeploymentID, null, id, attendanceDate, ...hourColumns.map(() => 0), attendanceStatus, enrollment.AttendanceType, session.sub])
        attendanceId = Number(result.insertId); imported++
      } else updated++
      if (!clearedDutyAttendanceIds.has(attendanceId)) {
        await connection.execute('DELETE FROM attendance_duty WHERE AttendanceID = ?', [attendanceId])
        clearedDutyAttendanceIds.add(attendanceId)
      }
      if (!noWorkStatus) {
        let referenceShift: any = null
        if (String(shift.ShiftType) === 'Flexible') {
          const [[reference]] = await connection.execute<any[]>(`SELECT sc.TimeIn, sc.TimeOut
            FROM attendance_duty ad INNER JOIN shift_code sc ON sc.ShiftCodeID = ad.ShiftCodeID
            WHERE ad.AttendanceID = ? AND sc.ShiftType <> 'Flexible'
            ORDER BY ad.TimeOut DESC LIMIT 1`, [attendanceId])
          referenceShift = reference || null
        }
        const dutyValues = importedDutyHours(shift, attendanceDate, timeIn!, timeOut!, referenceShift)
        await connection.execute(`INSERT INTO attendance_duty (AttendanceID, ShiftCodeID, SourceRowNumber, TimeIn, TimeOut, RegularHours, OTHours, OTExtHours, NightDiffHours, LateHours, UndertimeHours, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ShiftCodeID = VALUES(ShiftCodeID), TimeIn = VALUES(TimeIn), TimeOut = VALUES(TimeOut), RegularHours = VALUES(RegularHours), OTHours = VALUES(OTHours), OTExtHours = VALUES(OTExtHours), NightDiffHours = VALUES(NightDiffHours), LateHours = VALUES(LateHours), UndertimeHours = VALUES(UndertimeHours), UpdatedBy = VALUES(CreatedBy)`, [attendanceId, shift.ShiftCodeID, rowNumber, timeIn, timeOut, dutyValues[hourColumns.indexOf('RegularHours')], dutyValues[hourColumns.indexOf('OTHours')], dutyValues[hourColumns.indexOf('OTExtHours')], dutyValues[hourColumns.indexOf('NightDiffHours')], dutyValues[hourColumns.indexOf('LateHours')], dutyValues[hourColumns.indexOf('UndertimeHours')], session.sub])
      }
      const [[summary]] = await connection.execute<any[]>(`SELECT COUNT(*) AS DutyCount, MIN(TimeIn) AS TimeIn, MAX(TimeOut) AS TimeOut,
        MIN(ShiftCodeID) AS OnlyShiftCodeID, COALESCE(SUM(RegularHours), 0) AS RegularHours, COALESCE(SUM(OTHours), 0) AS OTHours,
        COALESCE(SUM(OTExtHours), 0) AS OTExtHours, COALESCE(SUM(NightDiffHours), 0) AS NightDiffHours,
        COALESCE(SUM(LateHours), 0) AS LateHours, COALESCE(SUM(UndertimeHours), 0) AS UndertimeHours
        FROM attendance_duty WHERE AttendanceID = ? FOR UPDATE`, [attendanceId])
      const baseValues = hourColumns.map(column => Number(summary[column] || 0))
      const holiday = holidayHours(baseValues, attendanceStatus, summary.TimeIn, summary.TimeOut, holidays.get(attendanceDate))
      const payableDays = noWorkStatus ? 1 : Math.max(1, Math.floor(Number(summary.RegularHours || 0) / 8))
      const summaryShiftCodeId = Number(summary.DutyCount || 0) === 1 ? Number(summary.OnlyShiftCodeID) : null
      await connection.execute(`UPDATE attendance SET DeploymentID = ?, BatchID = ?, ShiftCodeID = ?, WorkdayCount = ?, TimeIn = ?, TimeOut = ?, ${hourColumns.map(column => `${column} = ?`).join(', ')}, HolidayID = ?, AttendanceStatus = ?, AttendanceType = ?, IsManualEdit = 1, Remarks = NULL, UpdatedBy = ? WHERE AttendanceID = ?`, [enrollment.DeploymentID, id, summaryShiftCodeId, payableDays, summary.TimeIn || null, summary.TimeOut || null, ...holiday.values, holiday.holidayId, attendanceStatus, enrollment.AttendanceType, session.sub, attendanceId])
      affectedEmployeeIds.add(Number(enrollment.EmployeeID))
    }
    for (const employeeId of affectedEmployeeIds) await syncAutoWdo(connection, batch, employeeId)
    await connection.commit()
    return { success: true, imported, updated, skipped, blank, cleared, issues }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function applyDtrShiftBatch(event: any) {
  const session = requireSession(event)
  const body = await readBody<{ EmployeeID?: unknown, ShiftCodeID?: unknown, OnlyEmpty?: unknown }>(event) || {}
  return applyDtrShiftBatchBody(event, body, session)
}

export async function createDtrAttendance(event: any) {
  const session = requireSession(event)
  const id = batchId(event), body = await readBody<Record<string, unknown>>(event) || {}
  // Kept on the established /records endpoint too so an already-running Nitro dev
  // server can process batch fills without needing to discover a newly added route.
  if (body.ApplyBatch === true) return applyDtrShiftBatchBody(event, body, session)
  if (body.ResetBatch === true) return resetDtrAttendanceBatchBody(event, body, session)
  if (body.ImportRows === true) return importDtrAttendanceDutyRows(event, body, session)
  const employeeId = positiveId(body.EmployeeID, 'Employee'), attendanceDate = date(body.AttendanceDate, 'Attendance date')
  const requestedShiftCodeId = body.ShiftCodeID === '' || body.ShiftCodeID === null || body.ShiftCodeID === undefined ? null : positiveId(body.ShiftCodeID, 'Shift code')
  const attendanceStatus = normalizeAttendanceStatus(body.AttendanceStatus)
  const noWorkStatus = noWorkAttendanceStatuses.has(attendanceStatus)
  const shiftCodeId = noWorkStatus ? null : requestedShiftCodeId
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchDetail(connection, id); assertEditableBatch(batch)
    if (attendanceDate < batch.PeriodStart || attendanceDate > batch.PeriodEnd) throw createError({ statusCode: 400, statusMessage: 'Attendance date must be inside the DTR cutoff.' })
    const [[deployment]] = await connection.execute<any[]>('SELECT DeploymentID, AttendanceType FROM attendance_dtr_employee WHERE BatchID = ? AND EmployeeID = ?', [id, employeeId])
    if (!deployment) throw createError({ statusCode: 400, statusMessage: 'Add the employee to this DTR before entering attendance.' })
    const attendanceType = deployment.AttendanceType === 'Reliever' ? 'Reliever' : 'Regular'
    let shift: any = null
    if (shiftCodeId) {
      const [[activeShift]] = await connection.execute<any[]>('SELECT ShiftCodeID, TimeIn, TimeOut, WorkdayCount, NDEnabled, NDStartTime, NDEndTime FROM shift_code WHERE ShiftCodeID = ? AND AgencyID = ? AND Status = \'Active\'', [shiftCodeId, batch.AgencyID])
      shift = activeShift
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Shift code must be active under this DTR agency.' })
    }
    const timeIn = noWorkStatus ? null : mysqlDateTime(body.TimeIn, 'Time in')
    const timeOut = noWorkStatus ? null : normalizedOvernightTimeOut(timeIn, mysqlDateTime(body.TimeOut, 'Time out'), shift)
    if (timeIn && timeOut && new Date(timeOut.replace(' ', 'T')) <= new Date(timeIn.replace(' ', 'T'))) throw createError({ statusCode: 400, statusMessage: 'Time out must be after time in. For an overnight shift, use the next calendar date.' })
    const baseValues = noWorkStatus
      ? hourColumns.map(() => 0)
      : hourColumns.map(column => column === 'NightDiffHours' && shift ? nightDifferentialHours(timeIn, timeOut, shift.NDEnabled, shift.NDStartTime, shift.NDEndTime) : hours(body[column], column))
    const matchingHolidays = await activeHolidaysByDate(connection, [attendanceDate])
    const holiday = holidayHours(baseValues, attendanceStatus, timeIn, timeOut, matchingHolidays.get(attendanceDate))
    const values = holiday.values
    const workdayCount = Number(shift?.WorkdayCount || 1)
    const columns = hourColumns.join(', '), placeholders = hourColumns.map(() => '?').join(', ')
    const remarks = typeof body.Remarks === 'string' ? body.Remarks.trim() || null : null
    const [[existing]] = await connection.execute<any[]>('SELECT AttendanceID, BatchID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ? FOR UPDATE', [employeeId, attendanceDate])
    if (existing && Number(existing.BatchID) !== id) throw createError({ statusCode: 409, statusMessage: 'This employee already has attendance under another DTR for this date.' })
    if (existing) {
      await connection.execute(`UPDATE attendance SET DeploymentID = ?, ShiftCodeID = ?, WorkdayCount = ?, TimeIn = ?, TimeOut = ?, ${hourColumns.map(column => `${column} = ?`).join(', ')}, HolidayID = ?, AttendanceStatus = ?, AttendanceType = ?, IsManualEdit = 1, Remarks = ?, UpdatedBy = ? WHERE AttendanceID = ?`, [deployment.DeploymentID, shiftCodeId, workdayCount, timeIn, timeOut, ...values, holiday.holidayId, attendanceStatus, attendanceType, remarks, session.sub, existing.AttendanceID])
      const wdoCount = await syncAutoWdo(connection, batch, employeeId)
      await connection.commit(); return { id: existing.AttendanceID, updated: true, wdoCount }
    }
    const [result] = await connection.execute<any>(`INSERT INTO attendance
      (EmployeeID, DeploymentID, ShiftCodeID, WorkdayCount, BatchID, AttendanceDate, TimeIn, TimeOut, ${columns}, HolidayID, AttendanceStatus, AttendanceType, IsManualEdit, Remarks, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${placeholders}, ?, ?, ?, 1, ?, ?)`, [employeeId, deployment.DeploymentID, shiftCodeId, workdayCount, id, attendanceDate, timeIn, timeOut, ...values, holiday.holidayId, attendanceStatus, attendanceType, remarks, session.sub])
    const wdoCount = await syncAutoWdo(connection, batch, employeeId)
    await connection.commit(); return { id: result.insertId, updated: false, wdoCount }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
