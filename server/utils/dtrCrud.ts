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
