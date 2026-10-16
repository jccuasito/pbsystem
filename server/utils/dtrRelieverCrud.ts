import { createError, getQuery } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

export async function listDtrRelieverAttendance(event: any) {
  const session = requireSession(event); void session.sub
  const query = getQuery(event)
  const periodStart = String(query.periodStart || '')
  const periodEnd = String(query.periodEnd || '')
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd || Date.parse(periodEnd) - Date.parse(periodStart) > 30 * 86400000) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid cutoff.' })
  }
  const agencyId = query.agencyId === undefined || query.agencyId === '' ? null : Number(query.agencyId)
  if (agencyId !== null && (!Number.isInteger(agencyId) || agencyId <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid agency.' })
  }
  const [agencies] = await pool.execute<any[]>(`SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName`)
  const [rows] = await pool.execute<any[]>(`SELECT at.AttendanceID, at.EmployeeID, e.EmployeeNumber,
      CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
      ad.BatchID, ad.Status AS DtrStatus, ad.AgencyID, a.AgencyName, c.ClientName, s.SiteName,
      DATE_FORMAT(at.AttendanceDate, '%Y-%m-%d') AS AttendanceDate,
      at.AttendanceStatus, at.WorkdayCount, at.RegularHours, at.OTHours, at.OTExtHours,
      at.NightDiffHours, at.RestDayHours, at.RestDayOTHours,
      DATE_FORMAT(at.TimeIn, '%Y-%m-%d %H:%i') AS TimeIn,
      DATE_FORMAT(at.TimeOut, '%Y-%m-%d %H:%i') AS TimeOut,
      sc.ShiftCode, COALESCE(at.WorkPositionName, p.PositionName) AS PositionName
    FROM attendance at
    INNER JOIN attendance_dtr ad ON ad.BatchID = at.BatchID
    INNER JOIN attendance_dtr_employee de ON de.BatchID = ad.BatchID AND de.EmployeeID = at.EmployeeID
    INNER JOIN employee e ON e.EmployeeID = at.EmployeeID
    INNER JOIN agency a ON a.AgencyID = ad.AgencyID
    INNER JOIN site s ON s.SiteID = ad.SiteID
    INNER JOIN client c ON c.ClientID = ad.ClientID
    INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
    LEFT JOIN shift_code sc ON sc.ShiftCodeID = at.ShiftCodeID
    WHERE de.AttendanceType = 'Reliever' AND at.AttendanceDate BETWEEN ? AND ?
      AND (? IS NULL OR ad.AgencyID = ?)
      AND at.AttendanceStatus NOT IN ('Absent', 'Rest Day', 'On-Leave', 'Vacation Leave', 'Reliever', 'Sick Leave')
      AND (at.TimeIn IS NOT NULL OR at.TimeOut IS NOT NULL OR at.RegularHours > 0
        OR at.RestDayHours > 0 OR at.SpecialHolidayHours > 0 OR at.LegalHolidayHours > 0)
    ORDER BY e.LastName, e.FirstName, at.AttendanceDate, s.SiteName, at.AttendanceID`,
  [periodStart, periodEnd, agencyId, agencyId])
  return { agencies, rows }
}
