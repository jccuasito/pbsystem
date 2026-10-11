import { createError, getRouterParam, readBody } from 'h3'
import pool from '../../../connection/dbconnect'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ confirmation?: string }>(event)
  if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid user.' })
  if (id === session.sub) throw createError({ statusCode: 400, statusMessage: 'Use My account to delete your own account.' })
  if (body?.confirmation !== 'DELETE') throw createError({ statusCode: 400, statusMessage: 'Type DELETE to confirm.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [actors] = await connection.execute<any[]>('SELECT UserType, Status FROM `user` WHERE UserID = ? FOR UPDATE', [session.sub])
    if (!actors.length || actors[0].UserType !== 'Admin' || actors[0].Status !== 'Active') throw createError({ statusCode: 403, statusMessage: 'Administrator access is required.' })
    const [rows] = await connection.execute<any[]>('SELECT UserID, Status FROM `user` WHERE UserID = ? FOR UPDATE', [id])
    if (!rows.length || rows[0].Status !== 'Active') throw createError({ statusCode: 404, statusMessage: 'Active user not found.' })
    await connection.execute('UPDATE `user` SET Status = \'Inactive\' WHERE UserID = ?', [id])
    await connection.commit()
    return { success: true }
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
})
