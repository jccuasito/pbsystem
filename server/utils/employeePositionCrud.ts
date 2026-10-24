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
export async function listEmployeePositionChanges(event: any) {
  const session = requireSession(event); void session.sub
  const employeeId = id(getRouterParam(event, 'id'), 'Employee')
  const date = effectiveDate(getQuery(event).effectiveDate || todayInPhilippines())
  const employee = await employeeFor(pool, employeeId)
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
  return { employee, positions, history, effectiveDate: date,
    permissions: { canEdit: session.userType !== 'Viewer' && event.context?.moduleCanEdit !== false && employee.Status === 'Active' } }
}
export async function changeEmployeePosition(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'You do not have permission to change employee positions.' })
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
    await connection.execute('UPDATE employee SET AgencyPositionID=?, UpdatedBy=? WHERE EmployeeID=?', [targetId, session.sub, employeeId])
    const [result] = await connection.execute<any>(`INSERT INTO employee_position_change
      (EmployeeID, OldAgencyPositionID, NewAgencyPositionID, EffectiveDate, Reason, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?)`, [employeeId, expectedId, targetId, date, reason, session.sub])
    await connection.commit()
    return { success: true, id: Number(result.insertId) }
  } catch (error: any) {
    await connection.rollback()
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) throw createError({ statusCode: 409, statusMessage: 'Another employee update is in progress. Refresh and try again.' })
    throw error
  } finally { connection.release() }
}
