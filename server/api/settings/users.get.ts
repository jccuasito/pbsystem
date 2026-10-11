import pool from '../../connection/dbconnect'
import { accessForUser, requireAdmin } from '../../utils/settingsAccess'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const [rows] = await pool.execute<any[]>('SELECT UserID, FirstName, LastName, Email, UserType, Status, CreatedAt FROM `user` ORDER BY LastName, FirstName, UserID')
  return { users: await Promise.all(rows.map(async row => ({
    id: row.UserID, name: `${row.FirstName} ${row.LastName}`, email: row.Email,
    role: row.UserType, status: row.Status, createdAt: row.CreatedAt,
    access: await accessForUser(row.UserID, row.UserType)
  }))) }
})
