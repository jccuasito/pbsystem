import { createError, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { resignationDate } from './employeeResignation'

function positiveId(value: unknown, label: string) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return number
}
function mayEdit(event: any, session: any) {
  const role = event.context?.activeUserType || session.userType
  return ['Admin', 'Supervisor', 'Encoder'].includes(role) && event.context?.moduleCanEdit !== false
}
async function employeeFor(connection: any, id: number, lock = false) {
  const [[employee]] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber, e.AgencyPositionID, e.Status,
    DATE_FORMAT(e.DateHired, '%Y-%m-%d') AS DateHired,
    DATE_FORMAT(e.ResignationDate, '%Y-%m-%d') AS ResignationDate,
    DATE_FORMAT(e.LastRehireDate, '%Y-%m-%d') AS LastRehireDate,
    CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
    ap.AgencyID, a.AgencyName, p.PositionName
    FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
    INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE e.EmployeeID=?${lock ? ' FOR UPDATE' : ''}`, [id])
  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return employee
}

export async function employeeEmploymentHistory(event: any) {
  const session = requireSession(event)
  const employeeId = positiveId(getRouterParam(event, 'id'), 'Employee')
  const employee = await employeeFor(pool, employeeId)
  const [positions] = await pool.execute<any[]>(`SELECT ap.AgencyPositionID, a.AgencyID, a.AgencyName, p.PositionName
    FROM agency_position ap INNER JOIN agency a ON a.AgencyID=ap.AgencyID
    INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE ap.Status='Active' AND a.Status='Active' AND p.Status='Active'
    ORDER BY a.AgencyName, p.PositionName`)
  const [history] = await pool.execute<any[]>(`SELECT h.RehireID,
    DATE_FORMAT(h.PreviousStartDate, '%Y-%m-%d') AS PreviousStartDate,
    DATE_FORMAT(h.ResignationDate, '%Y-%m-%d') AS ResignationDate,
    DATE_FORMAT(h.RehireDate, '%Y-%m-%d') AS RehireDate, h.Reason,
    old_a.AgencyName AS PreviousAgencyName, old_p.PositionName AS PreviousPositionName,
    a.AgencyName, p.PositionName, CONCAT_WS(' ', actor.FirstName, actor.LastName) AS CreatedByName,
    DATE_FORMAT(h.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt
    FROM employee_rehire h
    INNER JOIN agency_position old_ap ON old_ap.AgencyPositionID=h.PreviousAgencyPositionID
    INNER JOIN agency old_a ON old_a.AgencyID=old_ap.AgencyID
    INNER JOIN \`position\` old_p ON old_p.PositionID=old_ap.PositionID
    INNER JOIN agency_position ap ON ap.AgencyPositionID=h.AgencyPositionID
    INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
    LEFT JOIN \`user\` actor ON actor.UserID=h.CreatedBy
    WHERE h.EmployeeID=? ORDER BY h.RehireDate DESC, h.RehireID DESC`, [employeeId])
  return { employee, positions, history, permissions: { canRehire: mayEdit(event, session) && employee.Status === 'Inactive' } }
}

