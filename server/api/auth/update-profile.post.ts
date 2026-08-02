import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const body = await readBody<{ firstName?: string; lastName?: string; gender?: string; departmentName?: string }>(event)
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
    const departmentName = body.departmentName?.trim()
    if (departmentName) {
      if (departmentName.length > 100) throw createError({ statusCode: 400, statusMessage: 'Department must be 100 characters or fewer.' })
      const [departments] = await connection.execute<any[]>('SELECT DepartmentID FROM department WHERE LOWER(DepartmentName) = LOWER(?) LIMIT 1', [departmentName])
      if (departments.length) departmentId = departments[0].DepartmentID
      else { const [created] = await connection.execute<any>('INSERT INTO department (DepartmentName, Status) VALUES (?, \'Active\')', [departmentName]); departmentId = created.insertId }
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