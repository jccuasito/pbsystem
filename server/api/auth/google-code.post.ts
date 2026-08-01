import { createError, readBody, setCookie } from 'h3'
import pool from '../../connection/dbconnect'
import { verifyGoogleAuthorizationCode } from '../../utils/googleAuth'
import { safeUser, setSession, type AuthUser } from '../../utils/auth'
import { signToken } from '../../utils/jwt'

/** Handles the authorization code returned by the custom Google button. */
export default defineEventHandler(async (event) => {
  const { code, intent = 'login' } = await readBody<{ code?: string; intent?: 'login' | 'signup' }>(event)
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Missing Google authorization code.' })
  let google
  try { google = await verifyGoogleAuthorizationCode(code) } catch { throw createError({ statusCode: 401, statusMessage: 'Google authorization could not be verified.' }) }
  if (!google.email || !google.emailVerified) throw createError({ statusCode: 403, statusMessage: 'A verified Google email is required.' })
  if (intent === 'signup') {
    const [existing] = await pool.execute<any[]>('SELECT UserID, Password FROM `user` WHERE GoogleID = ? OR Email = ? LIMIT 1', [google.googleId, google.email.toLowerCase()])
    if (existing.length && existing[0].Password) throw createError({ statusCode: 409, statusMessage: 'An account already exists for this Google email. Please use Continue with Google to log in.' })
    setCookie(event, 'pbs_google_signup', signToken({ signup: true, completeUserId: existing[0]?.UserID || null, googleId: google.googleId, email: google.email.toLowerCase(), firstName: google.firstName, lastName: google.lastName }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 15 })
    return { profile: { firstName: google.firstName || '', lastName: google.lastName || '', email: google.email.toLowerCase() } }
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [matched] = await connection.execute<any[]>('SELECT UserID, FirstName, LastName, Email, DepartmentID, UserType, Status FROM `user` WHERE GoogleID = ? OR Email = ? LIMIT 1 FOR UPDATE', [google.googleId, google.email.toLowerCase()])
    let user = matched[0]
    if (user) {
      if (user.Status !== 'Active') throw createError({ statusCode: 403, statusMessage: 'This account is inactive.' })
      await connection.execute('UPDATE `user` SET GoogleID = ?, AuthProvider = \'google\', EmailVerified = 1, VerificationToken = NULL, VerificationTokenExpiry = NULL WHERE UserID = ?', [google.googleId, user.UserID])
    } else {
      const [result] = await connection.execute<any>('INSERT INTO `user` (FirstName, LastName, Gender, Email, AuthProvider, GoogleID, EmailVerified) VALUES (?, ?, \'Prefer not to say\', ?, \'google\', ?, 1)', [google.firstName || 'Google', google.lastName || 'User', google.email.toLowerCase(), google.googleId])
      const [created] = await connection.execute<any[]>('SELECT UserID, FirstName, LastName, Email, DepartmentID, UserType, Status FROM `user` WHERE UserID = ?', [result.insertId]); user = created[0]
    }
    await connection.commit(); setSession(event, user as AuthUser)
    await pool.execute('INSERT INTO user_history (UserID, LoginDateTime, IPAddress, Device) VALUES (?, UTC_TIMESTAMP(), ?, ?)', [user.UserID, event.node.req.socket.remoteAddress || null, event.node.req.headers['user-agent']?.slice(0, 100) || null])
    return { user: safeUser(user as AuthUser) }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
})
