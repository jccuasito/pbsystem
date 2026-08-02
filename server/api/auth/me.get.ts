import { createError } from 'h3'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const [rows] = await pool.execute<any[]>(
    `SELECT u.UserID, u.FirstName, u.LastName, u.Gender, u.Email, u.DepartmentID, d.DepartmentName, u.UserType, u.Image, u.Status, u.CreatedAt, u.EmailVerified
     FROM \`user\` u LEFT JOIN department d ON d.DepartmentID = u.DepartmentID
     WHERE u.UserID = ? LIMIT 1`,
    [session.sub]
  )
  const user = rows[0]
  if (!user || user.Status !== 'Active') throw createError({ statusCode: 401, statusMessage: 'Please sign in.' })

  return {
    user: {
      id: user.UserID,
      firstName: user.FirstName,
      lastName: user.LastName,
      gender: user.Gender,
      email: user.Email,
      emailVerified: Boolean(user.EmailVerified),
      departmentId: user.DepartmentID,
      departmentName: user.DepartmentName || 'Unassigned',
      userType: user.UserType,
      image: user.Image,
      createdAt: user.CreatedAt
    }
  }
})