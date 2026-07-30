import { createError, getCookie, readBody, setCookie } from 'h3'
import pool from '../../connection/dbconnect'
import { assertPassword, hashPassword, hashToken, normalizeEmail, randomVerificationCode } from '../../utils/auth'
import { verifyToken } from '../../utils/jwt'
import { sendVerificationEmail } from '../../utils/mailer'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ firstName?: string; lastName?: string; gender?: string; email?: string; password?: string; departmentId?: number | null }>(event)
  const firstName = body.firstName?.trim(); const lastName = body.lastName?.trim(); const email = body.email ? normalizeEmail(body.email) : ''
  if (!firstName || !lastName || !email || !body.password || !['Male', 'Female', 'Prefer not to say'].includes(body.gender || '')) throw createError({ statusCode: 400, statusMessage: 'Please complete all required fields.' })
  if (!/^\S+@\S+\.\S+$/.test(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address.' })
  assertPassword(body.password)
  const [existing] = await pool.execute<any[]>('SELECT UserID FROM `user` WHERE Email = ? LIMIT 1', [email])
  if (existing.length) throw createError({ statusCode: 409, statusMessage: 'An account already exists for this email.' })
  let google: any = null
  const pendingGoogle = getCookie(event, 'pbs_google_signup')
  if (pendingGoogle) { try { google = verifyToken(pendingGoogle) as any } catch { /* expired Google signup proof */ } }
  if (google?.signup !== true || google.email !== email) google = null
  const code = randomVerificationCode()
  await pool.execute('INSERT INTO `user` (FirstName, LastName, Gender, Email, Password, AuthProvider, GoogleID, EmailVerified, VerificationToken, VerificationTokenExpiry, DepartmentID) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), ?)', [firstName, lastName, body.gender, email, await hashPassword(body.password), google ? 'google' : 'local', google?.googleId || null, hashToken(code), body.departmentId || null])
  if (google) setCookie(event, 'pbs_google_signup', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  try { await sendVerificationEmail(email, code) } catch (error) { console.error('[auth] Verification email could not be sent', error); return { message: 'Account created, but the verification email could not be sent. Configure Gmail SMTP, then resend verification.', requiresVerification: false } }
  return { message: 'We sent a 6-digit verification code to your email.', requiresVerification: true, email }
})
