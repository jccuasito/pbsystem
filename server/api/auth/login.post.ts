import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { hashPassword, normalizeEmail, passwordMatches, safeUser, setSession, type AuthUser } from '../../utils/auth'

const dummyHash = hashPassword('invalid-staff-login-placeholder-2048')

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)
  if (typeof body?.email !== 'string' || typeof body?.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email and password.' })

  const [rows] = await pool.execute<any[]>('SELECT UserID, FirstName, LastName, Email, Password, DepartmentID, UserType, Status, EmailVerified FROM `user` WHERE Email = ? LIMIT 1', [normalizeEmail(body.email)])
  const user = rows[0]

  const matches = await passwordMatches(body.password, user?.Password || await dummyHash)
  if (!user || !user.Password || !matches) throw createError({ statusCode: 401, statusMessage: 'Invalid email or password.' })
  if (user.Status !== 'Active') throw createError({ statusCode: 403, statusMessage: 'This account is inactive.' })
  if (!user.EmailVerified) throw createError({ statusCode: 403, statusMessage: 'Please verify your email before logging in.' })

  const [result] = await pool.execute<any>(
    'INSERT INTO user_history (UserID, LoginDateTime, IPAddress, Device) VALUES (?, UTC_TIMESTAMP(), ?, ?)',
    [
      user.UserID,
      event.node.req.socket.remoteAddress || null,
      event.node.req.headers['user-agent']?.slice(0, 100) || null
    ]
  )

  setSession(event, user as AuthUser, result.insertId)

  return { user: safeUser(user as AuthUser) }
})
