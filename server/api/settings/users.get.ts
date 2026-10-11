import pool from '../../connection/dbconnect'
import { accessForUser, requireAdmin } from '../../utils/settingsAccess'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const [[rows], [departmentRows]] = await Promise.all([
    pool.execute<any[]>('SELECT UserID, FirstName, LastName, Email, Image, DepartmentID, UserType, Status, CreatedAt FROM `user` ORDER BY LastName, FirstName, UserID'),
    pool.execute<any[]>('SELECT DepartmentID, DepartmentName, Status FROM department WHERE Status = \'Active\' ORDER BY DepartmentName, DepartmentID')
  ])
  return { departments: departmentRows.map(row => ({ id: row.DepartmentID, name: row.DepartmentName, status: row.Status })), users: await Promise.all(rows.map(async row => ({
    id: row.UserID, name: `${row.FirstName} ${row.LastName}`, email: row.Email, image: row.Image || null,
    departmentId: row.DepartmentID, role: row.UserType, status: row.Status, createdAt: row.CreatedAt,
    access: await accessForUser(row.UserID, row.UserType)
  }))) }
})
