import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { normalizeEmail, passwordMatches, safeUser, setSession, type AuthUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)
  if (!body.email || !body.password) throw createError({ statusCode: 400, statusMessage: 'Email and password are required.' })
  const [rows] = await pool.execute<any[]>('SELECT UserID, FirstName, LastName, Email, Password, DepartmentID, UserType, Status, EmailVerified FROM `user` WHERE Email = ? LIMIT 1', [normalizeEmail(body.email)])
  const user = rows[0]
  if (!user || !user.Password || !(await passwordMatches(body.password, user.Password))) throw createError({ statusCode: 401, statusMessage: 'Invalid email or password.' })
  if (user.Status !== 'Active') throw createError({ statusCode: 403, statusMessage: 'This account is inactive.' })
  if (!user.EmailVerified) throw createError({ statusCode: 403, statusMessage: 'Please verify your email before logging in.' })
  setSession(event, user as AuthUser)
  await pool.execute('INSERT INTO user_history (UserID, LoginDateTime, IPAddress, Device) VALUES (?, UTC_TIMESTAMP(), ?, ?)', [user.UserID, event.node.req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || event.node.req.socket.remoteAddress || null, event.node.req.headers['user-agent']?.slice(0, 100) || null])
  return { user: safeUser(user as AuthUser) }
})
