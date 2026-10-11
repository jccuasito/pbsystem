import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const body = await readBody<{ firstName?: string; lastName?: string; gender?: string; departmentId?: number | string | null }>(event)
  const firstName = body.firstName?.trim()
  const lastName = body.lastName?.trim()
  const gender = body.gender

  if (!firstName || !lastName || !['Male', 'Female', 'Prefer not to say'].includes(gender || '')) {
    throw createError({ statusCode: 400, statusMessage: 'First name, last name, and gender are required.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let departmentId: number | null = null
    if (body.departmentId !== '' && body.departmentId !== null && body.departmentId !== undefined) {
      departmentId = Number(body.departmentId)
      if (!Number.isSafeInteger(departmentId) || departmentId < 1) throw createError({ statusCode: 400, statusMessage: 'Select an available department.' })
      const [departments] = await connection.execute<any[]>('SELECT DepartmentID FROM department WHERE DepartmentID = ? AND Status = \'Active\' LIMIT 1 FOR UPDATE', [departmentId])
      if (!departments.length) throw createError({ statusCode: 400, statusMessage: 'Select an available department.' })
    }
    await connection.execute('UPDATE `user` SET FirstName = ?, LastName = ?, Gender = ?, DepartmentID = ? WHERE UserID = ?', [firstName, lastName, gender, departmentId, session.sub])
    await connection.commit()
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }

  const [rows] = await pool.execute<any[]>(
    `SELECT u.UserID, u.FirstName, u.LastName, u.Gender, u.Email, u.DepartmentID, d.DepartmentName, u.UserType, u.Image
     FROM \`user\` u LEFT JOIN department d ON d.DepartmentID = u.DepartmentID WHERE u.UserID = ? LIMIT 1`,
    [session.sub]
  )
  const user = rows[0]

  return {
    message: 'Profile updated.',
    user: {
      id: user.UserID,
      firstName: user.FirstName,
      lastName: user.LastName,
      gender: user.Gender,
      email: user.Email,
      departmentId: user.DepartmentID,
      departmentName: user.DepartmentName || 'Unassigned',
      userType: user.UserType,
      image: user.Image
    }
  }
})
