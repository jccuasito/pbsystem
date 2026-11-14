import { createError, setCookie } from 'h3'
import pool from '../connection/dbconnect'
import { normalizeEmail, safeUser, setSession, type AuthUser } from './auth'
import { textInput } from './inputValidation'
import { signToken } from './jwt'

export async function googleSignIn(event: any, google: { googleId: string; email?: string; emailVerified?: boolean; firstName: string; lastName: string }, intent: unknown = 'login') {
  if (!['login', 'signup'].includes(String(intent))) throw createError({ statusCode: 400, statusMessage: 'Choose login or signup.' })
  if (!google.email || !google.emailVerified || !google.googleId) throw createError({ statusCode: 403, statusMessage: 'A verified Google email is required.' })
  const email = normalizeEmail(google.email)
  if (intent === 'signup') {
    const [existing] = await pool.execute<any[]>('SELECT UserID, Password FROM `user` WHERE GoogleID = ? OR Email = ? LIMIT 2', [google.googleId, email])
    if (existing.length > 1 || existing[0]?.Password) throw createError({ statusCode: 409, statusMessage: 'An account already exists for this Google email. Please sign in.' })
    setCookie(event, 'pbs_google_signup', signToken({ signup: true, completeUserId: existing[0]?.UserID || null, googleId: google.googleId, email, firstName: google.firstName, lastName: google.lastName }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 15 })
    return { profile: { firstName: google.firstName || '', lastName: google.lastName || '', email } }
  }
  const connection = await pool.getConnection()
  let committed = false
  try {
    await connection.beginTransaction()
    const [matched] = await connection.execute<any[]>('SELECT UserID, FirstName, LastName, Email, DepartmentID, UserType, Status, GoogleID FROM `user` WHERE GoogleID = ? OR Email = ? LIMIT 2 FOR UPDATE', [google.googleId, email])
    if (matched.length > 1) throw createError({ statusCode: 409, statusMessage: 'Google account links require administrator review.' })
    let user = matched[0]
    if (user) {
      if (user.Status !== 'Active') throw createError({ statusCode: 403, statusMessage: 'This account is inactive.' })
      if (user.GoogleID && user.GoogleID !== google.googleId) throw createError({ statusCode: 409, statusMessage: 'This email is linked to a different Google account.' })
      await connection.execute('UPDATE `user` SET GoogleID = ?, AuthProvider = \'google\', EmailVerified = 1, VerificationToken = NULL, VerificationTokenExpiry = NULL WHERE UserID = ?', [google.googleId, user.UserID])
    } else {
      const first = textInput(google.firstName, 'first name (complete signup if missing)', 100), last = textInput(google.lastName, 'last name (complete signup if missing)', 100)
      await connection.execute('INSERT INTO `user` (FirstName, LastName, Gender, Email, AuthProvider, GoogleID, EmailVerified, UserType, Status) VALUES (?, ?, \'Prefer not to say\', ?, \'google\', ?, 1, \'Viewer\', \'Inactive\')', [first, last, email, google.googleId])
      await connection.commit()
      committed = true
      throw createError({ statusCode: 403, statusMessage: 'Your staff account was created. An administrator must activate it and assign access before you can sign in.' })
    }
    const [history] = await connection.execute<any>('INSERT INTO user_history (UserID, LoginDateTime, IPAddress, Device) VALUES (?, UTC_TIMESTAMP(), ?, ?)', [user.UserID, event.node.req.socket.remoteAddress || null, event.node.req.headers['user-agent']?.slice(0, 100) || null])
    await connection.commit()
    committed = true
    setSession(event, user as AuthUser, history.insertId)
    return { user: safeUser(user as AuthUser) }
  } catch (error) { if (!committed) await connection.rollback(); throw error } finally { connection.release() }
}
