import { createError, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

export const employeeStatusAttendanceStatuses = ['On-Leave', 'Vacation Leave', 'Sick Leave'] as const
const attendanceStatuses = employeeStatusAttendanceStatuses
const noWorkStatuses = new Set(attendanceStatuses)
const hourColumns = ['RegularHours', 'OTHours', 'OTExtHours', 'NightDiffHours', 'RestDayHours', 'RestDayOTHours', 'LegalHolidayHours', 'LegalHolidayOTHours', 'RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'SpecialHolidayHours', 'SpecialHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours', 'LateHours', 'UndertimeHours', 'BreakHours'] as const

function positiveId(value: unknown, label: string) {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return result
}

function date(value: unknown, label: string) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be a valid date.` })
  }
  return result
}

function datesBetween(start: string, end: string) {
  const result: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (result.length > 31) throw createError({ statusCode: 400, statusMessage: 'Update a maximum of 31 attendance dates at a time.' })
  }
  return result
}

export async function attachPendingEmployeeStatuses(connection: any, batch: any, updatedBy: unknown) {
  if (batch.Status !== 'Draft') return 0
  const [result] = await connection.execute<any>(`UPDATE attendance at
    INNER JOIN employee_deployment ed ON ed.DeploymentID = at.DeploymentID
    INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
    INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
    INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    INNER JOIN attendance_dtr_employee de ON de.BatchID = ? AND de.EmployeeID = at.EmployeeID AND de.DeploymentID = at.DeploymentID
    SET at.BatchID = ?, at.AttendanceType = de.AttendanceType, at.UpdatedBy = ?
    WHERE at.BatchID IS NULL AND at.AttendanceDate BETWEEN ? AND ?
      AND ap.AgencyID = ? AND cr.ClientID = ? AND ed.SiteID = ?`, [
    batch.BatchID, batch.BatchID, updatedBy, batch.PeriodStart, batch.PeriodEnd,
    batch.AgencyID, batch.ClientID, batch.SiteID,
  ])
  return Number(result.affectedRows || 0)
}

export async function listEmployeeStatus(event: any) {
  const session = requireSession(event)
  void session.sub
  const [employeesResult, deploymentsResult, cutoffsResult, dtrCutoffsResult, historyResult] = await Promise.all([
    pool.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber, e.Status,
      CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
      a.AgencyName, p.PositionName,
      ed.DeploymentID, ed.StartDate, ed.EndDate, c.ClientName, s.SiteName
      FROM employee e
      INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
      INNER JOIN agency a ON a.AgencyID = ap.AgencyID
      INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      LEFT JOIN employee_deployment ed ON ed.DeploymentID = (
        SELECT active_ed.DeploymentID FROM employee_deployment active_ed
        WHERE active_ed.EmployeeID = e.EmployeeID AND active_ed.IsPermanentSite = 1
          AND active_ed.StartDate <= CURDATE() AND (active_ed.EndDate IS NULL OR active_ed.EndDate >= CURDATE())
        ORDER BY active_ed.StartDate DESC, active_ed.DeploymentID DESC LIMIT 1
      )
      LEFT JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
      LEFT JOIN client c ON c.ClientID = cr.ClientID
      LEFT JOIN site s ON s.SiteID = ed.SiteID
      WHERE e.Status = 'Active'
      ORDER BY e.LastName, e.FirstName, e.MiddleName`),
    pool.execute<any[]>(`SELECT ed.DeploymentID, ed.EmployeeID, ed.DeploymentType, ed.StartDate, ed.EndDate,
      a.AgencyName, c.ClientName, s.SiteName
      FROM employee_deployment ed
      INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
      INNER JOIN client c ON c.ClientID = cr.ClientID
      INNER JOIN site s ON s.SiteID = ed.SiteID
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
      INNER JOIN agency a ON a.AgencyID = ap.AgencyID
      WHERE ed.IsPermanentSite = 1
      ORDER BY ed.StartDate DESC, ed.DeploymentID DESC`),
    pool.execute<any[]>(`SELECT de.EmployeeID, d.BatchID, d.PeriodStart, d.PeriodEnd, d.Status AS DtrStatus,
      ed.DeploymentID, c.ClientName, s.SiteName
      FROM attendance_dtr_employee de
      INNER JOIN attendance_dtr d ON d.BatchID = de.BatchID
      INNER JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
      INNER JOIN client c ON c.ClientID = d.ClientID
      INNER JOIN site s ON s.SiteID = d.SiteID
      ORDER BY d.PeriodStart DESC, d.BatchID DESC`),
    pool.execute<any[]>(`SELECT d.BatchID, d.AgencyID, a.AgencyName, d.PeriodStart, d.PeriodEnd, d.Status AS DtrStatus
      FROM attendance_dtr d
      INNER JOIN agency a ON a.AgencyID = d.AgencyID
      ORDER BY d.PeriodStart DESC, d.BatchID DESC`),
    pool.execute<any[]>(`SELECT at.AttendanceID, at.EmployeeID, at.BatchID, at.AttendanceDate, at.AttendanceStatus, at.Remarks,
      d.PeriodStart, d.PeriodEnd, d.Status AS DtrStatus,
      c.ClientName, s.SiteName
      FROM attendance at
      INNER JOIN employee_deployment ed ON ed.DeploymentID = at.DeploymentID
      INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
      INNER JOIN client c ON c.ClientID = cr.ClientID
      INNER JOIN site s ON s.SiteID = ed.SiteID
      LEFT JOIN attendance_dtr d ON d.BatchID = at.BatchID
      ORDER BY at.AttendanceDate DESC, at.AttendanceID DESC LIMIT 1000`),
  ])
  return {
    employees: employeesResult[0],
    deployments: deploymentsResult[0],
    cutoffs: cutoffsResult[0],
    dtrCutoffs: dtrCutoffsResult[0],
    history: historyResult[0],
    attendanceStatuses,
  }
}

