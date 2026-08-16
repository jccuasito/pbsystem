import { createError, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type PositionBody = { id?: unknown; agencyPositionId?: unknown; AgencyID?: unknown; PositionID?: unknown; PositionName?: unknown; Description?: unknown; Status?: unknown }

function validId(value: unknown, field: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${field} must be a valid ID.` })
  return id
}

function positionValues(body: PositionBody) {
  const name = typeof body.PositionName === 'string' ? body.PositionName.trim() : ''
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Position name is required.' })
  const description = typeof body.Description === 'string' ? body.Description.trim() || null : null
  const status = body.Status === undefined || body.Status === '' ? 'Active' : body.Status
  if (status !== 'Active' && status !== 'Inactive') throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
  return { name, description, status }
}

async function ensureAgency(connection: any, agencyId: number) {
  const [agencies] = await connection.execute<any[]>('SELECT AgencyID FROM agency WHERE AgencyID = ?', [agencyId])
  if (!agencies.length) throw createError({ statusCode: 404, statusMessage: 'Agency not found.' })
}

export async function listPositionAssignments(event: any) {
  const session = requireSession(event)
  void session.sub
  const [items, agencies, positions] = await Promise.all([
    pool.execute<any[]>('SELECT ap.AgencyPositionID, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName, p.Description, ap.Status AS AssignmentStatus, p.Status AS PositionStatus FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN `position` p ON p.PositionID = ap.PositionID ORDER BY a.AgencyName, p.PositionName'),
    pool.execute<any[]>('SELECT AgencyID, AgencyName, Status FROM agency ORDER BY AgencyName'),
    pool.execute<any[]>('SELECT PositionID, PositionName, Status FROM `position` ORDER BY PositionName')
  ])
  return { items: items[0], agencies: agencies[0], positions: positions[0] }
}

export async function createPositionAssignment(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<PositionBody>(event)
  const agencyId = validId(body?.AgencyID, 'AgencyID')
  const existingPositionId = body?.PositionID === undefined || body.PositionID === '' ? null : validId(body.PositionID, 'PositionID')
  const values = existingPositionId ? null : positionValues(body || {})
  const status = body?.Status === undefined || body.Status === '' ? 'Active' : body.Status
  if (status !== 'Active' && status !== 'Inactive') throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await ensureAgency(connection, agencyId)
    let positionId = existingPositionId
    if (positionId) {
      const [positions] = await connection.execute<any[]>('SELECT PositionID FROM `position` WHERE PositionID = ?', [positionId])
      if (!positions.length) throw createError({ statusCode: 404, statusMessage: 'Position not found.' })
      const [duplicate] = await connection.execute<any[]>('SELECT AgencyPositionID FROM agency_position WHERE AgencyID = ? AND PositionID = ?', [agencyId, positionId])
      if (duplicate.length) throw createError({ statusCode: 409, statusMessage: 'This position is already assigned to the selected agency.' })
    } else {
      const [position] = await connection.execute<any>('INSERT INTO `position` (PositionName, Description, Status) VALUES (?, ?, ?)', [values!.name, values!.description, values!.status])
      positionId = position.insertId
    }
    const [assignment] = await connection.execute<any>('INSERT INTO agency_position (AgencyID, PositionID, Status) VALUES (?, ?, ?)', [agencyId, positionId, status])
    await connection.commit()
    return { id: positionId, agencyPositionId: assignment.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}

export async function updatePositionAssignment(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<PositionBody>(event)
  const positionId = validId(body?.id, 'Position ID')
  const assignmentId = validId(body?.agencyPositionId, 'Agency position ID')
  const agencyId = validId(body?.AgencyID, 'AgencyID')
  const { name, description, status } = positionValues(body || {})
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await ensureAgency(connection, agencyId)
    const [duplicate] = await connection.execute<any[]>('SELECT AgencyPositionID FROM agency_position WHERE AgencyID = ? AND PositionID = ? AND AgencyPositionID <> ?', [agencyId, positionId, assignmentId])
    if (duplicate.length) throw createError({ statusCode: 409, statusMessage: 'This position is already assigned to the selected agency.' })
    const [position] = await connection.execute<any>('UPDATE `position` SET PositionName = ?, Description = ?, Status = ? WHERE PositionID = ?', [name, description, status, positionId])
    if (!position.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Position not found.' })
    const [assignment] = await connection.execute<any>('UPDATE agency_position SET AgencyID = ?, Status = ? WHERE AgencyPositionID = ? AND PositionID = ?', [agencyId, status, assignmentId, positionId])
    if (!assignment.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Agency-position assignment not found.' })
    await connection.commit()
    return { success: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}

export async function deactivatePositionAssignment(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<PositionBody>(event)
  const assignmentId = validId(body?.agencyPositionId, 'Agency position ID')
  const [result] = await pool.execute<any>('UPDATE agency_position SET Status = \'Inactive\' WHERE AgencyPositionID = ?', [assignmentId])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Agency-position assignment not found.' })
  return { success: true }
}
