import pool from '../../connection/dbconnect'
import { createError } from 'h3'
import { requireSession, safeUser, type AuthUser } from '../../utils/auth'
export default defineEventHandler(async (event) => { const session = requireSession(event); const [rows] = await pool.execute<any[]>('SELECT UserID, FirstName, LastName, Email, DepartmentID, UserType, Status FROM `user` WHERE UserID = ? LIMIT 1', [session.sub]); if (!rows[0] || rows[0].Status !== 'Active') throw createError({ statusCode: 401, statusMessage: 'Session is no longer valid.' }); return { user: safeUser(rows[0] as AuthUser) } })
