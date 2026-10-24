import { createError, getQuery, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { todayInPhilippines } from './rateVersions'

function id(value: unknown, label: string) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return result
}
function effectiveDate(value: unknown) {
  const result = String(value || '')
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw createError({ statusCode: 400, statusMessage: 'Enter a valid effective date.' })
  if (result > todayInPhilippines()) throw createError({ statusCode: 400, statusMessage: 'Choose today or an earlier date. Future position changes are not scheduled yet.' })
  return result
}
async function employeeFor(connection: any, employeeId: number, lock = false) {
  const [[employee]] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber, e.AgencyPositionID, e.Status,
    DATE_FORMAT(e.DateHired, '%Y-%m-%d') AS DateHired,
    CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
    ap.AgencyID, a.AgencyName, p.PositionName
    FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
    INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE e.EmployeeID=?${lock ? ' FOR UPDATE' : ''}`, [employeeId])
  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return employee
}
async function assignmentFor(connection: any, employeeId: number, date: string) {
  const [rows] = await connection.execute<any[]>(`SELECT ed.*, DATE_FORMAT(ed.StartDate, '%Y-%m-%d') AS StartDate,
    DATE_FORMAT(ed.EndDate, '%Y-%m-%d') AS EndDate, pr.AgencyPositionID, ap.AgencyID, s.SiteName, c.ClientName
    FROM employee_deployment ed INNER JOIN site_rate sr ON sr.SiteRateID=ed.SiteRateID
    INNER JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID
    INNER JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID
    INNER JOIN site s ON s.SiteID=ed.SiteID INNER JOIN client c ON c.ClientID=s.ClientID
    WHERE ed.EmployeeID=? AND ed.IsPermanentSite=1 AND ed.StartDate<=? AND (ed.EndDate IS NULL OR ed.EndDate>=?)
    ORDER BY ed.StartDate DESC, ed.DeploymentID DESC`, [employeeId, date, date])
  if (rows.length > 1) throw createError({ statusCode: 409, statusMessage: 'Overlapping fixed deployments must be corrected before changing position.' })
  return rows[0] || null
}
async function rateOptions(connection: any, agencyId: number, siteId: number, date: string) {
  const [rows] = await connection.execute<any[]>(`SELECT sr.SiteRateID, pr.AgencyPositionID, p.PositionName,
    pr.RegularRate, br.RegularRate AS BillingRegularRate
    FROM site_rate sr INNER JOIN site s ON s.SiteID=sr.SiteID
    INNER JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID
    INNER JOIN billing_rate br ON br.BillingRateID=sr.BillingRateID AND br.AgencyPositionID=pr.AgencyPositionID
    INNER JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID
    INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE sr.SiteID=? AND ap.AgencyID=? AND sr.Status='Active' AND s.Status='Active'
      AND pr.Status='Active' AND br.Status='Active' AND ap.Status='Active' AND p.Status='Active'
      AND (pr.EffectiveDate IS NULL OR pr.EffectiveDate<=?) AND (br.EffectiveDate IS NULL OR br.EffectiveDate<=?)
    ORDER BY p.PositionName, sr.SiteRateID`, [siteId, agencyId, date, date])
  return rows
}
export async function listEmployeePositionChanges(event: any) {
  const session = requireSession(event); void session.sub
  const employeeId = id(getRouterParam(event, 'id'), 'Employee')
  const date = effectiveDate(getQuery(event).effectiveDate || todayInPhilippines())
  const employee = await employeeFor(pool, employeeId)
  const assignment = await assignmentFor(pool, employeeId, date)
  const [positions] = await pool.execute<any[]>(`SELECT ap.AgencyPositionID, p.PositionName
    FROM agency_position ap INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE ap.AgencyID=? AND ap.Status='Active' AND p.Status='Active' ORDER BY p.PositionName`, [employee.AgencyID])
  const [history] = await pool.execute<any[]>(`SELECT h.PositionChangeID, h.OldAgencyPositionID, h.NewAgencyPositionID,
    DATE_FORMAT(h.EffectiveDate, '%Y-%m-%d') AS EffectiveDate, h.Reason,
    old_p.PositionName AS OldPositionName, new_p.PositionName AS NewPositionName,
    old_a.AgencyName AS AgencyName,
    CONCAT_WS(' ', actor.FirstName, actor.LastName) AS CreatedByName,
    DATE_FORMAT(h.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt
    FROM employee_position_change h
    INNER JOIN agency_position old_ap ON old_ap.AgencyPositionID=h.OldAgencyPositionID
    INNER JOIN agency old_a ON old_a.AgencyID=old_ap.AgencyID
    INNER JOIN \`position\` old_p ON old_p.PositionID=old_ap.PositionID
    INNER JOIN agency_position new_ap ON new_ap.AgencyPositionID=h.NewAgencyPositionID
    INNER JOIN \`position\` new_p ON new_p.PositionID=new_ap.PositionID
    LEFT JOIN \`user\` actor ON actor.UserID=h.CreatedBy
    WHERE h.EmployeeID=? ORDER BY h.EffectiveDate DESC, h.PositionChangeID DESC`, [employeeId])
  return { employee, positions, assignment, siteRates: assignment ? await rateOptions(pool, Number(employee.AgencyID), Number(assignment.SiteID), date) : [], history, effectiveDate: date,
    permissions: { canEdit: session.userType !== 'Viewer' && event.context?.moduleCanEdit !== false && employee.Status === 'Active' } }
}
export async function changeEmployeePosition(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer') throw createError({ statusCode: 403, statusMessage: 'Viewer accounts cannot change positions.' })
  const employeeId = id(getRouterParam(event, 'id'), 'Employee'), body = await readBody<Record<string, unknown>>(event) || {}
  const date = effectiveDate(body.EffectiveDate), targetId = id(body.AgencyPositionID, 'New position')
  const expectedId = id(body.ExpectedAgencyPositionID, 'Current position')
  const reason = String(body.Reason || '').trim()
  if (reason.length < 5 || reason.length > 500) throw createError({ statusCode: 400, statusMessage: 'Enter a reason between 5 and 500 characters.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const employee = await employeeFor(connection, employeeId, true)
    if (employee.Status !== 'Active') throw createError({ statusCode: 409, statusMessage: 'Only active employees can change position.' })
    if (Number(employee.AgencyPositionID) !== expectedId) throw createError({ statusCode: 409, statusMessage: 'The employee position changed. Refresh before saving.' })
    if (targetId === expectedId) throw createError({ statusCode: 400, statusMessage: 'Choose a different position.' })
    if (employee.DateHired && date < employee.DateHired) throw createError({ statusCode: 400, statusMessage: 'Effective date cannot be before the date hired.' })
    const [[target]] = await connection.execute<any[]>(`SELECT ap.AgencyPositionID FROM agency_position ap
      INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
      INNER JOIN agency a ON a.AgencyID=ap.AgencyID
      WHERE ap.AgencyPositionID=? AND ap.AgencyID=? AND ap.Status='Active' AND p.Status='Active' AND a.Status='Active'`, [targetId, employee.AgencyID])
    if (!target) throw createError({ statusCode: 400, statusMessage: 'Select an active position under the same agency.' })
    const [[laterChange]] = await connection.execute<any[]>('SELECT PositionChangeID FROM employee_position_change WHERE EmployeeID=? AND EffectiveDate>=? LIMIT 1', [employeeId, date])
    if (laterChange) throw createError({ statusCode: 409, statusMessage: 'Effective date must be after the last recorded position change.' })
    const checks: [string, any[], string][] = [
      ['SELECT AttendanceID FROM attendance WHERE EmployeeID=? AND AttendanceDate>=? LIMIT 1 FOR UPDATE', [employeeId, date], 'Attendance already exists on or after this date. Review the affected DTR first or choose a later effective date.'],
      ["SELECT PayrollID FROM payroll WHERE EmployeeID=? AND EndDate>=? AND Status<>'Cancelled' LIMIT 1 FOR UPDATE", [employeeId, date], 'Payroll already covers this date. Cancel and correct an unreleased payroll first, or choose a later effective date.'],
      ["SELECT d.BatchID FROM attendance_dtr_employee de INNER JOIN attendance_dtr d ON d.BatchID=de.BatchID WHERE de.EmployeeID=? AND d.PeriodEnd>=? AND d.Status<>'Draft' LIMIT 1 FOR UPDATE", [employeeId, date], 'A computed or locked DTR covers this date. Return the affected DTR to Draft first.'],
      ["SELECT BTRID FROM attendance_dtr_btr WHERE (RelieverEmployeeID=? OR ReplacedEmployeeID=?) AND AttendanceDate>=? AND Status='Active' LIMIT 1 FOR UPDATE", [employeeId, employeeId, date], 'BTR coverage already exists on or after this date. Review it before changing position.'],
      ['SELECT DeploymentID FROM employee_deployment WHERE EmployeeID=? AND IsPermanentSite=1 AND StartDate>? LIMIT 1 FOR UPDATE', [employeeId, date], 'A later fixed deployment already exists. Review Deployment History before backdating this change.'],
    ]
    for (const [sql, values, message] of checks) {
      const [[conflict]] = await connection.execute<any[]>(sql, values)
      if (conflict) throw createError({ statusCode: 409, statusMessage: message })
    }
    const assignment = await assignmentFor(connection, employeeId, date)
    let newDeploymentId: number | null = null
    if (assignment) {
      if (Number(assignment.AgencyID) !== Number(employee.AgencyID) || Number(assignment.AgencyPositionID) !== expectedId) throw createError({ statusCode: 409, statusMessage: 'The fixed assignment does not match the current agency position. Review Deployment History first.' })
      if (date <= assignment.StartDate) throw createError({ statusCode: 400, statusMessage: 'Choose an effective date after the current fixed deployment start date.' })
      const siteRateId = id(body.SiteRateID, 'New position site rate')
      const rates = await rateOptions(connection, Number(employee.AgencyID), Number(assignment.SiteID), date)
      if (!rates.some(row => Number(row.SiteRateID) === siteRateId && Number(row.AgencyPositionID) === targetId)) throw createError({ statusCode: 400, statusMessage: 'Select an active payroll and billing rate for the new position at the same site, effective on the chosen date.' })
      await connection.execute('UPDATE employee_deployment SET EndDate=DATE_SUB(?, INTERVAL 1 DAY) WHERE DeploymentID=?', [date, assignment.DeploymentID])
      const [created] = await connection.execute<any>(`INSERT INTO employee_deployment
        (EmployeeID, SiteRateID, SiteID, SiteShiftID, DeploymentType, IsPermanentSite, StartDate, EndDate, Remarks, CreatedBy)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`, [employeeId, siteRateId, assignment.SiteID, assignment.SiteShiftID, assignment.DeploymentType, date, assignment.EndDate, `Position change: ${reason}`, session.sub])
      newDeploymentId = Number(created.insertId)
      await connection.execute(`UPDATE attendance_dtr_employee de INNER JOIN attendance_dtr d ON d.BatchID=de.BatchID
        SET de.DeploymentID=? WHERE de.EmployeeID=? AND de.DeploymentID=? AND d.Status='Draft'
          AND d.SiteID=? AND d.PeriodEnd>=? AND d.PeriodStart<=COALESCE(?, '9999-12-31')`, [newDeploymentId, employeeId, assignment.DeploymentID, assignment.SiteID, date, assignment.EndDate])
    } else if (body.SiteRateID) throw createError({ statusCode: 400, statusMessage: 'No fixed site assignment needs a rate on this date. Refresh the form.' })
    await connection.execute('UPDATE employee SET AgencyPositionID=?, UpdatedBy=? WHERE EmployeeID=?', [targetId, session.sub, employeeId])
    const [result] = await connection.execute<any>(`INSERT INTO employee_position_change
      (EmployeeID, OldAgencyPositionID, NewAgencyPositionID, EffectiveDate, Reason, OldDeploymentID, NewDeploymentID, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [employeeId, expectedId, targetId, date, reason, assignment?.DeploymentID || null, newDeploymentId, session.sub])
    await connection.commit()
    return { success: true, id: Number(result.insertId), newDeploymentId }
  } catch (error: any) {
    await connection.rollback()
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) throw createError({ statusCode: 409, statusMessage: 'Another employee update is in progress. Refresh and try again.' })
    throw error
  } finally { connection.release() }
}