export async function updateEmployeeDailyStatus(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const startDate = date(body.StartDate, 'Start date')
  const endDate = date(body.EndDate || body.StartDate, 'End date')
  if (endDate < startDate) throw createError({ statusCode: 400, statusMessage: 'End date must be on or after the start date.' })
  const selectedDates = datesBetween(startDate, endDate)
  const attendanceStatus = String(body.AttendanceStatus || '').trim()
  if (!(attendanceStatuses as readonly string[]).includes(attendanceStatus)) throw createError({ statusCode: 400, statusMessage: 'Select a valid attendance status.' })
  const remarks = typeof body.Remarks === 'string' ? body.Remarks.trim().slice(0, 255) || null : null
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[employee]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID = ? AND Status = \'Active\' FOR UPDATE', [employeeId])
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Active employee not found.' })
    const assignments: any[] = []
    for (const attendanceDate of selectedDates) {
      const [[deployment]] = await connection.execute<any[]>(`SELECT ed.DeploymentID, ed.DeploymentType, ed.SiteID, cr.ClientID, ap.AgencyID
        FROM employee_deployment ed
        INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
        INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
        INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
        WHERE ed.EmployeeID = ? AND ed.IsPermanentSite = 1
          AND ed.StartDate <= ? AND (ed.EndDate IS NULL OR ed.EndDate >= ?)
        ORDER BY ed.StartDate DESC, ed.DeploymentID DESC LIMIT 1 FOR UPDATE`, [employeeId, attendanceDate, attendanceDate])
      if (!deployment) throw createError({ statusCode: 409, statusMessage: `No site deployment covers ${attendanceDate}. Create or correct the deployment before saving the employee status.` })
      const [[batch]] = await connection.execute<any[]>(`SELECT BatchID, Status FROM attendance_dtr
        WHERE AgencyID = ? AND ClientID = ? AND SiteID = ? AND PeriodStart <= ? AND PeriodEnd >= ?
        ORDER BY PeriodStart DESC, BatchID DESC LIMIT 1 FOR UPDATE`, [deployment.AgencyID, deployment.ClientID, deployment.SiteID, attendanceDate, attendanceDate])
      if (batch && batch.Status !== 'Draft') throw createError({ statusCode: 409, statusMessage: `The DTR covering ${attendanceDate} is ${batch.Status} and can no longer be edited.` })
      const [[existing]] = await connection.execute<any[]>('SELECT AttendanceID, BatchID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ? FOR UPDATE', [employeeId, attendanceDate])
      if (existing?.BatchID && Number(existing.BatchID) !== Number(batch?.BatchID || 0)) {
        const [[sourceBatch]] = await connection.execute<any[]>('SELECT Status FROM attendance_dtr WHERE BatchID = ? FOR UPDATE', [existing.BatchID])
        if (sourceBatch && sourceBatch.Status !== 'Draft') throw createError({ statusCode: 409, statusMessage: `Attendance on ${attendanceDate} belongs to a ${sourceBatch.Status} DTR and cannot be changed.` })
      }
      assignments.push({ attendanceDate, deployment, batch: batch || null, existing: existing || null })
    }
    let updated = 0
    let created = 0
    let pending = 0
    for (const { attendanceDate, deployment, batch, existing } of assignments) {
      const attendanceType = deployment.DeploymentType === 'Reliever' ? 'Reliever' : 'Regular'
      if (batch) {
        await connection.execute(`INSERT INTO attendance_dtr_employee
          (BatchID, EmployeeID, DeploymentID, AttendanceType, IsPermanentSite, CreatedBy)
          VALUES (?, ?, ?, ?, 1, ?)
          ON DUPLICATE KEY UPDATE DeploymentID = VALUES(DeploymentID), AttendanceType = VALUES(AttendanceType)`, [batch.BatchID, employeeId, deployment.DeploymentID, attendanceType, session.sub])
      } else pending++
      const batchId = batch?.BatchID || null
      if (existing) {
        if (noWorkStatuses.has(attendanceStatus)) {
          await connection.execute('DELETE FROM attendance_duty WHERE AttendanceID = ?', [existing.AttendanceID])
          await connection.execute(`UPDATE attendance SET DeploymentID = ?, BatchID = ?, ShiftCodeID = NULL, TimeIn = NULL, TimeOut = NULL,
            ${hourColumns.map(column => `${column} = 0`).join(', ')}, HolidayID = NULL, AttendanceStatus = ?, AttendanceType = ?, IsWDO = 0,
            IsManualEdit = 1, Remarks = ?, UpdatedBy = ? WHERE AttendanceID = ?`, [deployment.DeploymentID, batchId, attendanceStatus, attendanceType, remarks, session.sub, existing.AttendanceID])
        } else {
          await connection.execute(`UPDATE attendance SET DeploymentID = ?, BatchID = ?, AttendanceStatus = ?, AttendanceType = ?,
            IsManualEdit = 1, Remarks = ?, UpdatedBy = ? WHERE AttendanceID = ?`, [deployment.DeploymentID, batchId, attendanceStatus, attendanceType, remarks, session.sub, existing.AttendanceID])
        }
        updated++
      } else {
        const [result] = await connection.execute<any>(`INSERT INTO attendance
          (EmployeeID, DeploymentID, BatchID, AttendanceDate, AttendanceStatus, AttendanceType, IsManualEdit, Remarks, CreatedBy)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, [employeeId, deployment.DeploymentID, batchId, attendanceDate, attendanceStatus, attendanceType, remarks, session.sub])
        if (!result.insertId) throw createError({ statusCode: 500, statusMessage: 'Unable to create the employee status.' })
        created++
      }
    }
    await connection.commit()
    return { success: true, created, updated, pending, dates: selectedDates }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
