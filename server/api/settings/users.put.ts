import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { MODULES, requireAdmin } from '../../utils/settingsAccess'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const actor = await requireAdmin(event)
  const body = await readBody<any>(event)
  const userId = Number(body?.userId)
  const role = String(body?.role || '')
  const status = String(body?.status || '')
  if (!Number.isSafeInteger(userId) || userId < 1 || !['Admin', 'Supervisor', 'Encoder', 'Viewer'].includes(role) || !['Active', 'Inactive'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid user, role, or status.' })
  }
  if (!body?.access || typeof body.access !== 'object' || Object.keys(body.access).some(key => !MODULES.some(item => item.key === key))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid module permissions.' })
  }
  for (const module of MODULES) {
    const permission = body.access[module.key]
    if (!permission || typeof permission.canView !== 'boolean' || typeof permission.canEdit !== 'boolean' || (permission.canEdit && !permission.canView)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid ${module.label} permission.` })
    }
  }
  if (userId === actor.UserID && (role !== 'Admin' || status !== 'Active')) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot remove your own administrator access.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [existing] = await connection.execute<any[]>('SELECT UserID FROM `user` WHERE UserID = ? FOR UPDATE', [userId])
    if (!existing.length) throw createError({ statusCode: 404, statusMessage: 'User not found.' })
    await connection.execute('UPDATE `user` SET UserType = ?, Status = ? WHERE UserID = ?', [role, status, userId])
    for (const module of MODULES) {
      const permission = body.access[module.key]
      await connection.execute(
        'INSERT INTO user_module_permission (UserID, ModuleKey, CanView, CanEdit, UpdatedBy) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE CanView = VALUES(CanView), CanEdit = VALUES(CanEdit), UpdatedBy = VALUES(UpdatedBy)',
        [userId, module.key, Number(permission.canView), Number(permission.canEdit), session.sub]
      )
    }
    await connection.commit()
    return { success: true }
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
})