export async function rehireEmployee(event: any) {
  const session = requireSession(event)
  if (!mayEdit(event, session)) throw createError({ statusCode: 403, statusMessage: 'You do not have permission to rehire employees.' })
  const employeeId = positiveId(getRouterParam(event, 'id'), 'Employee')
  const body = await readBody<Record<string, unknown>>(event) || {}
  const targetId = positiveId(body.AgencyPositionID, 'Return agency position')
  const expectedId = positiveId(body.ExpectedAgencyPositionID, 'Previous agency position')
  const reason = typeof body.Reason === 'string' ? body.Reason.trim() : ''
  if (reason.length < 5 || reason.length > 500) throw createError({ statusCode: 400, statusMessage: 'Enter a rehire reason between 5 and 500 characters.' })
  if (!body.RehireDate) throw createError({ statusCode: 400, statusMessage: 'Return date is required.' })
  let day: string
  try { day = resignationDate(body.RehireDate, null) }
  catch (error: any) { throw createError({ statusCode: 400, statusMessage: String(error.statusMessage || 'Invalid return date.').replace('Resignation date', 'Return date') }) }
  if (!Object.hasOwn(body, 'ExpectedResignationDate') || !Object.hasOwn(body, 'ExpectedLastRehireDate')) throw createError({ statusCode: 400, statusMessage: 'Refresh employment history before saving.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const employee = await employeeFor(connection, employeeId, true)
    if (employee.Status !== 'Inactive') throw createError({ statusCode: 409, statusMessage: 'Only resigned employees can be rehired. Refresh the employee list.' })
    if (employee.AgencyPositionID !== expectedId || (employee.ResignationDate || null) !== body.ExpectedResignationDate || (employee.LastRehireDate || null) !== body.ExpectedLastRehireDate) throw createError({ statusCode: 409, statusMessage: 'Employment details changed. Refresh employment history before saving.' })
    const previousStart = employee.LastRehireDate || employee.DateHired || null
    if (!employee.ResignationDate && !body.ResignationDate) throw createError({ statusCode: 400, statusMessage: 'Confirm the previous resignation date before rehiring this legacy record.' })
    const resigned = resignationDate(employee.ResignationDate || body.ResignationDate, previousStart)
    if (day <= resigned) throw createError({ statusCode: 400, statusMessage: 'Return date must be after the previous resignation date.' })
    const [[target]] = await connection.execute<any[]>(`SELECT ap.AgencyPositionID FROM agency_position ap
      INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID
      WHERE ap.AgencyPositionID=? AND ap.Status='Active' AND a.Status='Active' AND p.Status='Active' FOR UPDATE`, [targetId])
    if (!target) throw createError({ statusCode: 400, statusMessage: 'Select an active agency and position for the return.' })
    // A return cannot silently invalidate existing work or reuse a previous employer's roster.
    const checks: [string, any[], string][] = [
      ['SELECT AttendanceID FROM attendance WHERE EmployeeID=? AND AttendanceDate>? LIMIT 1 FOR UPDATE', [employeeId, resigned], 'Attendance exists after the resignation date. Review it before rehiring.'],
      ["SELECT PayrollID FROM payroll WHERE EmployeeID=? AND EndDate>=? AND Status<>'Cancelled' LIMIT 1 FOR UPDATE", [employeeId, day], 'Payroll already covers the return date. Review its cutoff before rehiring.'],
      ['SELECT DeploymentID FROM employee_deployment WHERE EmployeeID=? AND StartDate>? LIMIT 1 FOR UPDATE', [employeeId, resigned], 'A later deployment exists. Review its dates before rehiring.'],
      ["SELECT BTRID FROM attendance_dtr_btr WHERE Status='Active' AND AttendanceDate>? AND (ReplacedEmployeeID=? OR RelieverEmployeeID=?) LIMIT 1 FOR UPDATE", [resigned, employeeId, employeeId], 'Active BTR coverage exists after resignation. Review it before rehiring.'],
      ['SELECT de.BatchID FROM attendance_dtr_employee de INNER JOIN attendance_dtr d ON d.BatchID=de.BatchID WHERE de.EmployeeID=? AND d.PeriodEnd>=? LIMIT 1 FOR UPDATE', [employeeId, day], 'An existing DTR roster overlaps the return. Review it before rehiring.'],
      ['SELECT PositionChangeID FROM employee_position_change WHERE EmployeeID=? AND EffectiveDate>=? LIMIT 1 FOR UPDATE', [employeeId, day], 'Position history conflicts with this return date. Review it before rehiring.'],
    ]
    for (const [sql, values, message] of checks) {
      const [[conflict]] = await connection.execute<any[]>(sql, values)
      if (conflict) throw createError({ statusCode: 409, statusMessage: message })
    }
    await connection.execute(`UPDATE employee_deployment SET EndDate=?
      WHERE EmployeeID=? AND StartDate<=? AND (EndDate IS NULL OR EndDate>?)`, [resigned, employeeId, resigned, resigned])
    const [result] = await connection.execute<any>(`INSERT INTO employee_rehire
      (EmployeeID, PreviousAgencyPositionID, AgencyPositionID, PreviousStartDate, ResignationDate, RehireDate, Reason, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [employeeId, expectedId, targetId, previousStart, resigned, day, reason, session.sub])
    await connection.execute("UPDATE employee SET Status='Active', AgencyPositionID=?, ResignationDate=NULL, LastRehireDate=?, UpdatedBy=? WHERE EmployeeID=?", [targetId, day, session.sub, employeeId])
    // Old browser sessions must not become usable again when employee status returns to Active.
    await connection.execute(`DELETE s FROM employee_portal_session s
      INNER JOIN employee_portal_account a ON a.AccountID=s.AccountID WHERE a.EmployeeID=?`, [employeeId])
    await connection.commit()
    return { success: true, id: Number(result.insertId), EmployeeID: employeeId, Status: 'Active', RehireDate: day }
  } catch (error: any) {
    await connection.rollback()
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'].includes(error?.code)) throw createError({ statusCode: 409, statusMessage: 'Another employment update occurred. Refresh before trying again.' })
    throw error
  } finally { connection.release() }
}
