import { createError, getRouterParam } from 'h3'
import pool from '../../../connection/dbconnect'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid department.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [departments] = await connection.execute<any[]>('SELECT DepartmentID, Status FROM department WHERE DepartmentID = ? LIMIT 1 FOR UPDATE', [id])
    if (!departments.length || departments[0].Status !== 'Active') throw createError({ statusCode: 404, statusMessage: 'Department not found.' })
    const [assigned] = await connection.execute<any[]>('SELECT UserID FROM `user` WHERE DepartmentID = ? AND Status = \'Active\' LIMIT 1', [id])
    if (assigned.length) throw createError({ statusCode: 409, statusMessage: 'Move or remove the assigned users before deleting this department.' })
    await connection.execute('UPDATE department SET Status = \'Inactive\' WHERE DepartmentID = ?', [id])
    await connection.commit()
    return { success: true }
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
})
