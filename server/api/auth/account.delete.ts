import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { clearSession, requireSession } from '../../utils/auth'
import { deleteStaffIdentity } from '../../utils/staffAccountDeletion'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const body = await readBody<{ confirmation?: string }>(event)
  if (body?.confirmation !== 'DELETE') throw createError({ statusCode: 400, statusMessage: 'Type DELETE to confirm.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<any[]>('SELECT UserID, UserType, Status FROM `user` WHERE UserID = ? AND DeletedAt IS NULL FOR UPDATE', [session.sub])
    const account = rows[0]
    if (!account || account.Status !== 'Active') throw createError({ statusCode: 404, statusMessage: 'Active account not found.' })
    if (account.UserType === 'Admin') {
      const [otherAdmins] = await connection.execute<any[]>('SELECT UserID FROM `user` WHERE UserType = \'Admin\' AND Status = \'Active\' AND DeletedAt IS NULL AND UserID <> ? LIMIT 1 FOR UPDATE', [session.sub])
      if (!otherAdmins.length) throw createError({ statusCode: 409, statusMessage: 'You are the last active admin. Assign another admin before deleting your account.' })
    }
    await deleteStaffIdentity(connection, session.sub, session.sub)
    await connection.commit()
    clearSession(event)
    return { success: true }
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
})
