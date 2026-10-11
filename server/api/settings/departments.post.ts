import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'
import { requireAdmin } from '../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const body = await readBody<{ name?: string }>(event)
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 100) throw createError({ statusCode: 400, statusMessage: 'Enter a department name of 1 to 100 characters.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [existing] = await connection.execute<any[]>('SELECT DepartmentID, Status FROM department WHERE DepartmentName = ? LIMIT 1 FOR UPDATE', [name])
    if (existing.length && existing[0].Status === 'Active') throw createError({ statusCode: 409, statusMessage: 'This department already exists.' })
    let id: number
    if (existing.length) {
      id = existing[0].DepartmentID
      await connection.execute('UPDATE department SET Status = \'Active\' WHERE DepartmentID = ?', [id])
    } else {
      const [created] = await connection.execute<any>('INSERT INTO department (DepartmentName, Status) VALUES (?, \'Active\')', [name])
      id = created.insertId
    }
    await connection.commit()
    return { department: { id, name, status: 'Active' } }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'This department already exists.' })
    throw error
  } finally { connection.release() }
})
