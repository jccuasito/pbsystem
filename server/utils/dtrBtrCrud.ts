import { createError, getQuery, getRouterParam, readBody } from 'h3'
import type { PoolConnection } from 'mysql2/promise'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { resolveBtrEmployee, btrDate, btrHundredths, summarizeBtr } from '../../shared/utils/dtrBtr'
import type { BtrEmployee, BtrEntry } from '../../shared/utils/dtrBtr'

type Batch = { BatchID: number; AgencyID: number; PeriodStart: string; PeriodEnd: string; Status: string }
function id(value: unknown, label: string) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw createError({ statusCode: 400, statusMessage: label+' is required.' })
  return result
}
function editable(batch: Batch) {
  if (batch.Status !== 'Draft') throw createError({ statusCode: 409, statusMessage: 'BTR can only be changed while the DTR is Draft.' })
}
async function batchFor(connection: PoolConnection, batchId: number, lock = false): Promise<Batch> {
  const [[batch]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, PeriodStart, PeriodEnd, Status FROM attendance_dtr WHERE BatchID = ?'+(lock?' FOR UPDATE':''), [batchId])
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'DTR not found.' })
  return { ...batch, PeriodStart: btrDate(batch.PeriodStart), PeriodEnd: btrDate(batch.PeriodEnd) }
}
function input(body: Record<string, unknown>, batch: Batch, employees: BtrEmployee[], relievers: BtrEmployee[]) {
  const date = String(body.AttendanceDate || '')
  const parsed = new Date(date+'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date ||
      date < batch.PeriodStart || date > batch.PeriodEnd) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a valid date inside this DTR cutoff.' })
  }
  const restEmployee = resolveBtrEmployee(body.ReplacedEmployeeID, employees), btrEmployee = resolveBtrEmployee(body.RelieverEmployeeID, relievers)
  if (!restEmployee) throw createError({ statusCode: 400, statusMessage: 'REST employee ID / Employee No must match an employee enrolled in this DTR.' })
  if (!btrEmployee) throw createError({ statusCode: 400, statusMessage: 'BTR employee ID / Employee No must match a DTR employee or an active employee of this agency.' })
  const replaced = Number(restEmployee.EmployeeID), reliever = Number(btrEmployee.EmployeeID)
  if (replaced === reliever) throw createError({ statusCode: 400, statusMessage: 'The reliever must be a different employee.' })
  const hours = Number(body.Hours)
  if (!['number','string'].includes(typeof body.Hours) || !Number.isFinite(hours) || hours <= 0 || hours > 24 || Math.abs(hours*100-Math.round(hours*100)) > 0.000001) {
    throw createError({ statusCode: 400, statusMessage: 'BTR hours must be greater than 0 and at most 24, with up to two decimal places.' })
  }
  return { date, replaced, reliever, hours }
}
async function entriesFor(connection: PoolConnection, batchId: number): Promise<BtrEntry[]> {
  const [rows] = await connection.execute<any[]>(`SELECT b.BTRID, b.AttendanceDate, b.ReplacedEmployeeID, b.RelieverEmployeeID, b.Hours, b.Revision, replaced.EmployeeNumber AS ReplacedEmployeeNumber, reliever.EmployeeNumber AS RelieverEmployeeNumber,
      CONCAT_WS(', ', replaced.LastName, CONCAT_WS(' ', replaced.FirstName, replaced.MiddleName)) AS ReplacedEmployeeName,
      CONCAT_WS(', ', reliever.LastName, CONCAT_WS(' ', reliever.FirstName, reliever.MiddleName)) AS RelieverEmployeeName
    FROM attendance_dtr_btr b
    INNER JOIN employee replaced ON replaced.EmployeeID = b.ReplacedEmployeeID
    INNER JOIN employee reliever ON reliever.EmployeeID = b.RelieverEmployeeID
    WHERE b.BatchID = ? AND b.Status = 'Active'
    ORDER BY b.AttendanceDate, ReplacedEmployeeName, RelieverEmployeeName, b.BTRID`, [batchId])
  return rows.map(row => ({ ...row, AttendanceDate: btrDate(row.AttendanceDate), Hours: Number(row.Hours) }))
}
async function employeesFor(connection: PoolConnection, batchId: number): Promise<BtrEmployee[]> {
  const [rows] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber,
    CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName
    FROM attendance_dtr_employee de INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
    WHERE de.BatchID = ? ORDER BY e.LastName, e.FirstName, e.MiddleName`, [batchId])
  return rows
}
async function relieversFor(connection: PoolConnection, batch: Batch): Promise<BtrEmployee[]> {
  const [rows] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber,
    CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName
    FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    WHERE (ap.AgencyID = ? AND e.Status = 'Active')
      OR EXISTS (SELECT 1 FROM attendance_dtr_employee de WHERE de.EmployeeID = e.EmployeeID AND de.BatchID = ?)
    ORDER BY e.LastName, e.FirstName, e.MiddleName`, [batch.AgencyID, batch.BatchID])
  return rows
}
// Membership and cutoff define BTR eligibility; attendance status/hours do not.
export function btrIssues(entries: BtrEntry[], employees: BtrEmployee[], batch: Batch): BtrEntry[] {
  const enrolled = new Set(employees.map(employee => Number(employee.EmployeeID)))
  return entries.map(row => ({ ...row, Issue:
    row.AttendanceDate < btrDate(batch.PeriodStart) || row.AttendanceDate > btrDate(batch.PeriodEnd)
      ? 'Date is outside the current cutoff.'
      : !enrolled.has(Number(row.ReplacedEmployeeID)) ? 'The REST employee is no longer enrolled in this DTR.' : ''
  }))
}
export async function assertDtrBtrReady(connection: PoolConnection, batch: Batch) {
  const entries = await entriesFor(connection, batch.BatchID)
  if (!entries.length) return
  const reviewed = btrIssues(entries, await employeesFor(connection, batch.BatchID), batch)
  if (reviewed.some(row => row.Issue)) throw createError({ statusCode: 409, statusMessage: 'Review the flagged BTR entries before computing payroll.' })
}
export async function listDtrBtr(event: any) {
  const session = requireSession(event); void session.sub
  const batchId = id(getRouterParam(event, 'id'), 'DTR ID'), connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchFor(connection, batchId)
    const employees = await employeesFor(connection, batchId), relievers = await relieversFor(connection, batch)
    const entries = btrIssues(await entriesFor(connection, batchId), employees, batch)
    await connection.commit()
    return { batch, employees, relievers, entries, totals: summarizeBtr(entries) }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
export async function saveDtrBtr(event: any) {
  const session = requireSession(event)
  const batchId = id(getRouterParam(event, 'id'), 'DTR ID'), body = await readBody<Record<string, unknown>>(event) || {}
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // Serialize the whole sheet: validation failure rolls back every submitted row.
    const batch = await batchFor(connection, batchId, true); editable(batch)
    const rows = Object.hasOwn(body, 'Rows') ? body.Rows : [body]
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw createError({ statusCode: 400, statusMessage: 'Submit between 1 and 1,000 BTR rows.' })
    const employees = await employeesFor(connection, batchId), relievers = await relieversFor(connection, batch)
    const savedIds: number[] = []
    for (let index = 0; index < rows.length; index++) {
    const rowBody = rows[index]
    if (!rowBody || typeof rowBody !== 'object' || Array.isArray(rowBody)) throw createError({ statusCode: 400, statusMessage: 'Row '+(index+1)+': invalid BTR row.' })
    try {
    const value = input(rowBody, batch, employees, relievers), btrId = rowBody.BTRID == null ? null : id(rowBody.BTRID, 'BTR ID')
    let existing: any
    if (btrId) {
      const [[row]] = await connection.execute<any[]>('SELECT * FROM attendance_dtr_btr WHERE BTRID = ? AND BatchID = ? FOR UPDATE', [btrId, batchId])
      if (!row || row.Status !== 'Active') throw createError({ statusCode: 404, statusMessage: 'BTR entry not found. Refresh the list.' })
      if (id(rowBody.Revision, 'Revision') !== row.Revision) throw createError({ statusCode: 409, statusMessage: 'This BTR entry changed. Refresh before editing it again.' })
      existing = row
      if (btrDate(row.AttendanceDate) !== value.date || Number(row.ReplacedEmployeeID) !== value.replaced || Number(row.RelieverEmployeeID) !== value.reliever) {
        throw createError({ statusCode: 400, statusMessage: 'To change the date or employee pairing, remove this entry and add a new one.' })
      }
    } else {
      const [[row]] = await connection.execute<any[]>(`SELECT * FROM attendance_dtr_btr
        WHERE BatchID = ? AND AttendanceDate = ? AND ReplacedEmployeeID = ? AND RelieverEmployeeID = ? FOR UPDATE`,
      [batchId, value.date, value.replaced, value.reliever])
      if (row?.Status === 'Active') throw createError({ statusCode: 409, statusMessage: 'This employee/date/reliever already has a BTR entry. Edit its hours instead.' })
      existing = row
    }
    const [[coverage]] = await connection.execute<any[]>(`SELECT
      COALESCE(SUM(CASE WHEN ReplacedEmployeeID = ? THEN Hours ELSE 0 END),0) AS Covered,
      COALESCE(SUM(CASE WHEN RelieverEmployeeID = ? THEN Hours ELSE 0 END),0) AS Relieved
      FROM attendance_dtr_btr WHERE BatchID = ? AND AttendanceDate = ? AND Status = 'Active' AND BTRID <> ?`,
    [value.replaced, value.reliever, batchId, value.date, existing?.BTRID || 0])
    if (btrHundredths(coverage.Covered)+btrHundredths(value.hours) > 2400) {
      throw createError({ statusCode: 400, statusMessage: 'A REST employee cannot exceed 24 BTR hours on one date in this DTR.' })
    }
    if (btrHundredths(coverage.Relieved)+btrHundredths(value.hours) > 2400) {
      throw createError({ statusCode: 400, statusMessage: 'A reliever cannot exceed 24 BTR hours on one date in this DTR.' })
    }
    let savedId = existing?.BTRID
    if (existing) {
      await connection.execute(`UPDATE attendance_dtr_btr SET Hours = ?, Status = 'Active', Revision = Revision + 1, UpdatedBy = ?, UpdatedAt = CURRENT_TIMESTAMP WHERE BTRID = ? AND BatchID = ?`,
      [value.hours, session.sub, savedId, batchId])
    } else {
      const [result] = await connection.execute<any>(`INSERT INTO attendance_dtr_btr
        (BatchID, AttendanceDate, ReplacedEmployeeID, RelieverEmployeeID, Hours, CreatedBy) VALUES (?, ?, ?, ?, ?, ?)`,
      [batchId, value.date, value.replaced, value.reliever, value.hours, session.sub])
      savedId = result.insertId
    }
    savedIds.push(Number(savedId))
    } catch (error: any) {
      if (Array.isArray(body.Rows) && error.statusCode && error.statusCode < 500) {
        throw createError({ statusCode: error.statusCode, statusMessage: 'Row '+(index+1)+': '+(error.statusMessage || error.message) })
      }
      throw error
    }
    }
    await connection.commit()
    return { success: true, BTRID: savedIds[0], saved: savedIds.length }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
export async function removeDtrBtr(event: any) {
  const session = requireSession(event), query = getQuery(event)
  const batchId = id(getRouterParam(event, 'id'), 'DTR ID'), btrId = id(query.btrId, 'BTR ID'), revision = id(query.revision, 'Revision')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const batch = await batchFor(connection, batchId, true); editable(batch)
    const [result] = await connection.execute<any>(`UPDATE attendance_dtr_btr
      SET Status = 'Inactive', Revision = Revision + 1, UpdatedBy = ?, UpdatedAt = CURRENT_TIMESTAMP
      WHERE BTRID = ? AND BatchID = ? AND Revision = ? AND Status = 'Active'`, [session.sub, btrId, batchId, revision])
    if (!result.affectedRows) throw createError({ statusCode: 409, statusMessage: 'This BTR entry changed or was removed. Refresh the list.' })
    await connection.commit(); return { success: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
