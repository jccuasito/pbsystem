import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { clearSession, requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const body = await readBody<{ confirmation?: string }>(event)
  if (body?.confirmation !== 'DELETE') throw createError({ statusCode: 400, statusMessage: 'Type DELETE to confirm.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<any[]>('SELECT UserID, UserType, Status FROM `user` WHERE UserID = ? FOR UPDATE', [session.sub])
    const account = rows[0]
    if (!account || account.Status !== 'Active') throw createError({ statusCode: 404, statusMessage: 'Active account not found.' })
    if (account.UserType === 'Admin') {
      const [otherAdmins] = await connection.execute<any[]>('SELECT UserID FROM `user` WHERE UserType = \'Admin\' AND Status = \'Active\' AND UserID <> ? LIMIT 1 FOR UPDATE', [session.sub])
      if (!otherAdmins.length) throw createError({ statusCode: 409, statusMessage: 'You are the last active admin. Assign another admin before deleting your account.' })
    }
    await connection.execute('UPDATE `user` SET Status = \'Inactive\' WHERE UserID = ?', [session.sub])
    if (session.historyId) await connection.execute('UPDATE user_history SET LogoutDateTime = UTC_TIMESTAMP() WHERE HistoryID = ? AND UserID = ?', [session.historyId, session.sub])
    await connection.commit()
    clearSession(event)
    return { success: true }
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
})
